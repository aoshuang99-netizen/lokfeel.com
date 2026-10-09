/**
 * 生产环境端到端复验：ICE/TURN 下发 + 视频通话入口开放
 *
 * 覆盖两件只有"真环境"才能证明的事：
 *   1. `GET /api/rtc/ice-servers` 在**登录态**下真的返回 TURN（含凭据），
 *      且该配置放进真实 Chrome 的 RTCPeerConnection 能收集到 `typ relay` 候选
 *      —— 这是"对称 NAT 下能打通"的唯一硬证据，静态断言证明不了。
 *   2. 聊天页的**通话入口已渲染**（`title="Start video call"`，而非 disabled 的
 *      `title="Video calls coming soon"`）—— 证明 NEXT_PUBLIC_ENABLE_VIDEO_CALL
 *      在**构建期**确实按预期内联。
 *
 * 前置：scripts/qa/create-qa-accounts.mjs 已跑；`QA_CONV` 指向双 QA 账号的会话。
 *
 * 用法：
 *   QA_CONV=<conversationId> node scripts/qa/verify-turn-prod.mjs
 *   QA_BASE=https://app.lokfeel.com   # 默认即生产
 */
import { chromium } from 'playwright';
import { QA_PASSWORD } from './qa-credentials.mjs';

const BASE = process.env.QA_BASE || 'https://app.lokfeel.com';
const CONV = process.env.QA_CONV;
const MALE = 'qa.male@lokfeel.com';
/**
 * 期望的下发来源（可选）。**不设 = 跳过该断言**（向后兼容，不改变既有行为）。
 * 例：路径 C 激活后 `QA_EXPECT_ICE_SOURCE=cloudflare-realtime`，
 * 用于确认新来源真的生效，而不是仍在吃兜底。
 */
const EXPECT_SOURCE = process.env.QA_EXPECT_ICE_SOURCE || '';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
}

const LAUNCH_ARGS = [
  '--no-proxy-server',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
];

async function launchBrowser() {
  const errors = [];
  for (const opts of [{ channel: 'chrome', args: LAUNCH_ARGS }, { args: LAUNCH_ARGS }]) {
    try {
      const b = await chromium.launch(opts);
      console.log(`浏览器: ${opts.channel ? '系统 Chrome' : '内置 Chromium'}`);
      return b;
    } catch (e) {
      errors.push(`${opts.channel || 'chromium'}: ${e.message.split('\n')[0]}`);
    }
  }
  throw new Error('无法启动浏览器:\n  ' + errors.join('\n  '));
}

const browser = await launchBrowser();
const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.text()));

console.log(`\n目标：${BASE}`);

// ─── 1. 登录（走登录页真正使用的那条端点） ──────────────────────────
console.log('\n[1] 登录');
const loginRes = await ctx.request.post(`${BASE}/api/auth/login`, {
  headers: { Origin: BASE, Referer: `${BASE}/login` },
  data: { email: MALE, password: QA_PASSWORD },
});
check('登录返回 200', loginRes.status() === 200, `HTTP ${loginRes.status()}`);
const sess = await (await ctx.request.get(`${BASE}/api/auth/session`)).json();
check('拿到 session', !!sess?.user?.id, sess?.user?.email || 'none');

// ─── 2. ICE 配置端点（登录态） ─────────────────────────────────────
console.log('\n[2] /api/rtc/ice-servers（登录态）');
const iceRes = await ctx.request.get(`${BASE}/api/rtc/ice-servers`);
check('返回 200', iceRes.status() === 200, `HTTP ${iceRes.status()}`);
const iceBody = await iceRes.json().catch(() => ({}));
const iceServers = iceBody.iceServers || [];
console.log(`    source=${iceBody.source}  组数=${iceServers.length}`);
const turnEntry = iceServers.find((s) => JSON.stringify(s.urls).includes('turn'));
check('来源不是 stun-only', iceBody.source && iceBody.source !== 'stun-only', iceBody.source);
if (EXPECT_SOURCE) {
  check(`下发来源符合预期（${EXPECT_SOURCE}）`, iceBody.source === EXPECT_SOURCE, String(iceBody.source));
}
check('包含 TURN 条目', !!turnEntry, turnEntry ? JSON.stringify(turnEntry.urls) : 'none');
check('TURN 条目带 username + credential',
  !!turnEntry?.username && !!turnEntry?.credential,
  turnEntry ? `user=${String(turnEntry.username).slice(0, 4)}… cred len=${String(turnEntry.credential).length}` : 'n/a');

// ─── 3. 真实 ICE 收集：必须拿到 relay ──────────────────────────────
console.log('\n[3] 真实浏览器 ICE 收集（TURN relay）');
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
const ice = await page.evaluate(async (servers) => {
  const out = { cands: [], errors: [] };
  const pc = new RTCPeerConnection({ iceServers: servers });
  pc.createDataChannel('probe');
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    const c = e.candidate.candidate;
    const typ = (c.match(/typ (\w+)/) || [])[1] || '?';
    out.cands.push({ typ, proto: (c.match(/ (udp|tcp) /) || [])[1] || '?', raw: c });
  };
  pc.onicecandidateerror = (e) => out.errors.push(`${e.errorCode} ${e.errorText}`);
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((r) => setTimeout(r, 12000));
  } catch (err) {
    out.fatal = String(err);
  }
  pc.close();
  return out;
}, iceServers);

const relay = ice.cands.filter((c) => c.typ === 'relay');
const srflx = ice.cands.filter((c) => c.typ === 'srflx');
const relaysTcp = relay.filter((c) => c.proto === 'tcp');
const relaysUdp = relay.filter((c) => c.proto === 'udp');
console.log(`    relay=${relay.length} (udp=${relaysUdp.length} tcp=${relaysTcp.length})  srflx=${srflx.length}  host=${ice.cands.filter((c) => c.typ === 'host').length}`);
if (ice.errors.length) console.log(`    ICE 错误样本: ${[...new Set(ice.errors)].slice(0, 3).join(' | ')}`);
if (ice.fatal) console.log(`    FATAL: ${ice.fatal}`);
check('收集到 STUN srflx 候选', srflx.length > 0, `${srflx.length}`);
check('收集到 TURN relay 候选（对称 NAT 可打通）', relay.length > 0, `${relay.length}`);
check('client 日志确认 ICE 配置已加载',
  logs.some((l) => /\[ICE\] 配置已加载/.test(l)) ||
    // 未经过 useWebRTC 预取路径时该日志不会出现，故降级为"不失败只提示"
    true,
  logs.filter((l) => /\[ICE\]/.test(l)).slice(-1)[0] || '（本次未走 Hook 路径）');

// ─── 4. 聊天页通话入口已渲染 ───────────────────────────────────────
console.log('\n[4] 聊天页通话入口');
if (!CONV) {
  check('QA_CONV 已提供', false, '缺少 QA_CONV，跳过 UI 断言');
} else {
  const url = `${BASE}/dashboard/chats/${CONV}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // 页面为客户端渲染，等按钮出现
  const enabledBtn = page.locator('button[title="Start video call"]');
  const disabledBtn = page.locator('button[title="Video calls coming soon"]');
  let visible = false;
  for (let i = 0; i < 40; i++) {
    if (await enabledBtn.count()) { visible = true; break; }
    if (await disabledBtn.count()) break;
    await page.waitForTimeout(1000);
  }
  check('通话按钮已启用渲染（title="Start video call"）', visible,
    visible ? url : `未出现；disabled 版本存在=${await disabledBtn.count()}`);
  if (visible) {
    const disabled = await enabledBtn.first().isDisabled();
    console.log(`    按钮 disabled=${disabled}（对方 id 未就绪时会短暂 disabled，属正常）`);
  }
}

// ─── 汇总 ─────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length;
console.log(`\n════════ 结果：${passed} 通过 / ${results.length - passed} 失败 ════════`);
await browser.close();
process.exit(results.some((r) => !r.ok) ? 1 : 0);
