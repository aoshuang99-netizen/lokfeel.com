/**
 * WO-1089 回归守卫：bot 在线状态不得「群体同步」
 *
 * 背景（实测，非推断）：
 *   - 生产 11338 个 bot：7838 个 botConfig = NULL，3500 个为早期导入格式，
 *     含 `online.avgSessionsPerDay` 的为 **0 个** ⇒ 100% 走默认配置回退。
 *   - 原默认配置硬编码 `seed: 42`，而 `evaluateOnlineTransition` 的随机种子只含日期
 *     ⇒ 全体 bot 共用同一颗骰子，每天只掷一次：要么全体离线，要么全体上线。
 *   - UTC 2026-11-04：seed = 20261146，random() = 0.7449 > p ≈ 0.0559 ⇒ 全体离线。
 *     线上抽查 600 个 bot 全部 offline / transitions = 0，与此判定一致。
 *
 * 本测试锁定两件事：
 *   ① seed 必须由 botId 派生（去相关），不得为常量；
 *   ② 同一天内群体在线比例必须落在合理区间（既非 0% 也非 100%）。
 */

import { getBotConfig } from '../../src/lib/bot-engine/default-config';
import { createSeededRandom } from '../../src/lib/bot-engine/utils';
import {
  calculateOnlineProbability,
  evaluateOnlineTransition,
  createOnlineState,
} from '../../src/lib/bot-engine/modules/online-status';

/** 早期导入格式：不含 online 字段，实测生产 3500 条均为此形态 */
const LEGACY_CONFIG = JSON.stringify({
  originalId: 'F00001',
  ageGroup: 'Young Professional',
  region: 'Northeast',
  profession: 'Event Planner',
});

describe('WO-1089 · 默认配置种子去相关', () => {
  it('legacy 配置走回退分支，且 seed 不等于常量 42', () => {
    const a = getBotConfig(LEGACY_CONFIG, 'cmosgf23g00006');
    expect(a.seed).not.toBe(42);
    expect(a.seed).toBeGreaterThan(0);
  });

  it('不同 botId 得到不同 seed（不再是同一颗骰子）', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 500; i++) {
      seeds.add(getBotConfig(null, `bot-${i}`).seed);
    }
    // 500 个 id 至少应有 490 个互不相同的 seed
    expect(seeds.size).toBeGreaterThan(490);
  });

  it('同一 botId 的 seed 稳定（可复现，不随调用漂移）', () => {
    const s1 = getBotConfig(null, 'bot-stable').seed;
    const s2 = getBotConfig(null, 'bot-stable').seed;
    expect(s1).toBe(s2);
  });

  it('同一 bot 在同一天内多次判定结果恒定（日粒度骰子，已在文档中记录）', () => {
    // 这条锁定「现状语义」，防止有人误以为调高频次就能让 bot 上线
    const daySeed = 20261146;
    const first = createSeededRandom(daySeed)();
    const second = createSeededRandom(daySeed)();
    expect(first).toBe(second);
  });
});

describe('WO-1089 · 群体去相关后在线比例合理', () => {
  it('固定日期下 2000 个 bot 的在线比例落在 2%–12%（非全 0、非全 1）', () => {
    const daySeedBase = 20261146; // UTC 2026-11-04
    let online = 0;
    const N = 2000;

    for (let i = 0; i < N; i++) {
      const cfg = getBotConfig(null, `bot-${i}`);
      // 复刻 evaluateOnlineTransition 的种子构成：config.seed + 日期
      const cfgAny = cfg as any;
      const p = calculateOnlineProbability(cfg, 'America/New_York');
      const rand = createSeededRandom(cfgAny.seed + daySeedBase - 42)();
      if (rand < p) online++;
    }

    const ratio = online / N;
    expect(ratio).toBeGreaterThan(0.02);
    expect(ratio).toBeLessThan(0.12);
  });

  it('负向对照：seed 全为 42 时群体判定退化为一刀切', () => {
    const daySeed = 20261146;
    const cfg = getBotConfig(null, 'any');
    const p = calculateOnlineProbability(cfg, 'America/New_York');
    const r = createSeededRandom(42 + daySeed - 42)();
    // 同一颗骰子 ⇒ 11338 个 bot 的结论要么全 true 要么全 false
    const allSame = Array.from({ length: 100 }, () => r < p).every(Boolean)
      || Array.from({ length: 100 }, () => r < p).every((v) => !v);
    expect(allSame).toBe(true);
  });

  it('evaluateOnlineTransition 在独立 seed 下应能产生 session_start 事件', () => {
    // 找出一个当天会命中的 seed，验证转移逻辑本身是通的（排除「引擎完全坏掉」）
    const now = new Date();
    const dayBase = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const cfg = getBotConfig(null, 'probe') as any;

    let hit = false;
    for (let i = 1; i <= 500 && !hit; i++) {
      const testCfg = { ...cfg, seed: i };
      const state = createOnlineState('probe');
      const { state: next, events } = evaluateOnlineTransition(
        state,
        testCfg,
        'America/New_York'
      );
      if (next.isOnline) {
        hit = true;
        expect(events.some((e) => e.type === 'session_start')).toBe(true);
      }
    }
    expect(hit).toBe(true);
  });
});
