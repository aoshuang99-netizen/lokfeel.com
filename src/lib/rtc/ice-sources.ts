/**
 * ICE 服务器来源解析（**服务端专用**）
 *
 * ## 为什么必须由服务端签发，而不是写进 `NEXT_PUBLIC_*`
 *
 * `NEXT_PUBLIC_*` 会被**内联进前端 bundle**，任何人打开 DevTools 就能读到。
 * TURN 凭据一旦长期公开，就等于把流量费用送给任何人。正确做法是：凭据短时有效、
 * 由服务端按需签发，客户端在**建立 PeerConnection 之前**拉一次
 * （见 `lib/rtc/ice-servers-client.ts`）。
 *
 * ## 来源优先级（自上而下，前一个成功即返回）
 *
 *   1. `staticTurn()`              —— 服务端 env `TURN_URLS` + `TURN_USERNAME` + `TURN_CREDENTIAL`
 *                                     自建 coturn / 托管静态凭据（路径 A / B）
 *   2. `cloudflareRealtimeTurn()`  —— 服务端 env `TURN_TOKEN_ID` + `TURN_API_TOKEN`
 *                                     Cloudflare Realtime TURN（**推荐终局**：$0.05/GB、
 *                                     前 1000 GB/月免费、anycast、有合同）
 *   3. `cloudflareSpeedTurn()`     —— `speed.cloudflare.com/turn-creds`，免注册兜底
 *                                     ⚠️ 这是 Cloudflare **测速页**用的端点，非对外产品合同
 *   4. 仅 STUN                     —— 上游全挂时**不失败**，退回现状（直连仍能工作）
 *
 * ## 为什么 1 优先于 2
 *
 * `staticTurn()` 代表**运维明确写下的意图**（「用我指定的这台 TURN」）。自动兜底
 * 不应该覆盖显式配置，否则运维设了值却不生效，排查成本极高。
 *
 * ## 顺序为何不能颠倒（重要）
 *
 * 第 2、3 级都是「有则更好、无则降级」。如果把它们写在前面，一旦 Cloudflare
 * 端点不可达，本可用的静态配置反而被跳过 —— 那是**把可用状态换成更差的状态**。
 *
 * @module lib/rtc/ice-sources
 */

import { getStunUrls } from '@/config/webrtc.config';

export interface IceServersResponse {
  iceServers: RTCIceServer[];
  /** 便于排查：本次配置的来源 */
  source: 'static' | 'cloudflare-realtime' | 'cloudflare' | 'stun-only';
  /** 缓存到期时间（epoch ms），仅诊断用 */
  cachedUntil: number;
}

/** 上游凭据本身的保守缓存期。所有来源共用同一个值，便于推理「缓存多久会打一次上游」。 */
export const CACHE_TTL_MS = 10 * 60 * 1000;

/** 上游请求超时。通话前拉配置是**关键路径**，不能让上游卡住建连。 */
const UPSTREAM_TIMEOUT_MS = 6000;

const LOG = '[ice-servers]';

// ─────────────────────────────────────────────────────────────────────
// 1. 服务端静态覆写（自建 coturn / 托管静态凭据）
// ─────────────────────────────────────────────────────────────────────

/**
 * 读服务端 env 组装静态 TURN。
 *
 * 三项**必须同时具备**才算配置完整：只给了 URL 没给凭据，等于配了一个拿不到
 * relay 的服务器 —— 那比不配更糟（会顶掉后面的可用兜底），所以这里直接返回 null。
 */
export function staticTurn(): RTCIceServer | null {
  const urls = (process.env.TURN_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const username = process.env.TURN_USERNAME || '';
  const credential = process.env.TURN_CREDENTIAL || '';
  if (urls.length > 0 && username && credential) return { urls, username, credential };
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// 2. Cloudflare Realtime TURN（推荐终局）
// ─────────────────────────────────────────────────────────────────────

/**
 * 凭据签发端点。
 * 注意域名是 `rtc.live.cloudflare.com`（Realtime 数据面），**不是** `api.cloudflare.com`
 * （后者用于创建 TURN Key，属一次性运维动作，见 `scripts/setup-cloudflare-turn.mjs`）。
 */
const CF_REALTIME_KEYS_URL = 'https://rtc.live.cloudflare.com/v1/turn/keys';

/**
 * 凭据 TTL（秒）。
 *
 * ⚠️ 必须**明显大于** `CACHE_TTL_MS`。否则：服务端缓存里那份凭据已过期，客户端
 * 却仍在缓存期外拿到它 → 表现是「配置里有 TURN 但拿不到 relay」，且**没有任何报错**。
 * 取 3600s = 10 分钟的 6 倍，留足冗余。
 */
export const CF_REALTIME_TTL_SECONDS = 3600;

/**
 * 解析 Cloudflare Realtime TURN 的签发响应。
 *
 * 官方形状是 `{ iceServers: { urls, username, credential } }` —— **不是数组**，
 * 且 `urls` 可能是字符串或字符串数组。这里对三种形态都做兼容，
 * 形状不对一律返回 null（宁降级，不喂浏览器坏配置）。
 *
 * 合法响应里通常会**混入一条 `stun:stun.cloudflare.com:3478`** —— 这是正常的
 * （一个 `RTCIceServer` 可混合 stun/turn，凭据只作用于 turn 那几条）。
 */
export function parseCfRealtime(raw: unknown): RTCIceServer | null {
  if (!raw || typeof raw !== 'object') return null;
  const outer = raw as Record<string, unknown>;

  const pickUrls = (v: unknown): string[] => {
    if (typeof v === 'string') return v ? [v] : [];
    if (Array.isArray(v)) return v.filter((u): u is string => typeof u === 'string');
    return [];
  };

  const fromObject = (o: Record<string, unknown>): RTCIceServer | null => {
    const urls = pickUrls(o.urls);
    if (urls.length === 0) return null;
    if (typeof o.username !== 'string' || !o.username) return null;
    if (typeof o.credential !== 'string' || !o.credential) return null;
    return { urls, username: o.username, credential: o.credential };
  };

  // 形态 i：{ iceServers: { urls, username, credential } }（官方）
  if (outer.iceServers && typeof outer.iceServers === 'object') {
    const inner = outer.iceServers;
    if (Array.isArray(inner)) {
      // 形态 ii：{ iceServers: [ {...} ] }（标准 RTCIceServer[]）
      for (const item of inner) {
        if (item && typeof item === 'object') {
          const r = fromObject(item as Record<string, unknown>);
          if (r) return r;
        }
      }
      return null;
    }
    return fromObject(inner as Record<string, unknown>);
  }

  // 形态 iii：直接就是 { urls, username, credential }
  return fromObject(outer);
}

/**
 * 取 Cloudflare Realtime TURN 凭据。
 *
 * 未配置两个 env 时**静默返回 null**（这是绝大多数部署的常态，不应产生噪音日志）；
 * 配置了但失败时才 warn，因为那代表「本该可用却坏了」。
 */
export async function cloudflareRealtimeTurn(): Promise<RTCIceServer | null> {
  const keyId = process.env.TURN_TOKEN_ID || '';
  const apiToken = process.env.TURN_API_TOKEN || '';
  if (!keyId || !apiToken) return null;

  const url = `${CF_REALTIME_KEYS_URL}/${encodeURIComponent(keyId)}/credentials/generate`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ttl: CF_REALTIME_TTL_SECONDS }),
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`${LOG} Cloudflare Realtime TURN 签发失败 HTTP ${res.status}，降级到下一来源`);
      return null;
    }

    const turn = parseCfRealtime(await res.json());
    if (!turn) {
      console.warn(`${LOG} Cloudflare Realtime TURN 返回形状不合法，降级到下一来源`);
      return null;
    }
    return turn;
  } catch (err) {
    console.warn(`${LOG} Cloudflare Realtime TURN 不可达，降级到下一来源:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 3. Cloudflare speed 测速页凭据（免注册兜底）
// ─────────────────────────────────────────────────────────────────────

/** 上游凭据端点（Cloudflare 公共 TURN）。 */
const CF_SPEED_CREDS_URL = 'https://speed.cloudflare.com/turn-creds';

/** 该端点会校验来源，必须带上与自家测速页一致的 Referer/Origin。 */
const CF_SPEED_HEADERS = {
  Referer: 'https://speed.cloudflare.com/',
  Origin: 'https://speed.cloudflare.com',
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

/**
 * 取 speed.cloudflare.com 的短时凭据。
 * 该端点返回的形状（`{ urls, username, credential }`）与 Realtime 的 `iceServers`
 * 内层对象一致，故复用 `parseCfRealtime` 的兼容解析。
 */
export async function cloudflareSpeedTurn(): Promise<RTCIceServer | null> {
  try {
    const res = await fetch(CF_SPEED_CREDS_URL, {
      headers: CF_SPEED_HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`${LOG} Cloudflare speed TURN 凭据端点 HTTP ${res.status}，退回 STUN`);
      return null;
    }
    const turn = parseCfRealtime(await res.json());
    if (!turn) console.warn(`${LOG} Cloudflare speed TURN 返回形状不合法，退回 STUN`);
    return turn;
  } catch (err) {
    console.warn(`${LOG} Cloudflare speed TURN 凭据端点不可达，退回 STUN:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 4. 汇总（**顺序即优先级**，勿重排）
// ─────────────────────────────────────────────────────────────────────

/**
 * 按优先级逐级尝试，**永不 reject**。
 *
 * 任何一级失败都只降级、不冒泡 —— 因为「拿不到 TURN 只是弱网下可能连不上」，
 * 而「端点 500 导致客户端拿不到任何 ICE 配置」是「一定连不上」。
 */
export async function resolveIceServers(): Promise<IceServersResponse> {
  const stunServer: RTCIceServer = { urls: getStunUrls() };
  const cachedUntil = Date.now() + CACHE_TTL_MS;

  const stat = staticTurn();
  if (stat) return { iceServers: [stunServer, stat], source: 'static', cachedUntil };

  const realtime = await cloudflareRealtimeTurn();
  if (realtime) {
    return { iceServers: [stunServer, realtime], source: 'cloudflare-realtime', cachedUntil };
  }

  const speed = await cloudflareSpeedTurn();
  if (speed) return { iceServers: [stunServer, speed], source: 'cloudflare', cachedUntil };

  return { iceServers: [stunServer], source: 'stun-only', cachedUntil };
}
