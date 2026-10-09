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
const SOURCES = 'lib/rtc/ice-sources.ts';
const CLIENT = 'lib/rtc/ice-servers-client.ts';
const CONFIG = 'config/webrtc.config.ts';
const UTILS = 'utils/webrtc.ts';
const HOOK = 'hooks/useWebRTC.ts';

// ─── A. 关键文件存在 ────────────────────────────────────────────────

console.log('\nA. 关键文件存在');

for (const rel of [ROUTE, SOURCES, CLIENT, CONFIG, UTILS, HOOK]) {
  ok(`${rel} 存在`, fs.existsSync(path.join(SRC, rel)));
}

// ─── B. 路由：薄层（鉴权 / 缓存 / 委派） ─────────────────────────────

console.log('\nB. 路由结构（/api/rtc/ice-servers，应只是薄层）');

const route = read(ROUTE);

ok('需要登录态（requireAuth）', /requireAuth\(\)/.test(route));
ok('未登录返回 401', /status:\s*401/.test(route));
ok('有服务端缓存（避免每次通话都打上游）', /cache\s*=\s*\{\s*at:/.test(route) && /Date\.now\(\)\s*<\s*cache\.at/.test(route));
ok('缓存命中/未命中可观测（x-ice-cache）', /x-ice-cache/.test(route) && /'hit'/.test(route) && /'miss'/.test(route));
ok('来源解析已委派给 lib/rtc/ice-sources（路由不再内联上游逻辑）',
  /resolveIceServers/.test(route) && !/speed\.cloudflare\.com/.test(route));

// ─── B2. 来源模块：四级优先级 / 超时 / 形状校验 / 降级 ────────────────

console.log('\nB2. 来源模块结构（lib/rtc/ice-sources.ts）');

const sources = read(SOURCES);

ok('上游请求有超时（AbortSignal.timeout）', /AbortSignal\.timeout\(\s*[\w.]+\s*\)/.test(sources));
ok('四个来源齐备：static / cloudflare-realtime / cloudflare / stun-only',
  /'static'/.test(sources) &&
    /'cloudflare-realtime'/.test(sources) &&
    /'cloudflare'/.test(sources) &&
    /'stun-only'/.test(sources));
ok('上游异常被吞掉并降级（不冒泡成 500）', (sources.match(/catch\s*\(err\)/g) || []).length >= 2 && /stun-only/.test(sources));
ok('static 覆写读的是服务端变量（TURN_*，非 NEXT_PUBLIC_*）',
  /process\.env\.TURN_URLS/.test(sources) && !/NEXT_PUBLIC_TURN_CREDENTIAL/.test(sources));
ok('Realtime 读的是服务端变量（TURN_TOKEN_ID / TURN_API_TOKEN）',
  /process\.env\.TURN_TOKEN_ID/.test(sources) && /process\.env\.TURN_API_TOKEN/.test(sources) &&
    !/NEXT_PUBLIC_TURN_TOKEN/.test(sources) && !/NEXT_PUBLIC_TURN_API_TOKEN/.test(sources));
/**
 * 端点归属：签发走 Realtime 数据面（rtc.live.cloudflare.com），
 * 而不是控制面 api.cloudflare.com —— 后者只在**一次性创建 Key** 时用
 * （`scripts/setup-cloudflare-turn.mjs`），绝不该出现在运行时热路径上。
 * 断言精确匹配常量与 fetch 实参，避免被注释里的域名误命中。
 */
const realtimeUrl = sources.match(/CF_REALTIME_KEYS_URL\s*=\s*'([^']+)'/);
ok('Realtime 签发端点指向 rtc.live.cloudflare.com（数据面）',
  !!realtimeUrl && realtimeUrl[1].startsWith('https://rtc.live.cloudflare.com/'),
  realtimeUrl ? realtimeUrl[1] : '(未找到常量)');
ok('控制面 api.cloudflare.com 未出现在运行时 fetch 路径上',
  !/fetch\(\s*[`'"]https:\/\/api\.cloudflare\.com/.test(sources));
ok('签发请求走 POST 且带 ttl', /method:\s*'POST'/.test(sources) && /ttl:\s*CF_REALTIME_TTL_SECONDS/.test(sources));

/**
 * 优先级顺序：static → cloudflare-realtime → cloudflare(speed) → stun-only。
 *
 * 机械判据：在 `resolveIceServers` 的**函数体内**，三个来源调用的出现次序
 * 必须与上面一致。重排会静默降级（上游挂了就不再看静态配置），必须钉死。
 */
const resolveBody = sources.slice(sources.indexOf('export async function resolveIceServers'));
const iStatic = resolveBody.indexOf('staticTurn()');
const iRealtime = resolveBody.indexOf('cloudflareRealtimeTurn()');
const iSpeed = resolveBody.indexOf('cloudflareSpeedTurn()');
ok('来源优先级为 static → cloudflare-realtime → cloudflare(speed) → stun-only',
  iStatic > -1 && iRealtime > iStatic && iSpeed > iRealtime,
  `static@${iStatic} realtime@${iRealtime} speed@${iSpeed}`);
ok('resolveIceServers 放在文件末尾（保证上面的顺序断言只看函数体）',
  sources.lastIndexOf('export async function resolveIceServers') > sources.lastIndexOf('async function cloudflareSpeedTurn'));

/**
 * 凭据 TTL 必须明显大于缓存期，否则「缓存命中的客户端拿到已失效凭据」→
 * 配置里有 TURN 却拿不到 relay，且无任何报错。
 */
const ttlMatch = sources.match(/CF_REALTIME_TTL_SECONDS\s*=\s*(\d+)/);
const cacheMatch = sources.match(/CACHE_TTL_MS\s*=\s*(\d+(?:\s*\*\s*\d+)*)/);
ok('凭据 TTL 与缓存期均被显式定义', !!ttlMatch && !!cacheMatch);
if (ttlMatch && cacheMatch) {
  const ttlSec = Number(ttlMatch[1]);
  const cacheMs = cacheMatch[1]
    .split('*')
    .map((s) => Number(s.trim()))
    .reduce((a, b) => a * b, 1);
  ok('凭据 TTL > 2× 缓存期（防「缓存命中却凭据失效」）',
    ttlSec * 1000 > cacheMs * 2,
    `${ttlSec}s vs ${cacheMs}ms`);
}

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

/** 递归拼接 src 下所有 TS 文件内容，用于**跨文件**扫描（单文件正则会被搬到别处绕过）。 */
function readAll(dir: string): string {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(readAll(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(fs.readFileSync(p, 'utf8'));
  }
  return out.join('\n');
}

const allSrc = readAll(SRC);

/**
 * 本轮新引入的两个机密（TURN_TOKEN_ID / TURN_API_TOKEN）**只允许**走服务端命名空间。
 * 一旦有人图省事写成 NEXT_PUBLIC_*，凭据会永久内联进前端 bundle：
 * 任何人打开 DevTools 都能拿到，中继账单变成别人在花，且**改 env 也撤不回已发布的包**。
 */
ok('Realtime 机密未进入 NEXT_PUBLIC_* 命名空间（全 src 扫描）',
  !/NEXT_PUBLIC_TURN_(API_TOKEN|TOKEN_ID)/.test(allSrc));
ok('签发端点未出现在任何客户端模块（只允许留在服务端来源模块）',
  ![CLIENT, CONFIG, UTILS, HOOK].some((f) => /rtc\.live\.cloudflare\.com/.test(read(f))));

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
