/**
 * Soft Delete Cleanup Cron Job
 *
 * Runs daily at 2:00 AM UTC (via Vercel Cron or external scheduler)
 * Permanently deletes records that have been soft-deleted for > 30 days
 *
 * Cron expression: 0 2 * * * (2 AM every day)
 *
 * Protected models: User, Match, Subscription, Payment, UserReport, Conversation
 *
 * BUGFIX (P1): 原先用 `db[modelName.toLowerCase()]` 动态取 Prisma 委托，导致
 *   - "UserReport" → db.userreport（不存在，正确属性名是 db.userReport）→ deleteMany undefined
 *   - "ChatRoom"  → schema 中已无该模型（聊天室由 Conversation 承载）→ 永久报错
 * 且 per-model try/catch 吞掉异常后仍返回 success:true，监控无法发现。
 * 现改为显式「模型名 → 委托」映射，并在有任何模型失败时返回 success:false + failed 明细。
 *
 * BUGFIX (P2 / B-5b)：该端点停摆 5 个月，首次恢复执行时可能一次性硬删大量积压记录
 *   （Conversation 硬删会级联删除 IMMessage 等整段历史），极可能撞上 maxDuration=60s。
 * 现支持：
 *   · `?dry=1`   —— 只读计数，不删任何数据（推荐首次执行前先跑一次）
 *   · `?limit=N` —— 单模型单次最多处理 N 条（默认 2000，上限 5000），未清完的
 *                    在响应里以 `remaining` 标注，由下一次调度继续，天然断点续删
 *
 * @see https://vercel.com/docs/cron-jobs
 *
 * Usage:
 *   POST /api/cron/cleanup-soft-delete
 *   Headers: Authorization: Bearer CRON_SECRET
 *   Query:   ?dry=1            只读预演
 *            ?limit=500        单模型最多处理 500 条
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel: max 60s

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** 支持软删除（存在 deletedAt 字段）的 Prisma 模型 → 委托映射。 */
type DeleteWhere = { deletedAt: { lt: Date; not: null } };

type DeleteManyDelegate = {
  deleteMany: (args: { where: DeleteWhere | { id: { in: string[] } } }) => Promise<{ count: number }>;
  findMany?: (args: {
    where: DeleteWhere;
    select: { id: true };
    take: number;
  }) => Promise<Array<{ id: string }>>;
  count?: (args: { where: DeleteWhere }) => Promise<number>;
};

type SoftDeleteTarget = {
  name: string;
  delegate: () => DeleteManyDelegate;
};

const SOFT_DELETE_TARGETS: SoftDeleteTarget[] = [
  { name: "User", delegate: () => db.user as unknown as DeleteManyDelegate },
  { name: "Match", delegate: () => db.match as unknown as DeleteManyDelegate },
  {
    name: "Subscription",
    delegate: () => db.subscription as unknown as DeleteManyDelegate,
  },
  { name: "Payment", delegate: () => db.payment as unknown as DeleteManyDelegate },
  {
    name: "UserReport",
    delegate: () => db.userReport as unknown as DeleteManyDelegate,
  },
  // 注：ChatRoom 模型已从 schema 移除（由 Conversation 承载聊天室），故不再列出。
  {
    name: "Conversation",
    delegate: () => db.conversation as unknown as DeleteManyDelegate,
  },
];

/** 单模型单次默认上限：避免首次恢复执行时一次性硬删积压导致 60s 超时。 */
const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;

type ModelResult = {
  deleted: number;
  error?: string;
  /** 本轮未处理完的剩余条数（仅 execute 且命中 limit 时出现） */
  remaining?: number;
  /** 预演模式下的命中条数（仅 dry=1 时出现） */
  matched?: number;
};

// Vercel Cron sends GET requests by default
export async function GET(request: NextRequest) {
  return handleCleanup(request);
}

// Also support POST for manual triggers
export async function POST(request: NextRequest) {
  return handleCleanup(request);
}

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

async function handleCleanup(request: NextRequest) {
  // Authenticate cron request (REQUIRED - not optional)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dryRun = ["1", "true", "yes"].includes(
    (searchParams.get("dry") || "").toLowerCase()
  );
  const limit = parseLimit(searchParams.get("limit"));

  // Calculate cutoff date: 30 days ago
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);

  const where: DeleteWhere = {
    deletedAt: {
      lt: cutoffDate,
      not: null,
    },
  };

  const results: Record<string, ModelResult> = {};
  const failed: Array<{ model: string; error: string }> = [];

  for (const target of SOFT_DELETE_TARGETS) {
    try {
      const delegate = target.delegate();

      // ── 预演模式：只读计数，绝不删除 ──────────────────────
      if (dryRun) {
        if (typeof delegate.count !== "function") {
          throw new Error("delegate does not expose count()");
        }
        const matched = await delegate.count({ where });
        results[target.name] = { deleted: 0, matched };
        console.log(
          `[cleanup][dry-run] ${target.name}: ${matched} records would be deleted`
        );
        continue;
      }

      // ── 执行模式：受 limit 约束的批量删除 ────────────────
      if (typeof delegate.findMany === "function") {
        const rows = await delegate.findMany({
          where,
          select: { id: true },
          take: limit + 1, // +1 用于判断是否还有剩余
        });
        const hasMore = rows.length > limit;
        const ids = (hasMore ? rows.slice(0, limit) : rows).map((r) => r.id);

        if (ids.length === 0) {
          results[target.name] = { deleted: 0 };
          console.log(`[cleanup] ${target.name}: nothing to delete`);
          continue;
        }

        const deletedResult = await delegate.deleteMany({
          where: { id: { in: ids } },
        });
        const result: ModelResult = { deleted: deletedResult.count };

        if (hasMore && typeof delegate.count === "function") {
          result.remaining = await delegate.count({ where });
        }

        results[target.name] = result;
        console.log(
          `[cleanup] ${target.name}: permanently deleted ${deletedResult.count} records` +
            (result.remaining !== undefined ? ` | remaining ${result.remaining}` : "")
        );
        continue;
      }

      // 兜底：委托未暴露 findMany 时按模型整体删除（旧行为）
      const fallback = await delegate.deleteMany({ where });
      results[target.name] = { deleted: fallback.count };
      console.log(
        `[cleanup] ${target.name}: permanently deleted ${fallback.count} records`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results[target.name] = { deleted: 0, error: message };
      failed.push({ model: target.name, error: message });
      console.error(`[cleanup] ${target.name}: ERROR - ${message}`);
    }
  }

  const totalDeleted = Object.values(results).reduce(
    (sum, r) => sum + r.deleted,
    0
  );
  const totalRemaining = Object.values(results).reduce(
    (sum, r) => sum + (r.remaining ?? 0),
    0
  );

  const success = failed.length === 0;

  console.log(
    `[cleanup]${dryRun ? "[dry-run]" : ""} TOTAL: permanently deleted ${totalDeleted} records` +
      (totalRemaining > 0 ? ` | remaining ${totalRemaining}` : "") +
      (success ? "" : ` | FAILED models: ${failed.map((f) => f.model).join(", ")}`)
  );

  // success:false 让外部监控能从响应体识别部分失败（此前恒为 true，属监控盲区）。
  // B-5a：失败时同时返回 HTTP 500 —— 两套调度器（netlify/functions/cron-runner.ts
  // 只记录 res.status；deploy/selfhost/cron/run-cron.sh 仅 2xx 判成功）都只看状态码，
  // 仅靠响应体无法触发告警。
  return NextResponse.json(
    {
      success,
      mode: dryRun ? "dry-run" : "execute",
      limit,
      cutoffDate: cutoffDate.toISOString(),
      results,
      totalDeleted,
      totalRemaining,
      failed,
      timestamp: new Date().toISOString(),
    },
    { status: success ? 200 : 500 }
  );
}

// Vercel Cron manifest (add to vercel.json):
// { "path": "/api/cron/cleanup-soft-delete", "schedule": "0 2 * * *" }
