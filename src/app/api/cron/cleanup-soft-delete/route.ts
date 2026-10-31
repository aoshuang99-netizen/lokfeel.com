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
 * @see https://vercel.com/docs/cron-jobs
 *
 * Usage:
 *   POST /api/cron/cleanup-soft-delete
 *   Headers: Authorization: Bearer CRON_SECRET
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel: max 60s

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** 支持软删除（存在 deletedAt 字段）的 Prisma 模型 → 委托映射。 */
type DeleteManyDelegate = {
  deleteMany: (args: {
    where: { deletedAt: { lt: Date; not: null } };
  }) => Promise<{ count: number }>;
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

// Vercel Cron sends GET requests by default
export async function GET(request: NextRequest) {
  return handleCleanup(request);
}

// Also support POST for manual triggers
export async function POST(request: NextRequest) {
  return handleCleanup(request);
}

async function handleCleanup(request: NextRequest) {
  // Authenticate cron request (REQUIRED - not optional)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Calculate cutoff date: 30 days ago
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);

  const results: Record<string, { deleted: number; error?: string }> = {};
  const failed: Array<{ model: string; error: string }> = [];

  for (const target of SOFT_DELETE_TARGETS) {
    try {
      const result = await target.delegate().deleteMany({
        where: {
          deletedAt: {
            lt: cutoffDate,
            not: null,
          },
        },
      });
      results[target.name] = { deleted: result.count };
      console.log(`[cleanup] ${target.name}: permanently deleted ${result.count} records`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results[target.name] = { deleted: 0, error: message };
      failed.push({ model: target.name, error: message });
      console.error(`[cleanup] ${target.name}: ERROR - ${message}`);
    }
  }

  const totalDeleted = Object.values(results).reduce(
    (sum, r) => sum + r.deleted, 0
  );

  const success = failed.length === 0;

  console.log(
    `[cleanup] TOTAL: permanently deleted ${totalDeleted} records` +
      (success ? "" : ` | FAILED models: ${failed.map((f) => f.model).join(", ")}`)
  );

  // success:false 让外部监控能从响应体识别部分失败（此前恒为 true，属监控盲区）
  return NextResponse.json({
    success,
    cutoffDate: cutoffDate.toISOString(),
    results,
    totalDeleted,
    failed,
    timestamp: new Date().toISOString(),
  });
}

// Vercel Cron manifest (add to vercel.json):
// { "path": "/api/cron/cleanup-soft-delete", "schedule": "0 2 * * *" }
