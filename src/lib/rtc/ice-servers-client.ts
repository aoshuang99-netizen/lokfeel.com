/**
 * 客户端 ICE 配置加载器
 *
 * 在建立 PeerConnection **之前**从 `GET /api/rtc/ice-servers` 拉取 ICE 配置
 * （STUN + **TURN 短时凭据**），并缓存在模块作用域。
 *
 * ## 为什么不是简单地在 `createPeerConnection` 里同步取
 *
 * `createPeerConnection` 是同步 API，且被 `useWebRTC` 的多个路径调用。让整条链路
 * 变成 async 会牵动状态机时序（StrictMode 双调用、offer/answer 竞态）。
 * 因此这里用「**预取 + 同步读取**」：调用方在发起/接听通话前 `await loadIceServers()`，
 * 之后 `createPeerConnection` 用 `getIceServersCached()` 同步拿到已经热好的配置。
 *
 * ## 失败一律降级，不阻断通话
 *
 * 端点 401 / 网络失败 / 形状不对 → 退回 `getIceServers()`（STUN-only）。
 * 拿不到 TURN 只是"对称 NAT 下可能连不上"，拿不到 ICE 配置则是"一定连不上"，
 * 所以任何异常都必须吞掉。
 *
 * @module lib/rtc/ice-servers-client
 */

import { getIceServers } from '@/config/webrtc.config';

let cached: RTCIceServer[] | null = null;
let inflight: Promise<RTCIceServer[]> | null = null;

/** 校验服务端返回，避免把坏配置喂给浏览器（例如空 urls 会让 ICE 直接失败）。 */
function sanitize(raw: unknown): RTCIceServer[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const list = (raw as { iceServers?: unknown }).iceServers;
  if (!Array.isArray(list)) return null;
  const out: RTCIceServer[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const urls = o.urls;
    const okUrls =
      (typeof urls === 'string' && urls.length > 0) ||
      (Array.isArray(urls) && urls.length > 0 && urls.every((u) => typeof u === 'string'));
    if (!okUrls) continue;
    const server: RTCIceServer = { urls: urls as string | string[] };
    if (typeof o.username === 'string') server.username = o.username;
    if (typeof o.credential === 'string') server.credential = o.credential;
    out.push(server);
  }
  return out.length > 0 ? out : null;
}

/**
 * 拉取并缓存 ICE 配置。可重复调用（并发会被合并成一次请求）。
 * 永不 reject —— 失败时返回静态兜底。
 */
export async function loadIceServers(): Promise<RTCIceServer[]> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch('/api/rtc/ice-servers', { cache: 'no-store' });
      if (res.ok) {
        const list = sanitize(await res.json());
        if (list) {
          cached = list;
          if (typeof console !== 'undefined') {
            const hasTurn = list.some((s) => JSON.stringify(s.urls).includes('turn'));
            console.log(`[ICE] 配置已加载：${list.length} 组，TURN=${hasTurn ? 'yes' : 'no'}`);
          }
          return cached;
        }
        console.warn('[ICE] 服务端返回形状不合法，退回静态 STUN');
      } else {
        console.warn(`[ICE] /api/rtc/ice-servers HTTP ${res.status}，退回静态 STUN`);
      }
    } catch (err) {
      console.warn('[ICE] 加载 ICE 配置失败，退回静态 STUN:', err instanceof Error ? err.message : err);
    }
    return getIceServers();
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** 同步读取已缓存的配置；未热好时退回静态兜底（STUN-only）。 */
export function getIceServersCached(): RTCIceServer[] {
  return cached ?? getIceServers();
}

/** 测试用：重置缓存。 */
export function __resetIceServersCache(): void {
  cached = null;
  inflight = null;
}
