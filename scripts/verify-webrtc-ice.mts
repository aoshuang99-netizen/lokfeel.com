/**
 * WebRTC ICE / TURN 配置门禁
 *
 * 用法：`npm run verify:ice`（退出码 0 = 通过，1 = 有断言失败）
 *
 * ## 为什么需要它
 *
 * 视频通话能否建立，取决于 ICE 配置是否**同时**具备：
 *   · STUN（拿 srflx，直连可用）
 *   · TURN（拿 relay，对称 NAT / 运营商 CGNAT 下的唯一出路）
 *
 * 这条链路上任何一环静默失效，表现都只是"通话连不上"，而不报错：
 *   · 端点忘了鉴权 → 凭据被白嫖（成本风险）
 *   · 上游取不到凭据却不降级 → ICE 配置为空 → **连直连都挂**
 *   · 把 TURN 凭据写进 `NEXT_PUBLIC_*` → 长期凭据进 bundle，等于公开
 *   · 建连前没 await → 拿到 STUN-only，弱网用户随机失败
 *
 * 这类缺陷本机测不出来（我们的网络能直连），必须在测试环境以外的沙箱里用真实 ICE
 * 收集验证（见 `scripts/qa/verify-turn-ice.mjs`）。本门禁负责钉住"结构正确"。
 *
 * @module scripts/verify-webrtc-ice
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra !== undefined ? ` → ${String(extra)}` : ''}`);
  }
}

const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const ROUTE = 'app/api/rtc/ice-servers/route.ts';
const CLIENT = 'lib/rtc/ice-servers-client.ts';
const CONFIG = 'config/webrtc.config.ts';
const UTILS = 'utils/webrtc.ts';
const HOOK = 'hooks/useWebRTC.ts';

// ─── A. 关键文件存在 ────────────────────────────────────────────────

console.log('\nA. 关键文件存在');

for (const rel of [ROUTE, CLIENT, CONFIG, UTILS, HOOK]) {
  ok(`${rel} 存在`, fs.existsSync(path.join(SRC, rel)));
}

// ─── B. 服务端端点：鉴权 / 超时 / 形状校验 / 三级降级 / 缓存 ──────────

console.log('\nB. 服务端端点结构（/api/rtc/ice-servers）');

const route = read(ROUTE);

ok('需要登录态（requireAuth）', /requireAuth\(\)/.test(route));
ok('未登录返回 401', /status:\s*401/.test(route));
ok('上游请求有超时（AbortSignal.timeout）', /AbortSignal\.timeout\(\s*\d+\s*\)/.test(route));
ok('上游响应做形状校验（宁退 STUN 不喂坏配置）', /function parseCloudflare/.test(route) && /typeof o\.username !== 'string'/.test(route));
ok('三级来源：静态覆写 / Cloudflare / 仅 STUN', /'static'/.test(route) && /'cloudflare'/.test(route) && /'stun-only'/.test(route));
ok('上游异常被吞掉并降级（不冒泡成 500）', /catch\s*\(err\)/.test(route) && /stun-only/.test(route));
ok('有服务端缓存（避免每次通话都打上游）', /CACHE_TTL_MS/.test(route) && /cache\s*=\s*\{\s*at:/.test(route));
ok('static 覆写读的是服务端变量（TURN_*，非 NEXT_PUBLIC_*）', /process\.env\.TURN_URLS/.test(route) && !/NEXT_PUBLIC_TURN_CREDENTIAL/.test(route));

// ─── C. 客户端加载器：并发合并 / 兜底 / 形状清洗 ────────────────────

console.log('\nC. 客户端加载器结构');

const client = read(CLIENT);

ok('并发请求被合并（inflight）', /inflight/.test(client) && /if \(inflight\) return inflight/.test(client));
ok('有同步读取接口 getIceServersCached', /export function getIceServersCached/.test(client));
ok('失败退回静态配置（永不 reject）', /return getIceServers\(\)/.test(client) && /catch \(err\)/.test(client));
ok('清洗非法条目（空 urls 不能进 RTCPeerConnection）', /function sanitize/.test(client) && /okUrls/.test(client));
ok('日志会显示是否拿到 TURN（便于线上排查）', /TURN=\$\{hasTurn/.test(client));

// ─── D. 接线：工厂用缓存配置、Hook 建连前 await ─────────────────────

console.log('\nD. 接线正确性');

const utils = read(UTILS);
const hook = read(HOOK);

ok('createPeerConnection 用 getIceServersCached()', /iceServers:\s*getIceServersCached\(\)/.test(utils));
ok('createPeerConnection 不再直接用静态 getIceServers()', !/iceServers:\s*getIceServers\(\)/.test(utils));
ok('useWebRTC 在建连前 await loadIceServers()（两处：发起 + 接听）',
  (hook.match(/await loadIceServers\(\)/g) || []).length >= 2,
  (hook.match(/await loadIceServers\(\)/g) || []).length);
ok('useWebRTC 挂载时预取（不在关键路径上多一次往返）', /void loadIceServers\(\)/.test(hook));

// ─── E. 凭据不得进入前端 bundle ─────────────────────────────────────

console.log('\nE. 凭据隔离');

/** NEXT_PUBLIC_* 会被内联进 bundle —— TURN 凭据绝不能走这条通道。 */
const publicTurnCred = /NEXT_PUBLIC_TURN_(USERNAME|CREDENTIAL)\s*!==?\s*['"]/;
ok('配置里没有把 TURN 凭据当默认方案（仅作兼容注释保留）',
  !/process\.env\.NEXT_PUBLIC_TURN_CREDENTIAL\s*\|\|\s*['"][^'"]+['"]/.test(read(CONFIG)));
ok('（自检）凭据隔离检测式可用', publicTurnCred.test("process.env.NEXT_PUBLIC_TURN_USERNAME !== ''"));

// ─── F. 运行时：失败路径必须降级，不得抛错 ──────────────────────────

console.log('\nF. 运行时失败路径');

const originalFetch = globalThis.fetch;
try {
  const { loadIceServers, getIceServersCached, __resetIceServersCache } = await import(
    '../src/lib/rtc/ice-servers-client'
  );

  // F1. 未预取时同步读取 → 静态兜底（含 STUN，不含 TURN，因为没配 NEXT_PUBLIC_TURN_*）
  __resetIceServersCache();
  const cold = getIceServersCached();
  ok('冷启动同步读取返回非空配置（兜底不空）', Array.isArray(cold) && cold.length > 0);
  ok('冷启动兜底含 STUN', JSON.stringify(cold).includes('stun:'));

  // F2. fetch 抛错 → 仍返回兜底，不 reject
  __resetIceServersCache();
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  const afterError = await loadIceServers();
  ok('fetch 抛错时 loadIceServers 不 reject 且返回兜底', Array.isArray(afterError) && afterError.length > 0);

  // F3. 401 → 兜底
  __resetIceServersCache();
  globalThis.fetch = (async () => new Response('{"error":"Unauthorized"}', { status: 401 })) as typeof fetch;
  const after401 = await loadIceServers();
  ok('端点 401 时退回兜底', Array.isArray(after401) && after401.length > 0);

  // F4. 形状非法（空 urls）→ 清洗掉，退回兜底
  __resetIceServersCache();
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ iceServers: [{ urls: [] }, { urls: 'stun:ok.example:3478' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  const sanitized = await loadIceServers();
  ok('非法条目被清洗，仅保留合法条目', sanitized.length === 1 && JSON.stringify(sanitized).includes('stun:ok.example:3478'), JSON.stringify(sanitized));

  // F5. 正常形状 → TURN 被保留
  __resetIceServersCache();
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        iceServers: [
          { urls: ['stun:stun.cloudflare.com:3478'] },
          { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;
  const withTurn = await loadIceServers();
  ok('合法 TURN 条目被保留并带凭据',
    withTurn.length === 2 && withTurn.some((s) => JSON.stringify(s.urls).includes('turn:') && s.username === 'u'),
    JSON.stringify(withTurn));
} catch (err) {
  fail++;
  console.log(`  ✗ 运行时断言无法执行 → ${err instanceof Error ? err.message : err}`);
} finally {
  globalThis.fetch = originalFetch;
}

// ─── 汇总 ─────────────────────────────────────────────────────────

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  process.exit(1);
}
