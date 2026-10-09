/**
 * 视频通话信令端到端验证（双浏览器上下文 + 真实 Pusher）。
 *
 * 验证对象是「被叫方能否收到呼叫」这条此前完全不通的链路：
 *   呼叫方点击按钮 → useWebRTC.initiateCall（getUserMedia→createOffer）
 *   → POST /api/im/call/signal（服务端中继）→ pusher.trigger 到 private-im-user-{callee}
 *   → 被叫方 useWebRTC 订阅收到 offer → store.callState = RINGING
 *   → VideoCallModal 渲染来电弹窗 .incoming-call-modal
 *
 * 前置：
 *   - 本地服务已启动（含 NEXT_PUBLIC_ENABLE_VIDEO_CALL=1 与 Pusher 变量）
 *   - scripts/qa/create-qa-accounts.mjs 已跑，且双方向已 match（有会话）
 *
 * 用法: QA_CONV=<conversationId> node scripts/qa/verify-video-call-signaling.mjs
 */
import { chromium } from 'playwright'
import { QA_PASSWORD } from './qa-credentials.mjs'

const BASE = process.env.QA_BASE || 'http://localhost:3099'
const CONV = process.env.QA_CONV
const MALE = { email: 'qa.male@lokfeel.com' }
const FEMALE = { email: 'qa.female@lokfeel.com' }

if (!CONV) {
  console.error('缺少 QA_CONV（会话 id）')
  process.exit(2)
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`)
}

async function login(ctx, email) {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    headers: { Origin: BASE, Referer: `${BASE}/login` },
    data: { email, password: QA_PASSWORD },
  })
  if (res.status() !== 200) {
    throw new Error(`登录失败 ${email}: HTTP ${res.status()} ${await res.text()}`)
  }
  const s = await ctx.request.get(`${BASE}/api/auth/session`)
  const session = await s.json()
  if (!session?.user?.id) throw new Error('无 session: ' + email)
  return session.user
}

async function pusherAuth(ctx, channelName) {
  const res = await ctx.request.post(`${BASE}/api/im/pusher/auth`, {
    headers: { Origin: BASE },
    form: { socket_id: '12345.67890', channel_name: channelName },
  })
  let body = ''
  try {
    body = await res.text()
  } catch {
    /* ignore */
  }
  return { status: res.status(), body }
}

/** 轮询已收集的日志，判断某个标记是否出现过（避免监听时机导致的假阴性） */
async function hasLog(logs, re, timeoutMs = 40000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (logs.some((l) => re.test(l))) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const LAUNCH_ARGS = [
  '--no-proxy-server',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
]

/**
 * Playwright 1.63 已不再支持 macOS 13 的内置 Chromium（报 "does not support chromium on mac13"），
 * 因此优先用系统安装的 Google Chrome（channel: 'chrome'），失败再退回内置 Chromium。
 */
async function launchBrowser() {
  const errors = []
  for (const opts of [{ channel: 'chrome', args: LAUNCH_ARGS }, { args: LAUNCH_ARGS }]) {
    try {
      const b = await chromium.launch(opts)
      console.log(`  浏览器: ${opts.channel ? '系统 Chrome (channel=chrome)' : '内置 Chromium'}`)
      return b
    } catch (e) {
      errors.push(`${opts.channel || 'chromium'}: ${e.message.split('\n')[0]}`)
    }
  }
  throw new Error('无法启动浏览器:\n  ' + errors.join('\n  '))
}

const browser = await launchBrowser()

const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] })
const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] })

const logsA = []
const logsB = []
const pageA = await ctxA.newPage()
const pageB = await ctxB.newPage()
pageA.on('console', (m) => logsA.push(m.text()))
pageB.on('console', (m) => logsB.push(m.text()))
const pageErrorsA = []
const pageErrorsB = []
pageA.on('pageerror', (e) => pageErrorsA.push(String(e.message || e).slice(0, 200)))
pageB.on('pageerror', (e) => pageErrorsB.push(String(e.message || e).slice(0, 200)))

const relayA = []
const relayB = []
const authA = []
const authB = []
pageA.on('response', async (r) => {
  if (r.url().includes('/api/im/call/signal')) relayA.push(`${r.request().method()} ${r.status()}`)
  if (r.url().includes('/api/im/pusher/auth')) {
    let b = ''
    try {
      b = (await r.text()).slice(0, 200)
    } catch {
      /* ignore */
    }
    authA.push(`${r.request().method()} ${r.status()} ${b}`)
  }
})
pageB.on('response', async (r) => {
  if (r.url().includes('/api/im/call/signal')) relayB.push(`${r.request().method()} ${r.status()}`)
  if (r.url().includes('/api/im/pusher/auth')) {
    let b = ''
    try {
      b = (await r.text()).slice(0, 200)
    } catch {
      /* ignore */
    }
    authB.push(`${r.request().method()} ${r.status()} ${b}`)
  }
})
pageA.on('requestfailed', (r) => {
  if (r.url().includes('/api/im/')) authA.push(`FAILED ${r.url().split('/api/')[1]}`)
})
pageB.on('requestfailed', (r) => {
  if (r.url().includes('/api/im/')) authB.push(`FAILED ${r.url().split('/api/')[1]}`)
})

console.log('================ 1. 登录 ================')
const userA = await login(ctxA, MALE.email)
const userB = await login(ctxB, FEMALE.email)
console.log(`  呼叫方 ${userA.name} (${userA.id})`)
console.log(`  被叫方 ${userB.name} (${userB.id})`)
check('双账号登录成功', !!userA.id && !!userB.id)

console.log('\n================ 2. 频道鉴权（403 回归）================')
const own = await pusherAuth(ctxA, `private-im-user-${userA.id}`)
check('自己的个人频道 → 200（前缀白名单命中）', own.status === 200, `HTTP ${own.status}`)
check('返回 Pusher 授权签名', /"auth"\s*:/.test(own.body), own.body.slice(0, 60))

const otherCh = await pusherAuth(ctxA, `private-im-user-${userB.id}`)
check('他人的个人频道 → 403（不可越权订阅）', otherCh.status === 403, `HTTP ${otherCh.status}`)

const legacy = await pusherAuth(ctxA, `private-user-${userA.id}`)
check('旧前缀 private-user- → 403（历史 403 根因已不会复发）', legacy.status === 403, `HTTP ${legacy.status}`)

console.log('\n================ 3. 双方进入会话页 ================')
await pageA.goto(`${BASE}/dashboard/chats/${CONV}`, { waitUntil: 'domcontentloaded' })
await pageB.goto(`${BASE}/dashboard/chats/${CONV}`, { waitUntil: 'domcontentloaded' })
await pageA.waitForLoadState('networkidle', { timeout: 150000 }).catch(() => {})
await pageB.waitForLoadState('networkidle', { timeout: 150000 }).catch(() => {})
console.log(`  A url=${pageA.url()}`)
console.log(`  B url=${pageB.url()}`)

const callBtn = 'button[title="Start video call"]'
let btnOk = true
try {
  await pageA.waitForSelector(callBtn, { timeout: 150000 })
} catch {
  btnOk = false
}
check('呼叫方看到「发起视频通话」按钮（开关已生效）', btnOk)

if (!btnOk) {
  const body = await pageA.evaluate(() => document.body?.innerText?.slice(0, 500) ?? '')
  console.log('  --- A 页面文本（前 500 字）---')
  console.log('  ' + body.replace(/\n/g, '\n  '))
  console.log('  --- A console（后 25 条）---')
  console.log('  ' + logsA.slice(-25).join('\n  '))
  await pageA.screenshot({ path: '/tmp/vc-a.png' })
  await browser.close()
  console.log('\n════════ 结果：提前中止（页面未就绪）════════')
  process.exit(1)
}

const subA = await hasLog(logsA, /Subscribed to Pusher channel: private-im-user-/)
const subB = await hasLog(logsB, /Subscribed to Pusher channel: private-im-user-/)
check('呼叫方已订阅个人频道', subA)
check('被叫方已订阅个人频道', subB)

// ⚠️ 必须等两端 Pusher **连接建立**后再发起呼叫：
//    Pusher 不会为离线订阅者排队事件，若被叫方连接尚未 ready，
//    offer 会被直接丢弃（表现为「呼叫方发出去了、被叫方没反应」）。
const connA = await hasLog(logsA, /\[IM Pusher\] Connected/, 60000)
const connB = await hasLog(logsB, /\[IM Pusher\] Connected/, 60000)
check('呼叫方 Pusher 连接就绪', connA)
check('被叫方 Pusher 连接就绪', connB)
// 再留一点时间让订阅在 Pusher 服务端完成注册
await pageA.waitForTimeout(4000)

// ─────────── 隔离测试：收路径是否正常 ───────────
// 直接从 Node 用 Pusher 往被叫方个人频道投一条**合成 offer**，
// 用于区分「收的路径坏了」与「真实链路的时序问题」。
if (process.env.PUSHER_APP_ID) {
  const mod = await import('pusher')
  const PusherCtor = mod.default ?? mod
  const p = new PusherCtor({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
  })
  await p.trigger(`private-im-user-${userB.id}`, 'call:offer', {
    callId: 'probe-' + Date.now(),
    callerId: userA.id,
    calleeId: userB.id,
    offer: { type: 'offer', sdp: 'v=0' },
    timestamp: Date.now(),
  })
  const gotProbe = await hasLog(logsB, /Received offer via Pusher/, 30000)
  check('隔离测试：被叫方能收到服务端直投的 offer（收路径正常）', gotProbe)
}

console.log('\n================ 4. 呼叫方点击发起 ================')
await pageA.click(callBtn)
// 等呼叫方进入「正在呼叫」（同时给 getUserMedia / 中继留时间）
await pageA.waitForTimeout(12000)

const aModal = await pageA.locator('.video-call-modal').count()
check('呼叫方进入通话主界面', aModal > 0, `video-call-modal 节点数=${aModal}`)
console.log(`  中继请求(A): ${relayA.join(', ') || '(无)'}`)

console.log('\n================ 5. 被叫方收到来电 ================')
let incoming = false
try {
  await pageB.waitForSelector('.incoming-call-modal', { state: 'visible', timeout: 90000 })
  incoming = true
} catch {
  incoming = false
}
check('被叫方弹出「来电」界面', incoming)

if (incoming) {
  const name = await pageB.textContent('.incoming-call-modal').catch(() => '')
  console.log(`    来电弹窗文本（截断）: ${String(name).replace(/\s+/g, ' ').slice(0, 90)}`)
  check('来电弹窗展示了来电者名字', String(name).includes(userA.name), userA.name)
}

console.log('\n================ 6. 被叫方接听 ================')
if (incoming) {
  // ⚠️ 弹窗里第一个按钮是「拒绝」(title=拒绝)，必须按 title 精确点「接听」
  const acceptBtn = pageB.locator('.incoming-call-modal button[title="接听"]')
  await acceptBtn.click()
  await pageB.waitForTimeout(12000)
  const bHasModal = await pageB.locator('.video-call-modal').count()
  check('接听后进入通话主界面', bHasModal > 0, `video-call-modal 节点数=${bHasModal}`)
  const aStill = await pageA.locator('.video-call-modal').count()
  check('呼叫方仍在通话主界面', aStill > 0, `video-call-modal 节点数=${aStill}`)
  console.log(`  中继请求(B): ${relayB.join(', ') || '(无)'}`)
}

await pageA.screenshot({ path: '/tmp/vc-a.png', fullPage: false })
await pageB.screenshot({ path: '/tmp/vc-b.png', fullPage: false })

console.log('\n================ 诊断日志 ================')
const pick = (arr, kw) => arr.filter((l) => kw.test(l)).slice(-10)
console.log('  [A] 信令与错误:')
console.log('    ' + (pick(logsA, /CallSignal|Initiating call|Sending offer|Subscribed|rror|Failed/i).join('\n    ') || '(无)'))
console.log('  [B] 信令与错误:')
console.log('    ' + (pick(logsB, /CallSignal|Received offer|Subscribed|RINGING|rror|Failed/i).join('\n    ') || '(无)'))
console.log(`  [A] call/signal 响应: ${relayA.join(', ') || '(无)'}`)
console.log(`  [B] call/signal 响应: ${relayB.join(', ') || '(无)'}`)
console.log(`  [A] pusher/auth 响应: ${authA.join(', ') || '(无)'}`)
console.log(`  [B] pusher/auth 响应: ${authB.join(', ') || '(无)'}`)
console.log('  [A] 页面异常:', pageErrorsA.length ? pageErrorsA.join('\n    ') : '(无)')
console.log('  [B] 页面异常:', pageErrorsB.length ? pageErrorsB.join('\n    ') : '(无)')

// 从「Initiating call」之后打印呼叫方全部日志，用于定位中断点
const startA = logsA.findIndex((l) => /Initiating call/.test(l))
if (startA >= 0) {
  console.log('  [A] 发起呼叫后的完整日志:')
  console.log('    ' + logsA.slice(startA, startA + 40).join('\n    '))
}

// 被叫方：从最后一次订阅之后的全部日志，用于判断是否收到 offer / 订阅是否被撕掉
const startB = logsB.map((l) => /Subscribed to Pusher channel/.test(l)).lastIndexOf(true)
if (startB >= 0) {
  console.log('  [B] 最后一次订阅之后的完整日志:')
  console.log('    ' + logsB.slice(startB, startB + 40).join('\n    '))
}
// Pusher 连接状态 / 订阅错误（通道鉴权失败会以 subscription_error 形式出现）
const pusherIssues = [...logsA, ...logsB].filter((l) =>
  /subscription_error|pusher.*(error|failed|disconnected)|Connection closed/i.test(l)
)
console.log('  [A+B] Pusher 相关异常:', pusherIssues.length ? '\n    ' + pusherIssues.slice(-10).join('\n    ') : '(无)')

await browser.close()

const passed = results.filter((r) => r.ok).length
console.log(`\n════════ 结果：${passed} 通过 / ${results.length - passed} 失败 ════════`)
process.exit(results.every((r) => r.ok) ? 0 : 1)
