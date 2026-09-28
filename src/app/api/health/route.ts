/**
 * Health Check API Endpoint
 *
 * Monitors system health including:
 * - Database connection status and latency
 * - Redis cache availability and hit rate
 *
 * OPTIMIZATION: Added for performance monitoring (T02 task)
 *
 * ENDPOINT: GET /api/health
 *
 * Response (healthy):
 * {
 *   "status": "healthy",
 *   "dbLatency": 42,
 *   "timestamp": "2025-06-08T12:00:00.000Z",
 *   "cache": {
 *     "hits": 150,
 *     "misses": 50,
 *     "hitRate": 0.75
 *   },
 *   "version": "1.0.0"
 * }
 *
 * Response (unhealthy):
 * {
 *   "status": "unhealthy",
 *   "error": "Database connection failed",
 *   "timestamp": "2025-06-08T12:00:00.000Z"
 * }
 *
 * HTTP Status:
 * - 200: System is healthy
 * - 503: Database connection failed (Service Unavailable)
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCacheStats } from "@/lib/redis-cache";
import { getRedisStatus } from "@/lib/im/redis";
import { describeBotPolicy } from "@/config/bot-policy";

/**
 * GET /api/health
 * Check system health
 *
 * G-4（2026-09-27）：响应新增 `redis` 字段，汇报 IM 侧实际生效的后端。
 *   · `backend: 'upstash'` → 正常
 *   · `backend: 'memory'`  → 降级（未配置，或已触发熔断）。`degradedReason`
 *     会给出触发来源。自托管单实例部署看到 'memory' 是**预期**行为；
 *     但若是"已配置却降级"，说明 Redis 不可达，限流与在线状态正在弱化。
 */
export async function GET(): Promise<NextResponse> {
  const timestamp = new Date().toISOString();

  try {
    // Test database connection
    const dbStart = Date.now();

    // Use Prisma model query instead of $queryRaw (Turso blocks raw SQL)
    await db.user.count();

    const dbLatency = Date.now() - dbStart;

    // Get cache statistics
    const cacheStats = getCacheStats();

    // P0-5：Bot 演示模块状态。这一行是部署后**确认总开关生效**的最小手段：
    //   · enabledSource='legacy-default' → 未显式配置，正沿用改造前行为（启用）
    //   · enabledSource='env'            → 部署方显式决定
    //   · enabledSource='invalid'        → 取值写错了，已按 fail-closed 关闭
    const botDesc = describeBotPolicy();

    // Build healthy response
    const healthData = {
      status: "healthy" as const,
      dbLatency,
      timestamp,
      cache: {
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        hitRate: cacheStats.hitRate,
      },
      redis: getRedisStatus(),
      botModule: {
        ...botDesc.summary,
        warnings: botDesc.warnings,
      },
      // Add version from package.json (optional)
      version: process.env.npm_package_version || "unknown",
    };

    // Log health check in development
    if (process.env.NODE_ENV === "development") {
      console.log(`[health] OK - DB latency: ${dbLatency}ms, Cache hit rate: ${Math.round(cacheStats.hitRate * 100)}%`);
    }

    return NextResponse.json(healthData, {
      status: 200,
      headers: {
        // Cache health check for 60 seconds (matching existing header config)
        "Cache-Control": "public, max-age=60, stale-while-revalidate=86400",
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    // Database connection failed
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Log error in development
    if (process.env.NODE_ENV === "development") {
      console.error(`[health] FAILED - ${errorMessage}`);
    }

    // Build unhealthy response
    const healthData = {
      status: "unhealthy" as const,
      error: errorMessage,
      timestamp,
      // Include partial cache stats even on DB failure
      cache: getCacheStats(),
      redis: getRedisStatus(),
      botModule: describeBotPolicy().summary,
    };

    return NextResponse.json(healthData, {
      status: 503, // Service Unavailable
      headers: {
        // Don't cache error responses
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "application/json",
      },
    });
  }
}

/**
 * HEAD /api/health
 * Lightweight health check (no response body)
 */
export async function HEAD(): Promise<NextResponse> {
  try {
    await db.user.count();
    return new NextResponse(null, { status: 200 });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
