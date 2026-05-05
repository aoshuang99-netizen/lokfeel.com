/**
 * Soft Delete Cleanup Cron Job
 * 
 * Runs daily at 2:00 AM UTC (via Vercel Cron or external scheduler)
 * Permanently deletes records that have been soft-deleted for > 30 days
 * 
 * Cron expression: 0 2 * * * (2 AM every day)
 * 
 * Protected models: User, Match, Subscription, Payment, UserReport
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

const SOFT_DELETE_MODELS = [
  "User",
  "Match",
  "Subscription",
  "Payment",
  "UserReport",
  "ChatRoom",
  "Conversation",
] as const;

export async function POST(request: NextRequest) {
  // Authenticate cron request
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Calculate cutoff date: 30 days ago
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  
  const results: Record<string, { deleted: number; error?: string }> = {};
  
  for (const modelName of SOFT_DELETE_MODELS) {
    try {
      // @ts-expect-error - dynamic model access
      const result = await (db as Record<string, { deleteMany: Function }>)[modelName.toLowerCase()].deleteMany({
        where: {
          deletedAt: {
            lt: cutoffDate,
            not: null,
          },
        },
      });
      results[modelName] = { deleted: result.count };
      console.log(`[cleanup] ${modelName}: permanently deleted ${result.count} records`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results[modelName] = { deleted: 0, error: message };
      console.error(`[cleanup] ${modelName}: ERROR - ${message}`);
    }
  }

  const totalDeleted = Object.values(results).reduce(
    (sum, r) => sum + r.deleted, 0
  );

  console.log(`[cleanup] TOTAL: permanently deleted ${totalDeleted} records`);

  return NextResponse.json({
    success: true,
    cutoffDate: cutoffDate.toISOString(),
    results,
    totalDeleted,
    timestamp: new Date().toISOString(),
  });
}

// Vercel Cron manifest (add to vercel.json):
// { "path": "/api/cron/cleanup-soft-delete", "schedule": "0 2 * * *" }
