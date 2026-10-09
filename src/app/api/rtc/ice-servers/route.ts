/**
 * GET /api/rtc/ice-servers — 下发 WebRTC ICE 服务器配置（STUN + TURN）
 *
 * 本文件只负责三件事：**鉴权 → 缓存 → 委派**。
 * 来源优先级（静态覆写 / Cloudflare Realtime / Cloudflare speed / 仅 STUN）与
 * 各上游的形状解析、超时、降级，全部在 `@/lib/rtc/ice-sources` 里，并有单测覆盖。
 *
 * ## 安全
 *
 * 需要登录态。TURN 只在通话时用到，而通话本身就是登录用户行为；未登录直接 401，
 * 客户端会静默退回 STUN，不影响任何匿名页面。
 *
 * @module app/api/rtc/ice-servers
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { resolveIceServers, type IceServersResponse } from '@/lib/rtc/ice-sources';

export const dynamic = 'force-dynamic';

/** 凭据缓存。过期时间由 resolveIceServers 给出（CACHE_TTL_MS），避免两处各写一个常量。 */
let cache: { at: number; body: IceServersResponse } | null = null;

export async function GET() {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (cache && Date.now() < cache.at) {
    return NextResponse.json(cache.body, { headers: { 'x-ice-cache': 'hit' } });
  }

  const body = await resolveIceServers();
  cache = { at: body.cachedUntil, body };
  return NextResponse.json(body, { headers: { 'x-ice-cache': 'miss' } });
}
