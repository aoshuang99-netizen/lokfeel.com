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
import { getFirebaseAdminStatus } from "@/lib/firebase/admin";
import { describePaymentAvailability } from "@/lib/payments/availability";

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
/**
 * 🔴 必须是动态路由。
 *
 * 本文件原先没有这一行 —— 而 App Router 对「只导出 GET、且不接收 request 参数」的
 * route handler 会**默认预渲染**，于是 Next 自己发 `Surrogate-Control: public, max-age=60`，
 * 把函数返回的 `Cache-Control` 覆盖掉：源站写 no-store 也没用，边缘照样缓存 60 秒。
 * 实测证据：响应头同时出现 `Surrogate-Control: public, max-age=60` 与
 * `Cache-Status: "Netlify Durable"; hit`，而连续多次读到的 dbLatency 是同一个数。
 *
 * 仓库里其它 300+ 个 API 路由都显式写了 force-dynamic，这里属于遗漏。
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

    // firebase-admin 状态（惰性加载，失败会收敛成 sdkLoaded=false，不会抛）
    const fb = await getFirebaseAdminStatus();
    const firebaseStatus = {
      sdkLoaded: fb.sdkLoaded,
      configured: fb.configured,
      initialized: fb.initialized,
      appCount: fb.appCount,
    };

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
      // firebase-admin（Auth 桥）状态。加这个字段的起因是一次线上事故：
      // 2026-09-29 firebase-admin 13→14 后 /api/diagnostic/firebase 由 403 变 500，
      // 但该端点是管理员专用的，普通探活看不到，导致"发版即坏"却不易察觉。
      // 这里只暴露布尔/数字（不含任何凭证、也不回传错误文本），
      // 于是 sdkLoaded=false 就能一眼看出"函数包里缺包/包加载失败"。
      firebaseAdmin: firebaseStatus,
      // 支付接入进度：**只回布尔与变量名**，绝不回传任何凭据值（本端点是公开的）。
      // 用途：把「上线前最后一步」变成一行可查的输出 ——
      //   configured=false 且 missing=["CREEM_API_KEY", ...] ⇒ 其余已就绪，只差凭据；
      //   接入后同一字段变 true ⇒ 不需要再靠人肉记忆判断"接完没有"。
      payments: describePaymentAvailability(),
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
        // 🔴 探活端点不能缓存。
        // 原为 `public, max-age=60, stale-while-revalidate=86400`，实测后果有两个：
        //   1) 边缘会连续返回同一个 dbLatency（实测三次都是 5615ms、带缓存体检时是 286ms），
        //      数字看着"很稳"，其实是 60 秒前的快照 ⇒ 性能回归与故障都被掩盖；
        //   2) 坏发布期间，边缘仍会对监控喊 200 healthy 最长 60 秒。
        // 探活流量极小，为省这点 CDN 命中而让监控失真不划算。
        "Cache-Control": "no-store, max-age=0",
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
