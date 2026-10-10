/**
 * TURN 候选配置**切换前**预检（自建 / 托管静态凭据均适用）
 *
 * ## 为什么需要这个脚本
 *
 * 生产切换 TURN 只需写 3 个服务端 env（`TURN_URLS` / `TURN_USERNAME` /
 * `TURN_CREDENTIAL`），代价极低 —— 也正因为低，**很容易在没验证的情况下切上去**，
 * 然后把"对称 NAT 打不通"这个问题从 Cloudflare 兜底状态换成更差的坏状态：
 * 旧路径（`speed.cloudflare.com/turn-creds`）是好的，新路径配错后 `staticTurn()`
 * 会**优先生效**，直接顶掉可用的兜底。
 *
 * 所以本脚本的定位是：**把你即将粘贴进 Netlify 的那串值，原样测一遍**。
 * 读的就是同名 env，不另造参数名，避免"测的和贴的不是一个东西"。
 *
 * ## 它证明什么（只有真环境能证明的）
 *
 *   1. 形状合法（scheme / 端口 / transport / 凭据非空 / 无 `NEXT_PUBLIC_` 误用）
 *   2. 该 TURN 凭据**真的能分配**中继地址 —— 真实 Chrome 里逐条 URL 建 PC，
 *      收集到 `typ relay` 才算过（静态断言、语法检查都证明不了这件事）
 *   3. STUN 仍可用（STUN 挂了会让 relay 使用率从 ~15% 涨到 100%，这是最贵的静默故障）
 *   4. 凭据没有泄露进前端 bundle（若同时设了 `NEXT_PUBLIC_TURN_CREDENTIAL`）
 *
 * ⚠️ 本脚本**只读**：不写任何环境变量、不改代码、不动生产数据。
 *
 * 用法：
 *   TURN_URLS="turn:t.example.com:3478?transport=udp,turn:t.example.com:443?transport=tcp" \
 *   TURN_USERNAME=myuser TURN_CREDENTIAL=mypass \
 *   node scripts/qa/verify-turn-candidate.mjs
 *
 * 可选：
 *   QA_BASE=https://app.lokfeel.com   用于 bundle 泄露检查与 RTCPeerConnection 兜底页
 *   QA_SKIP_BUNDLE=1                  跳过第 4 节（离线环境用）
 *   QA_ALLOW_PARTIAL_RELAY=1          逐条 URL 失败降级为 ⚠️（受限网络里 UDP 常被拦），
 *                                     硬门槛「至少一条可分配中继」仍然生效
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'https://app.lokfeel.com';
const SKIP_BUNDLE = process.env.QA_SKIP_BUNDLE === '1';
/**
 * 允许"部分传输方式不可用"仍判通过（**默认关闭**）。
 *
 * 为什么需要：本节[B]的逐条 URL 探针是**诊断**（"哪一个传输方式挂了"），
 * 但它同时受**本机网络**影响。在被审查/受限网络里，UDP 3478 的 DNS 解析
 * （`701 STUN host lookup received error`）会**间歇**失败，而 TCP/5349 稳定可用
 * —— 2026-10-10 实测：同一条 UDP URL 三次里两成两通过、一次挂。
 * 这种失败**不是配置缺陷**（Chrome 会自动从候选里挑能用的那条，多列一条被拦的
 * UDP 无害），把它当硬失败会让"配好了却永远过不了预检"。
 *
 * 真正的硬门槛是下面那条聚合断言「至少一条 URL 可分配中继」——**它永远生效**。
 * 打开本开关 = 逐条失败降级为 ⚠️ 并列出降级清单；全挂仍然 ❌。
 * 用法：`QA_ALLOW_PARTIAL_RELAY=1 node scripts/qa/verify-turn-candidate.mjs`
 */
const ALLOW_PARTIAL = process.env.QA_ALLOW_PARTIAL_RELAY === '1';

const URLS_RAW = process.env.TURN_URLS || '';
const USERNAME = process.env.TURN_USERNAME || '';
const CREDENTIAL = process.env.TURN_CREDENTIAL || '';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
}
function warn(msg) {
  console.log(`  ⚠️  ${msg}`);
}

// ═══════════════════════════════════════════════════════════════════
// [A] 形状校验 —— 不需要网络，先把"一眼假"的配置挡掉
// ═══════════════════════════════════════════════════════════════════
console.log('\n[A] 配置形状');

const entries = URLS_RAW.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

check('TURN_URLS 非空', entries.length > 0, `${entries.length} 条`);
check('TURN_USERNAME 非空', !!USERNAME, USERNAME ? `${USERNAME.slice(0, 4)}…` : '空');
check('TURN_CREDENTIAL 非空', !!CREDENTIAL, CREDENTIAL ? `len=${CREDENTIAL.length}` : '空');

if (CREDENTIAL && CREDENTIAL.length < 12) {
  warn(`凭据长度仅 ${CREDENTIAL.length}，建议 ≥ 12 位（否则易被撞库，中继免费送人）`);
}

/** 解析 `turn:host:port?transport=udp` / `turns:host:port`。 */
function parseTurnUrl(raw) {
  const m = /^(turns?):([^:?]+)(?::(\d+))?(?:\?(.+))?$/.exec(raw);
  if (!m) return null;
  const [, scheme, host, portStr, query] = m;
  const params = {};
  if (query) {
    for (const kv of query.split('&')) {
      const [k, v] = kv.split('=');
      if (k) params[k.toLowerCase()] = (v ?? '').toLowerCase();
    }
  }
  // turns: 默认 TLS/TCP 5349；turn: 默认 UDP 3478
  const defaultPort = scheme === 'turns' ? 5349 : 3478;
  return {
    scheme,
    host,
    port: portStr ? Number(portStr) : defaultPort,
    portExplicit: !!portStr,
    transport: params.transport || (scheme === 'turns' ? 'tcp' : 'udp'),
    params,
  };
}

const parsed = [];
const stunEntries = [];
for (const raw of entries) {
  // stun: 条目单列 —— 混在里面**是合法的**（WebRTC 允许一个 iceServer 混合
  // stun/turn urls，凭据只作用于 turn 那几条；Cloudflare 官方返回就是这样）。
  // 真正危险的是"全是 stun"，见下方聚合断言。
  if (/^stuns?:/i.test(raw)) {
    stunEntries.push(raw);
    continue;
  }
  const p = parseTurnUrl(raw);
  if (!p) {
    check(`条目格式合法：${raw}`, false, '应为 turn:host:port?transport=udp 或 turns:host:port');
    continue;
  }
  parsed.push({ raw, ...p });
  const detail = `${p.scheme} ${p.host}:${p.port}/${p.transport}`;
  const portOk = Number.isInteger(p.port) && p.port > 0 && p.port <= 65535;
  check(`条目格式合法：${raw}`, portOk, portOk ? detail : `端口非法 ${p.port}`);
  if (/\s/.test(raw)) check(`条目无空白字符：${raw}`, false, '含空格/制表符，逗号分隔容易被肉眼忽略');
  if (p.scheme === 'turns' && p.transport === 'udp') {
    warn(`${raw}：turns: 走 TLS，transport=udp 无意义（浏览器会忽略）`);
  }
  if (!p.portExplicit) {
    warn(`${raw}：未显式写端口，按默认 ${p.port} 处理；建议写全以免歧义`);
  }
}

// 重复条目
const dupes = entries.filter((e, i) => entries.indexOf(e) !== i);
check('无重复条目', dupes.length === 0, dupes.length ? dupes.join(' / ') : '');

// ⚠️ 最危险的一条：全是 stun 也会让 staticTurn() 非空 → source='static'
//    → 顶掉可用的 Cloudflare 兜底，却一条中继都提供不了。
check('TURN_URLS 至少含一条 turn:/turns:', parsed.length > 0,
  parsed.length > 0 ? `${parsed.length} 条 turn/turns` : '🔴 全是 stun：会顶掉 Cloudflare 兜底且不提供任何中继');

if (stunEntries.length > 0) {
  warn(`含 ${stunEntries.length} 条 stun: 条目（${stunEntries.join(', ')}）—— 合法但冗余，` +
    `STUN 已由 getStunUrls() 单独下发，建议从 TURN_URLS 里剔除`);
}

// 抗封 UDP：生产建议至少一条 TCP/TLS(443)
const hasTcpOrTlsFallback = parsed.some(
  (p) => p.transport === 'tcp' || p.scheme === 'turns' || p.port === 443 || p.port === 80
);
check('含 TCP/TLS 备用通道（应对 UDP 被封的网络）', hasTcpOrTlsFallback,
  hasTcpOrTlsFallback ? '' : '只有 UDP：企业网/部分移动网络封 UDP 时通话会直接失败，建议加 turns:host:443');

// 误用 NEXT_PUBLIC_*
const publicLeak = ['NEXT_PUBLIC_TURN_CREDENTIAL', 'NEXT_PUBLIC_TURN_USERNAME'].filter(
  (k) => process.env[k]
);
check('未同时使用 NEXT_PUBLIC_TURN_*（凭据会内联进 bundle）', publicLeak.length === 0,
  publicLeak.length ? `请删除：${publicLeak.join(', ')}` : '');

if (entries.length === 0 || !USERNAME || !CREDENTIAL) {
  console.log('\n配置不完整，跳过联网验证（这本身就是 ❌：切上去会顶掉现有的 Cloudflare 兜底）');
  console.log(`\n════════ 结果：${results.filter((r) => r.ok).length} 通过 / ${results.filter((r) => !r.ok).length} 失败 ════════`);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════
// 启动浏览器
// ═══════════════════════════════════════════════════════════════════
const LAUNCH_ARGS = [
  '--no-proxy-server', // 沙箱透明代理会污染 ICE，必须绕开
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
];

async function launchBrowser() {
  const errors = [];
  for (const opts of [{ channel: 'chrome', args: LAUNCH_ARGS }, { args: LAUNCH_ARGS }]) {
    try {
      const b = await chromium.launch(opts);
      console.log(`\n浏览器: ${opts.channel ? '系统 Chrome' : '内置 Chromium'}`);
      return b;
    } catch (e) {
      errors.push(`${opts.channel || 'chromium'}: ${e.message.split('\n')[0]}`);
    }
  }
  throw new Error('无法启动浏览器:\n  ' + errors.join('\n  '));
}

const browser = await launchBrowser();
const ctx = await browser.newContext();
const page = await ctx.newPage();

// data: 页即可构造 RTCPeerConnection；不行则退回真实站点
await page.goto('data:text/html,<html><body>ice probe</body></html>');
const hasRtc = await page.evaluate(() => typeof RTCPeerConnection !== 'undefined');
if (!hasRtc) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
}

/**
 * 用给定配置收集 ICE 候选。
 *
 * 注意 `iceTransportPolicy: 'relay'` —— 这里**故意**强制走中继，因为本节目的就是
 * 证明"中继本身可用"。生产**绝不能**带这个参数，否则 100% 通话走 relay，
 * 带宽费用成倍（见 docs/TURN-SELF-HOST-SWITCH-2026-10-09.md 的"成本闸门"）。
 */
async function gatherOne(server, waitMs = 9000) {
  return page.evaluate(async ({ srv, waitMs }) => {
    const out = { cands: [], errors: [] };
    const pc = new RTCPeerConnection({ iceServers: [srv], iceTransportPolicy: 'relay' });
    pc.createDataChannel('probe');
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const c = e.candidate.candidate;
      out.cands.push({
        typ: (c.match(/typ (\w+)/) || [])[1] || '?',
        proto: (c.match(/ (udp|tcp) /) || [])[1] || '?',
      });
    };
    pc.onicecandidateerror = (e) =>
      out.errors.push(`${e.errorCode} ${e.errorText}${e.url ? ' @' + e.url : ''}`);
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((r) => setTimeout(r, waitMs));
    } catch (err) {
      out.fatal = String(err);
    }
    pc.close();
    return out;
  }, { srv: server, waitMs });
}

// ═══════════════════════════════════════════════════════════════════
// [B] 逐条 URL 的真实分配测试 —— 定位"哪一个传输方式挂了"
// ═══════════════════════════════════════════════════════════════════
console.log('\n[B] 真实 Chrome 中继分配（逐条 URL）');

const perUrl = [];
const degraded = [];
for (const p of parsed) {
  const t0 = Date.now();
  const r = await gatherOne({ urls: p.raw, username: USERNAME, credential: CREDENTIAL });
  const ms = Date.now() - t0;
  const relay = r.cands.filter((c) => c.typ === 'relay');
  perUrl.push({ raw: p.raw, relay: relay.length, ms, errors: r.errors, fatal: r.fatal });
  const label = `${p.raw}  (relay=${relay.length}, ${ms}ms)`;
  const why = r.fatal ? `FATAL ${r.fatal}` : r.errors[0] || '无 relay 候选，凭据或防火墙有问题';
  if (relay.length > 0) {
    check(`可分配中继：${label}`, true, relay.map((c) => c.proto).join('/'));
  } else if (ALLOW_PARTIAL) {
    warn(`未分配中继（已容忍，QA_ALLOW_PARTIAL_RELAY=1）：${label} — ${why}`);
    degraded.push(p.raw);
  } else {
    check(`可分配中继：${label}`, false, why);
  }
}

// 至少一种传输可用
const anyRelay = perUrl.some((u) => u.relay > 0);
check('至少一条 URL 可分配中继', anyRelay,
  anyRelay ? '' : '全部失败：检查凭据、realm、3478/udp+tcp 与中继端口段是否放行');

// ═══════════════════════════════════════════════════════════════════
// [C] STUN 仍可用 —— 防"relay 使用率被 STUN 故障推高"的静默成本
// ═══════════════════════════════════════════════════════════════════
console.log('\n[C] STUN 可达性（决定 relay 使用率高低）');
const stunProbe = await page.evaluate(async () => {
  const out = { srflx: 0, errors: [] };
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
  });
  pc.createDataChannel('probe');
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    if (/typ srflx/.test(e.candidate.candidate)) out.srflx++;
  };
  pc.onicecandidateerror = (e) => out.errors.push(`${e.errorCode} ${e.errorText}`);
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((r) => setTimeout(r, 8000));
  } catch (err) {
    out.fatal = String(err);
  }
  pc.close();
  return out;
});
check('STUN 返回 srflx 候选', stunProbe.srflx > 0,
  stunProbe.srflx > 0 ? `${stunProbe.srflx} 条` : (stunProbe.errors[0] || 'STUN 不可达 → relay 使用率会飙到 100%，带宽费成倍'));

// ═══════════════════════════════════════════════════════════════════
// [D] 凭据泄露检查 —— 不允许出现在前端 bundle
// ═══════════════════════════════════════════════════════════════════
console.log('\n[D] 凭据泄露检查（前端 bundle）');
if (SKIP_BUNDLE) {
  warn('QA_SKIP_BUNDLE=1，已跳过');
} else {
  try {
    const html = await (await ctx.request.get(`${BASE}/login`)).text();
    const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((s) => s.startsWith('/'))
      .slice(0, 60);

    let leaked = [];
    const scan = async (src) => {
      try {
        const txt = await (await ctx.request.get(`${BASE}${src}`)).text();
        if (CREDENTIAL && CREDENTIAL.length >= 8 && txt.includes(CREDENTIAL)) {
          leaked.push(`${src} (含 credential)`);
        } else if (USERNAME && USERNAME.length >= 8 && txt.includes(USERNAME)) {
          // username 太短（如 "user"）会误报，故只对 ≥8 位的做子串匹配
          leaked.push(`${src} (含 username)`);
        }
      } catch {
        /* 单个 chunk 取不到不算失败 */
      }
    };
    for (let i = 0; i < srcs.length; i += 8) {
      await Promise.all(srcs.slice(i, i + 8).map(scan));
    }
    check(`凭据未出现在前端 chunk（扫描 ${srcs.length} 个）`, leaked.length === 0,
      leaked.length ? `🔴 泄露于：${leaked.slice(0, 3).join(', ')}` : '');
  } catch (err) {
    warn(`bundle 扫描跳过（${err instanceof Error ? err.message.split('\n')[0] : err}）`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 汇总
// ═══════════════════════════════════════════════════════════════════
const failed = results.filter((r) => !r.ok);
console.log(`\n════════ 结果：${results.length - failed.length} 通过 / ${failed.length} 失败 ════════`);
if (degraded.length > 0) {
  console.log(
    `\n⚠️  容忍了 ${degraded.length} 条不可用传输方式（QA_ALLOW_PARTIAL_RELAY=1）：\n` +
      degraded.map((u) => `     · ${u}`).join('\n') +
      '\n   → 不影响可用性：客户端会在候选里自动挑能用的那条；' +
      '\n     但请确认这些失败是**本机网络**所致（如 UDP 被拦/ DNS 污染），而非凭据或端口配置错。'
  );
}
if (failed.length === 0) {
  console.log('\n✅ 可以切换：3 个 env 写入生产后，跑 scripts/qa/verify-turn-prod.mjs 复核\n');
} else {
  console.log('\n❌ 不要切换。当前 Cloudflare 兜底是好状态，配上坏 static 会把它顶掉。');
  console.log('   待修：' + failed.map((f) => f.name).join(' | ') + '\n');
}
await browser.close();
process.exit(failed.length > 0 ? 1 : 0);
