/**
 * GET /api/rtc/ice-servers — 下发 WebRTC ICE 服务器配置（STUN + TURN）
 *
 * ## 为什么必须由服务端签发，而不是写进 `NEXT_PUBLIC_*`
 *
 * `NEXT_PUBLIC_*` 会被**内联进前端 bundle**，任何人打开 DevTools 就能读到。
 * TURN 凭据一旦长期公开，就等于把流量费用送给任何人。正确做法是：凭据短时有效、
 * 由服务端按需签发，客户端在**建立 PeerConnection 之前**拉一次。
 *
 * ## 来源优先级
 *
 *   1. 自建 / 自购 TURN（服务端 env：`TURN_URLS` + `TURN_USERNAME` + `TURN_CREDENTIAL`）
 *      —— 生产推荐；凭据不出前端 bundle，且可换成长期凭据。
 *   2. Cloudflare TURN 凭据端点（`speed.cloudflare.com/turn-creds`）
 *      —— 无需注册、无需账号，返回短时凭据；免费额度 1000 GB/月。
 *      这是"零凭据即可用上真 TURN"的兜底路径。
 *   3. 仅 STUN —— 上游不可达时**不失败**，退回现状（哪怕拿不到 relay，直连仍能工作）。
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
import { getStunUrls } from '@/config/webrtc.config';

export const dynamic = 'force-dynamic';

/** 上游凭据端点（Cloudflare 公共 TURN）。 */
const CF_TURN_CREDS_URL = 'https://speed.cloudflare.com/turn-creds';

/** 该端点会校验来源，必须带上与自家测速页一致的 Referer/Origin。 */
const CF_HEADERS = {
  Referer: 'https://speed.cloudflare.com/',
  Origin: 'https://speed.cloudflare.com',
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

/** 凭据缓存：Cloudflare 凭据本身有有效期，这里保守地缓存 10 分钟。 */
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { at: number; body: IceServersResponse } | null = null;

export interface IceServersResponse {
  iceServers: RTCIceServer[];
  /** 便于排查：本次配置的来源 */
  source: 'static' | 'cloudflare' | 'stun-only';
  /** 缓存到期时间（epoch ms），仅诊断用 */
  cachedUntil: number;
}

/** 服务端静态覆写（非 NEXT_PUBLIC_，不进 bundle）。 */
function staticTurn(): RTCIceServer | null {
  const urls = (process.env.TURN_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const username = process.env.TURN_USERNAME || '';
  const credential = process.env.TURN_CREDENTIAL || '';
  if (urls.length > 0 && username && credential) return { urls, username, credential };
  return null;
}

/** 校验上游返回的形状；形状不对就当作不可用（宁退 STUN，不给浏览器喂坏配置）。 */
function parseCloudflare(raw: unknown): RTCIceServer | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const urls = Array.isArray(o.urls) ? o.urls.filter((u): u is string => typeof u === 'string') : [];
  if (urls.length === 0) return null;
  if (typeof o.username !== 'string' || !o.username) return null;
  if (typeof o.credential !== 'string' || !o.credential) return null;
  return { urls, username: o.username, credential: o.credential };
}

async function build(): Promise<IceServersResponse> {
  const stunServer: RTCIceServer = { urls: getStunUrls() };

  // 1. 服务端静态覆写优先
  const stat = staticTurn();
  if (stat) {
    return { iceServers: [stunServer, stat], source: 'static', cachedUntil: Date.now() + CACHE_TTL_MS };
  }

  // 2. Cloudflare 公共凭据
  try {
    const res = await fetch(CF_TURN_CREDS_URL, {
      headers: CF_HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const turn = parseCloudflare(await res.json());
      if (turn) {
        return { iceServers: [stunServer, turn], source: 'cloudflare', cachedUntil: Date.now() + CACHE_TTL_MS };
      }
    } else {
      console.warn(`[ice-servers] Cloudflare TURN 凭据端点 HTTP ${res.status}，退回 STUN`);
    }
  } catch (err) {
    console.warn('[ice-servers] Cloudflare TURN 凭据端点不可达，退回 STUN:', err instanceof Error ? err.message : err);
  }

  // 3. 仅 STUN（不失败）
  return { iceServers: [stunServer], source: 'stun-only', cachedUntil: Date.now() + CACHE_TTL_MS };
}

export async function GET() {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (cache && Date.now() < cache.at) {
    return NextResponse.json(cache.body, { headers: { 'x-ice-cache': 'hit' } });
  }

  const body = await build();
  cache = { at: body.cachedUntil, body };
  return NextResponse.json(body, { headers: { 'x-ice-cache': 'miss' } });
}
