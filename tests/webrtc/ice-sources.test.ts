/**
 * ICE 来源解析测试
 *
 * 覆盖 `src/lib/rtc/ice-sources.ts` 的：
 *   A. staticTurn          —— 服务端静态覆写（路径 A/B）
 *   B. parseCfRealtime     —— Cloudflare Realtime TURN 响应形状（含三种兼容形态）
 *   C. cloudflareRealtimeTurn —— 签发调用 / 降级
 *   D. cloudflareSpeedTurn —— 免注册兜底的降级
 *   E. resolveIceServers   —— **优先级顺序**（本轮改造的核心不变量）
 *
 * 为什么优先级必须被钉死：第 2/3 级都是「有则更好、无则降级」，一旦重排成
 * 「上游优先」，Cloudflare 不可达时**本可用的静态配置会被跳过** ——
 * 等于把可用状态换成更差的状态，且没有任何报错。
 */

import {
  staticTurn,
  parseCfRealtime,
  cloudflareRealtimeTurn,
  cloudflareSpeedTurn,
  resolveIceServers,
  CACHE_TTL_MS,
  CF_REALTIME_TTL_SECONDS,
} from '@/lib/rtc/ice-sources';

// ────────────────────────────────────────────────────────────────────
// 工具
// ────────────────────────────────────────────────────────────────────

const ENV_KEYS = [
  'TURN_URLS',
  'TURN_USERNAME',
  'TURN_CREDENTIAL',
  'TURN_TOKEN_ID',
  'TURN_API_TOKEN',
] as const;

let originalEnv: NodeJS.ProcessEnv;
const originalFetch = globalThis.fetch;

/** 构造最小可用的 fetch 响应替身（不依赖全局 Response，避免环境差异）。 */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  originalEnv = { ...process.env };
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────────
// A. staticTurn
// ────────────────────────────────────────────────────────────────────

describe('A. staticTurn（服务端静态覆写）', () => {
  it('三项齐全时返回单条 iceServer，urls 按逗号拆分并去空白', () => {
    process.env.TURN_URLS = ' turn:a.example:3478?transport=udp , turns:b.example:5349 ';
    process.env.TURN_USERNAME = 'lokfeel';
    process.env.TURN_CREDENTIAL = 'secret';

    const s = staticTurn();
    expect(s).not.toBeNull();
    expect(s!.urls).toEqual(['turn:a.example:3478?transport=udp', 'turns:b.example:5349']);
    expect(s!.username).toBe('lokfeel');
    expect(s!.credential).toBe('secret');
  });

  it('缺 credential 时返回 null（只配 URL 是更差的状态，必须视为未配置）', () => {
    process.env.TURN_URLS = 'turn:a.example:3478';
    process.env.TURN_USERNAME = 'lokfeel';
    expect(staticTurn()).toBeNull();
  });

  it('缺 username 时返回 null', () => {
    process.env.TURN_URLS = 'turn:a.example:3478';
    process.env.TURN_CREDENTIAL = 'secret';
    expect(staticTurn()).toBeNull();
  });

  it('urls 为空串时返回 null', () => {
    process.env.TURN_URLS = '   ';
    process.env.TURN_USERNAME = 'u';
    process.env.TURN_CREDENTIAL = 'c';
    expect(staticTurn()).toBeNull();
  });

  it('未配置任何 env 时返回 null', () => {
    expect(staticTurn()).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// B. parseCfRealtime
// ────────────────────────────────────────────────────────────────────

describe('B. parseCfRealtime（Cloudflare Realtime 响应形状）', () => {
  const urls = [
    'stun:stun.cloudflare.com:3478',
    'turn:turn.cloudflare.com:3478?transport=udp',
    'turns:turn.cloudflare.com:5349?transport=tcp',
  ];

  it('官方形态 { iceServers: { urls[], username, credential } }', () => {
    const r = parseCfRealtime({ iceServers: { urls, username: 'u', credential: 'c' } });
    expect(r).toEqual({ urls, username: 'u', credential: 'c' });
  });

  it('urls 为单个字符串时被包装成数组', () => {
    const r = parseCfRealtime({ iceServers: { urls: 'turn:t.example:3478', username: 'u', credential: 'c' } });
    expect(r!.urls).toEqual(['turn:t.example:3478']);
  });

  it('数组形态 { iceServers: [ {...} ] } 取第一个可用项', () => {
    const r = parseCfRealtime({ iceServers: [{ urls: [] }, { urls, username: 'u', credential: 'c' }] });
    expect(r!.username).toBe('u');
  });

  it('直接给出 { urls, username, credential } 也兼容', () => {
    const r = parseCfRealtime({ urls, username: 'u', credential: 'c' });
    expect(r!.urls).toEqual(urls);
  });

  it('保留混入的 stun: 条目（合法：一个 iceServer 可混合 stun/turn）', () => {
    const r = parseCfRealtime({ iceServers: { urls, username: 'u', credential: 'c' } });
    expect(r!.urls.some((u) => u.startsWith('stun:'))).toBe(true);
    expect(r!.urls.some((u) => u.startsWith('turn'))).toBe(true);
  });

  it('缺 username → null', () => {
    expect(parseCfRealtime({ iceServers: { urls, credential: 'c' } })).toBeNull();
  });

  it('缺 credential → null', () => {
    expect(parseCfRealtime({ iceServers: { urls, username: 'u' } })).toBeNull();
  });

  it('urls 为空数组 → null', () => {
    expect(parseCfRealtime({ iceServers: { urls: [], username: 'u', credential: 'c' } })).toBeNull();
  });

  it('非对象输入 → null（不抛错）', () => {
    for (const bad of [null, undefined, 'str', 42, []]) {
      expect(parseCfRealtime(bad)).toBeNull();
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// C. cloudflareRealtimeTurn
// ────────────────────────────────────────────────────────────────────

describe('C. cloudflareRealtimeTurn（Realtime 签发）', () => {
  const body = {
    iceServers: {
      urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp'],
      username: 'user-token',
      credential: 'pass-token',
    },
  };

  it('未配置 env 时返回 null 且**不发起任何网络请求**', async () => {
    const spy = jest.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    expect(await cloudflareRealtimeTurn()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('只配了 TURN_TOKEN_ID（缺 API_TOKEN）时不发请求', async () => {
    process.env.TURN_TOKEN_ID = 'key-id';
    const spy = jest.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    expect(await cloudflareRealtimeTurn()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('成功：POST 到正确端点，带 Bearer 与 ttl，并返回凭据', async () => {
    process.env.TURN_TOKEN_ID = 'key-id-123';
    process.env.TURN_API_TOKEN = 'api-token-secret';

    const spy = jest.fn(async () => jsonResponse(body));
    globalThis.fetch = spy as unknown as typeof fetch;

    const r = await cloudflareRealtimeTurn();
    expect(r).toEqual({ urls: body.iceServers.urls, username: 'user-token', credential: 'pass-token' });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key-id-123/credentials/generate');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer api-token-secret');
    expect(JSON.parse(String(init.body))).toEqual({ ttl: CF_REALTIME_TTL_SECONDS });
  });

  it('上游 401 → 返回 null（降级，不抛错）', async () => {
    process.env.TURN_TOKEN_ID = 'k';
    process.env.TURN_API_TOKEN = 't';
    globalThis.fetch = (async () => jsonResponse({}, 401)) as unknown as typeof fetch;

    expect(await cloudflareRealtimeTurn()).toBeNull();
  });

  it('上游抛错（网络失败）→ 返回 null（降级，不抛错）', async () => {
    process.env.TURN_TOKEN_ID = 'k';
    process.env.TURN_API_TOKEN = 't';
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    expect(await cloudflareRealtimeTurn()).toBeNull();
  });

  it('上游返回形状不合法 → 返回 null', async () => {
    process.env.TURN_TOKEN_ID = 'k';
    process.env.TURN_API_TOKEN = 't';
    globalThis.fetch = (async () => jsonResponse({ iceServers: { urls: [] } })) as unknown as typeof fetch;

    expect(await cloudflareRealtimeTurn()).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// D. cloudflareSpeedTurn
// ────────────────────────────────────────────────────────────────────

describe('D. cloudflareSpeedTurn（免注册兜底）', () => {
  const body = {
    urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp'],
    username: 'u',
    credential: 'c',
  };

  it('成功时返回凭据，且带上测速页来源头', async () => {
    const spy = jest.fn(async () => jsonResponse(body));
    globalThis.fetch = spy as unknown as typeof fetch;

    const r = await cloudflareSpeedTurn();
    expect(r).toEqual({ urls: body.urls, username: 'u', credential: 'c' });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://speed.cloudflare.com/turn-creds');
    expect((init.headers as Record<string, string>).Referer).toBe('https://speed.cloudflare.com/');
  });

  it('非 200 → null', async () => {
    globalThis.fetch = (async () => jsonResponse({}, 503)) as unknown as typeof fetch;
    expect(await cloudflareSpeedTurn()).toBeNull();
  });

  it('抛错 → null', async () => {
    globalThis.fetch = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    expect(await cloudflareSpeedTurn()).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// E. resolveIceServers —— 优先级（核心不变量）
// ────────────────────────────────────────────────────────────────────

describe('E. resolveIceServers（来源优先级）', () => {
  const realtimeBody = {
    iceServers: { urls: ['turn:turn.cloudflare.com:3478'], username: 'rt-u', credential: 'rt-c' },
  };
  const speedBody = { urls: ['turn:turn.cloudflare.com:3478'], username: 'sp-u', credential: 'sp-c' };

  it('第 1 级命中：static 生效，且**完全不发起网络请求**', async () => {
    process.env.TURN_URLS = 'turn:self.example:3478';
    process.env.TURN_USERNAME = 'me';
    process.env.TURN_CREDENTIAL = 'pw';
    const spy = jest.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    const r = await resolveIceServers();
    expect(r.source).toBe('static');
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(r.iceServers)).toContain('turn:self.example:3478');
  });

  it('第 2 级命中：source=cloudflare-realtime，且**不再调用 speed 兜底**', async () => {
    process.env.TURN_TOKEN_ID = 'k';
    process.env.TURN_API_TOKEN = 't';
    const spy = jest.fn(async (url: string) => (String(url).includes('rtc.live.cloudflare.com') ? jsonResponse(realtimeBody) : jsonResponse(speedBody)));
    globalThis.fetch = spy as unknown as typeof fetch;

    const r = await resolveIceServers();
    expect(r.source).toBe('cloudflare-realtime');
    expect(spy).toHaveBeenCalledTimes(1); // 未打 speed 端点
  });

  it('第 2 级失败 → 落到第 3 级 speed，source=cloudflare', async () => {
    process.env.TURN_TOKEN_ID = 'k';
    process.env.TURN_API_TOKEN = 't';
    const spy = jest.fn(async (url: string) =>
      String(url).includes('rtc.live.cloudflare.com') ? jsonResponse({}, 401) : jsonResponse(speedBody)
    );
    globalThis.fetch = spy as unknown as typeof fetch;

    const r = await resolveIceServers();
    expect(r.source).toBe('cloudflare');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('未配 Realtime env → 直接走 speed（Realtime 端点一次都不该被打）', async () => {
    const spy = jest.fn(async () => jsonResponse(speedBody));
    globalThis.fetch = spy as unknown as typeof fetch;

    const r = await resolveIceServers();
    expect(r.source).toBe('cloudflare');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toBe('https://speed.cloudflare.com/turn-creds');
  });

  it('全部失败 → stun-only，但 iceServers **非空**（直连仍可用，绝不返回空配置）', async () => {
    globalThis.fetch = (async () => {
      throw new Error('all down');
    }) as unknown as typeof fetch;

    const r = await resolveIceServers();
    expect(r.source).toBe('stun-only');
    expect(r.iceServers.length).toBe(1);
    expect(JSON.stringify(r.iceServers)).toContain('stun:');
  });

  it('任何来源下 iceServers 首项都是 STUN（srflx 是一切的起点）', async () => {
    globalThis.fetch = (async () => jsonResponse(speedBody)) as unknown as typeof fetch;
    const r = await resolveIceServers();
    expect(JSON.stringify(r.iceServers[0].urls)).toContain('stun:');
  });

  it('cachedUntil ≈ now + CACHE_TTL_MS', async () => {
    const before = Date.now();
    globalThis.fetch = (async () => jsonResponse(speedBody)) as unknown as typeof fetch;
    const r = await resolveIceServers();
    expect(r.cachedUntil).toBeGreaterThanOrEqual(before + CACHE_TTL_MS);
    expect(r.cachedUntil).toBeLessThanOrEqual(Date.now() + CACHE_TTL_MS);
  });

  it('凭据 TTL 必须明显大于缓存期（否则缓存命中的客户端会拿到已失效凭据）', () => {
    expect(CF_REALTIME_TTL_SECONDS * 1000).toBeGreaterThan(CACHE_TTL_MS * 2);
  });
});
