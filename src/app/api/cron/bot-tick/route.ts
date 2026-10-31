/**
 * Vercel Cron Job — Bot Engine Tick
 *
 * This endpoint is called every minute by Vercel Cron Jobs.
 * It processes a single tick of the bot behavior engine.
 *
 * Schedule: Every minute
 * Purpose: Process pending actions, evaluate online states, trigger bot behaviors
 *
 * Environment Variables Required:
 * - CRON_SECRET: Secret key for authenticating cron requests
 * - BOT_ENGINE_ENABLED: Bot 模块总开关（2026-09-28 起代码默认关闭）
 * - BOT_ENGINE_TICK_ENABLED: **tick 执行开关，默认关闭**（B-6 拆分，见下）
 *
 * BUGFIX (B-6, P0)：此前的实现是一个**空转的健康探针** ——
 *   `if (health.botCount === 0) return { status: 'no_bots' }`，从头到尾
 *   没有调用 `loadBotUsers()` / `tick()` / `start()`。而 `botConfigs`
 *   只在 `start()` → `loadBotUsers()` 内填充 ⇒ `botCount` 恒为 0 ⇒
 *   恒返回 `no_bots` ⇒ 11,338 个 Bot 的行动引擎**从未执行过一次 tick**
 *   （`tickCount` 在生产响应里恒为 0）。
 *
 * 现行为：
 *   1. `botCount === 0` 时**显式幂等加载**（`ensureBotsLoaded()`），不再把
 *      "还没加载" 误判成 "库里没有 Bot"；
 *   2. 真正没有 Bot 才返回 `no_bots`（带 `botCount`，可区分两种 0）；
 *   3. `BOT_ENGINE_TICK_ENABLED` 为 false（默认）时**只加载不 tick**，响应
 *      带 `tickSkipped: true` + 原因 —— 即修复前后线上行为完全一致，但
 *      "到底加载到了多少个 Bot" 变成可观测的；
 *   4. 开关打开后才 `tickOnce()`，并回报 tick 前后的 `tickCount` 增量。
 *
 * 为什么默认不直接开启：11k+ Bot 一旦 tick 就会真实发消息 / 建匹配 / 写库，
 * 属产品行为与成本决策，必须由运营显式开启（见 docs/OPEN-CORE-POSITIONING.md）。
 *
 * @see https://vercel.com/docs/cron-jobs
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createPrismaAdapter } from '@/lib/bot-engine/schedulers/prisma-adapter';
import { BotEngine, DEFAULT_ENGINE_CONFIG } from '@/lib/bot-engine';
import {
  BOT_DISABLED_HTTP_STATUS,
  botDisabledBody,
  describeTickGate,
  getBotEngineTunables,
  isBotEnabled,
  isBotTickEnabled,
} from '@/config/bot-policy';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Hobby: 10s, Pro: 60s, Enterprise: 300s

// In-memory engine instance (persists across requests in same region)
let engineInstance: BotEngine | null = null;
let lastTickTime = 0;

function getEngine(): BotEngine {
  if (!engineInstance) {
    const adapter = createPrismaAdapter(db);
    // P0-5：运行参数从 bot-policy 单一配置源取（改造前是这里写死的 60s/50/30s/1x）。
    // 默认值与旧实现逐字段相同，改动只影响"由谁决定"，不影响线上行为。
    engineInstance = new BotEngine(adapter, {
      ...DEFAULT_ENGINE_CONFIG,
      ...getBotEngineTunables(),
      enableLogging: false, // Disable logging in production for performance
    });
    console.log('[Cron] BotEngine instance created');
  }
  return engineInstance;
}

function engineSnapshot(engine: BotEngine) {
  const health = engine.getHealth();
  return {
    botCount: health.botCount,
    tickCount: health.tickCount,
    lastTickAt: health.lastTickAt,
    scheduledActions: health.scheduledActionsPending,
    eventsProcessed: health.globalStats?.totalEventsProcessed || 0,
  };
}

// GET /api/cron/bot-tick
export async function GET(request: Request) {
  const startTime = Date.now();

  // Verify cron secret (REQUIRED - not optional)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // P0-5：Bot 模块总开关。鉴权**之后**再判 —— 匿名请求不应从状态码差异
  // 推断出模块是否启用（否则等于免费暴露部署配置）。
  if (!isBotEnabled()) {
    return NextResponse.json(botDisabledBody(), { status: BOT_DISABLED_HTTP_STATUS });
  }

  try {
    const engine = getEngine();

    // ── B-6 第 1 环：先把 Bot 配置加载进来（幂等，只读） ──────────
    if (engine.getHealth().botCount === 0) {
      await engine.ensureBotsLoaded();
    }

    const before = engineSnapshot(engine);

    // 加载后仍为 0 ⇒ 库里确实没有可用的 Bot 用户（与"没加载"区分开）
    if (before.botCount === 0) {
      return NextResponse.json({
        status: 'no_bots',
        message: 'No bot users found in database',
        botCount: 0,
        tickCount: before.tickCount,
        timestamp: new Date().toISOString(),
      });
    }

    // ── B-6 第 2 环：tick 门控（默认关闭） ──────────────────────
    if (!isBotTickEnabled()) {
      return NextResponse.json({
        status: 'ok',
        tickSkipped: true,
        reason: describeTickGate(),
        timestamp: new Date().toISOString(),
        executionMs: Date.now() - startTime,
        engine: before,
      });
    }

    // Rate limiting: ensure minimum 50s between ticks
    const timeSinceLastTick = Date.now() - lastTickTime;
    if (lastTickTime > 0 && timeSinceLastTick < 50_000) {
      return NextResponse.json({
        status: 'skipped',
        reason: 'Too soon since last tick',
        lastTickAge: `${Math.round(timeSinceLastTick / 1000)}s`,
        engine: before,
      });
    }

    // ── B-6 第 3 环：真正执行一次 tick（写库） ──────────────────
    try {
      await engine.tickOnce();
    } finally {
      lastTickTime = Date.now();
    }

    const after = engineSnapshot(engine);

    return NextResponse.json({
      status: 'ok',
      tickSkipped: false,
      timestamp: new Date().toISOString(),
      executionMs: Date.now() - startTime,
      engine: after,
      tickDelta: after.tickCount - before.tickCount,
    });

  } catch (error) {
    console.error('[Cron] Bot tick error:', error);
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
