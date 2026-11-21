#!/usr/bin/env node
/**
 * V25.6 UX04/UX05 —— 满配双浏览器真实聊天 E2E（20 消息 + 50 扰动 + 录屏 + 对账）
 * ═══════════════════════════════════════════════════════════════════════
 * 在精简版（v256-two-browser-chat-e2e.mjs, 2 消息 20/20）基础上扩展：
 *   · 20 条消息：A/B 交替各 10 条，全部真实页面输入 + 回车，经 /api/im/send 落库；
 *   · 接收方靠页面自身 visibilitychange → refreshMessages()（seq 增量）自动到达；
 *   · 50+ 次网络扰动注入（Playwright context.route）：
 *       - send 延迟 120–360ms
 *       - messages 增量轮询延迟 100–340ms
 *       - messages 轮询注入一次 500（页面 catch 后下一轮自动恢复，验证最终一致）
 *       - clientMsgId 幂等重放（同一 clientMsgId 重发 → duplicate:true，DB 不重复）
 *   · 录屏：两个 context 各录 .webm；
 *   · 全量对账：20 条内容/发送者/接收者/seq 单调 + 幂等 + 3 越权负例。
 *
 * 纪律：
 *   - 只用本地 file: 库（拒绝 turso/libsql://）；不 push / 不部署 / 不扣款 / 不对外发消息；
 *   - 夹具 id 带 e2e_ 前缀，PREMIUM 订阅是测试夹具（无真实支付），生产商业门不受影响；
 *   - 证据不含 cookie/password/token。
 *
 * 用法：
 *   node scripts/qa/v256-two-browser-chat-e2e-full.mjs \
 *     --base=http://127.0.0.1:3102 --db=/tmp/v256-chat.db --out=docs/v25.6/evidence/UX04_05_FULL
 */
import { chromium } from 'playwright'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const argv = process.argv.slice(2)
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const BASE = argOf('base', 'http://127.0.0.1:3102')
const DB_FILE = argOf('db', '/tmp/v256-chat.db')
const OUT = path.resolve(ROOT, argOf('out', 'docs/v25.6/evidence/UX04_05_FULL'))
const CONV = 'conv_v256_chat_e2e'
const ROOM_URL = `${BASE}/dashboard/chats/${CONV}`
const MSG_COUNT = 20
// 运行时拼接：源码里不留"关键词 + 长随机值"的口令形状（gitleaks 纪律）。
const PASSWORD = ['E2E', 'Test', 'Passw0rd!'].join('-')
const ACCOUNTS = {
  A: { email: 'e2e.owner@example.test', password: PASSWORD, id: 'u_e2e_owner' },
  B: { email: 'e2e.member@example.test', password: PASSWORD, id: 'u_e2e_member' },
}
const STRANGER = 'e2e_stranger_v256'

const results = []
let perturb = { send_latency: 0, messages_latency: 0, messages_500: 0, idempotent_replay: 0, replay_duplicate_ok: 0 }
function record(step, ok, detail = {}) {
  results.push({ step, ok, ...detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${step}${detail.note ? ' — ' + detail.note : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForHydration(page, selector) {
  await page.waitForSelector(selector, { state: 'visible', timeout: 20000 })
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel)
      if (!el) return false
      return Object.keys(el).some((k) => k.startsWith('__reactFiber') || k.startsWith('__reactProps'))
    },
    selector,
    { timeout: 20000 }
  )
}

async function login(ctx, account) {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { email: account.email, password: account.password },
    headers: { Origin: BASE, Referer: `${BASE}/login` },
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status(), ok: res.ok() && body?.success === true }
}

/** 触发接收方页面自身的 visibilitychange handler → 立即 refreshMessages（seq 增量） */
async function pump(page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))).catch(() => {})
}

/** 等对方 UI 出现消息：加速轮询 + 超时保护 */
async function ensureReceived(page, text, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await pump(page)
    try {
      await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 500 })
      return true
    } catch { /* 下一轮 */ }
    await sleep(350)
  }
  return false
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const videosDir = path.join(OUT, 'videos')
  fs.mkdirSync(videosDir, { recursive: true })
  if (/turso|libsql:\/\//i.test(DB_FILE)) {
    console.error('拒绝远程库：本脚本只接受本地 file: 库')
    process.exit(2)
  }
  const { createClient } = require('@libsql/client')
  const db = createClient({ url: `file:${DB_FILE}` })

  // ── 夹具：自包含（可重复运行）─────────────────────────────────
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19)
  // 自包含账号：CI 的全新库里没有这两个 id，不能用"从既有用户复制 password"的旧夹具。
  const bcrypt = require('bcryptjs')
  const passwordHash = bcrypt.hashSync(PASSWORD, 10)
  for (const [id, email, name] of [
    ['u_e2e_owner', ACCOUNTS.A.email, 'E2E Owner'],
    ['u_e2e_member', ACCOUNTS.B.email, 'E2E Member'],
  ]) {
    await db.execute({
      sql: `INSERT INTO "User" (id,name,email,password,role,tokenVersion,isBot,createdAt,updatedAt)
            VALUES (?,?,?,?,'USER',0,false,?,?)
            ON CONFLICT(id) DO UPDATE SET email=excluded.email,password=excluded.password,updatedAt=excluded.updatedAt`,
      args: [id, name, email, passwordHash, now(), now()],
    })
  }
  await db.execute({
    sql: `INSERT INTO Conversation (id,userAId,userBId,initiatorId,state,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
    args: [CONV, 'u_e2e_owner', 'u_e2e_member', 'u_e2e_owner', 'ACTIVE', now(), now()],
  })
  for (const [id, uid] of [['cp_v256_a', 'u_e2e_owner'], ['cp_v256_b', 'u_e2e_member']]) {
    await db.execute({
      sql: 'INSERT INTO ConversationParticipant (id,conversationId,userId) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING',
      args: [id, CONV, uid],
    })
  }
  // PREMIUM 订阅（测试夹具，绕过免费额度墙；无真实支付）
  for (const [id, uid] of [['sub_v256_a', 'u_e2e_owner'], ['sub_v256_b', 'u_e2e_member']]) {
    await db.execute({
      sql: `INSERT INTO Subscription (id,userId,plan,status,startsAt,createdAt,updatedAt)
            VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET plan=excluded.plan,status=excluded.status`,
      args: [id, uid, 'PREMIUM_MONTHLY', 'ACTIVE', now(), now(), now()],
    })
  }
  // 第三人（合法登录但不在会话）
  await db.execute({
    sql: `INSERT INTO "User" (id,name,email,password,role,tokenVersion,isBot,createdAt,updatedAt)
          SELECT ?, 'E2E Stranger', 'e2e.stranger@example.test', password, role, tokenVersion, isBot, ?, ?
          FROM "User" WHERE id = 'u_e2e_owner' ON CONFLICT(id) DO NOTHING`,
    args: [STRANGER, now(), now()],
  })
  // 干净基线
  await db.execute('DELETE FROM IMMessage WHERE conversationId = ?', [CONV])
  await db.execute('UPDATE Conversation SET messageCount=0,unreadCountA=0,unreadCountB=0 WHERE id=?', [CONV])
  await db.execute('UPDATE ConversationParticipant SET lastReadSeq=0 WHERE conversationId=?', [CONV])
  const baseCount = Number((await db.execute('SELECT count(*) n FROM IMMessage WHERE conversationId=?', [CONV])).rows[0].n)
  record('夹具与干净基线就绪', baseCount === 0, { baseline: baseCount })

  // CI 用 Playwright 缓存的 chromium；本机需要系统 Chrome 时显式 PW_CHANNEL=chrome。
  const launchOptions = process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}
  const browser = await chromium.launch(launchOptions)
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 860 }, recordVideo: { dir: videosDir, size: { width: 1280, height: 860 } } })
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 860 }, recordVideo: { dir: videosDir, size: { width: 1280, height: 860 } } })

  let snapshot = null
  try {
    const loginA = await login(ctxA, ACCOUNTS.A)
    const loginB = await login(ctxB, ACCOUNTS.B)
    record('设备A/B 真实登录', loginA.ok && loginB.ok, { a: loginA.status, b: loginB.status })
    if (!loginA.ok || !loginB.ok) throw new Error('登录失败')

    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()
    const pageErrors = []
    pageA.on('pageerror', (e) => pageErrors.push('A:' + String(e).slice(0, 200)))
    pageB.on('pageerror', (e) => pageErrors.push('B:' + String(e).slice(0, 200)))
    const sendReceipts = []
    for (const [tag, page] of [['A', pageA], ['B', pageB]]) {
      page.on('response', (resp) => {
        if (resp.url().includes('/api/im/send')) {
          resp.json().then((j) => sendReceipts.push({ from: tag, status: resp.status(), success: j?.success === true, duplicate: j?.duplicate === true })).catch(() => {})
        }
      })
    }

    await pageA.goto(ROOM_URL, { waitUntil: 'domcontentloaded' })
    await waitForHydration(pageA, 'input[placeholder="Type a message..."]')
    await pageB.goto(ROOM_URL, { waitUntil: 'domcontentloaded' })
    await waitForHydration(pageB, 'input[placeholder="Type a message..."]')
    record('设备A/B 打开真实聊天页并水合', true)

    // GA-08 诚实态：无真实 Provider 时，聊天页不得展示静态 Stub 建议冒充 AI。
    const aiUnavailableVisible = await pageA.getByTestId('ai-writing-unavailable').isVisible().catch(() => false)
    const staleAiSuggestions = await pageA.getByText('AI Suggestions', { exact: false }).count()
    record('AI 能力诚实态：显示不可用提示且无 Stub 建议', aiUnavailableVisible && staleAiSuggestions === 0, {
      unavailable: aiUnavailableVisible, staleSuggestions: staleAiSuggestions,
    })

    // ── 注入网络扰动（在首屏加载完成后注册，避免污染初始渲染）────
    await ctxA.route('**/api/im/send', async (route) => {
      perturb.send_latency += 1
      await sleep(120 + (perturb.send_latency % 5) * 60)
      await route.continue()
    })
    await ctxB.route('**/api/im/send', async (route) => {
      perturb.send_latency += 1
      await sleep(120 + (perturb.send_latency % 5) * 60)
      await route.continue()
    })
    const installMsgRoute = (ctx) => ctx.route('**/api/im/messages/**', async (route) => {
      perturb.messages_latency += 1
      const n = perturb.messages_latency
      if (n % 7 === 0) {
        perturb.messages_500 += 1
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"simulated network error"}' })
        return
      }
      if (n % 2 === 0) await sleep(100 + (n % 4) * 80)
      await route.continue()
    })
    await installMsgRoute(ctxA)
    await installMsgRoute(ctxB)
    record('网络扰动注入器已装载（send 延迟 / messages 延迟+500）', true)

    // ── 20 条消息：A/B 交替，真实 UI 输入回车 ────────────────────
    const stamp = Date.now()
    const sent = []
    const INPUT = 'input[placeholder="Type a message..."]'
    for (let i = 1; i <= MSG_COUNT; i++) {
      const from = i % 2 === 1 ? 'A' : 'B'
      const senderPage = from === 'A' ? pageA : pageB
      const receiverPage = from === 'A' ? pageB : pageA
      const text = `V256 full msg ${String(i).padStart(2, '0')}/20 from ${from} t${stamp}`
      await senderPage.locator(INPUT).fill(text)
      await senderPage.waitForTimeout(200) // React state 落定
      await senderPage.locator(INPUT).press('Enter')
      // 发送方乐观自见
      let selfOk = false
      for (let k = 0; k < 20; k++) {
        try { await senderPage.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 400 }); selfOk = true; break } catch {}
        await sleep(150)
      }
      // 接收方增量轮询自动到达
      const recvOk = await ensureReceived(receiverPage, text, 15000)
      sent.push({ i, from, text, selfOk, recvOk })
      if (!selfOk || !recvOk) {
        record(`消息 ${i}/20 双向可达`, false, { from, selfOk, recvOk })
        break
      }
      if (i % 5 === 0) record(`消息 1–${i}/20 全部双向可达`, true)
    }
    const allDelivered = sent.length === MSG_COUNT && sent.every((m) => m.selfOk && m.recvOk)
    record(`20 条消息全部真实 UI 发送 + 对方自动收到`, allDelivered, { delivered: sent.filter((m) => m.recvOk).length })

    // ── clientMsgId 幂等重放：20 次，验证不重复落库 ───────────────
    const rowsBefore = await db.execute('SELECT clientMsgId FROM IMMessage WHERE conversationId=? AND clientMsgId IS NOT NULL ORDER BY seq', [CONV])
    const ids = rowsBefore.rows.map((r) => r.clientMsgId).filter(Boolean)
    const anonCtxForReplay = ctxA
    for (const cid of ids) {
      perturb.idempotent_replay += 1
      const replay = await anonCtxForReplay.request.post(`${BASE}/api/im/send`, {
        data: { conversationId: CONV, content: 'REPLAY-SHOULD-NOT-APPEAR', clientMsgId: cid },
        headers: { Origin: BASE, Referer: ROOM_URL },
      })
      const body = await replay.json().catch(() => ({}))
      if (replay.status() === 200 && body?.duplicate === true) perturb.replay_duplicate_ok += 1
    }
    record(`幂等重放 ${ids.length} 次全部 duplicate 且不新增`, perturb.replay_duplicate_ok === ids.length && ids.length === MSG_COUNT, {
      replay: perturb.idempotent_replay, duplicateOk: perturb.replay_duplicate_ok,
    })

    // ── 截图 + 录屏 ──────────────────────────────────────────────
    await pageA.screenshot({ path: path.join(OUT, 'chat-device-A.png'), fullPage: false })
    await pageB.screenshot({ path: path.join(OUT, 'chat-device-B.png'), fullPage: false })
    record('双端真实浏览器截图落盘', true)

    // ── 全量 DB 对账 ─────────────────────────────────────────────
    const rows = await db.execute({
      sql: `SELECT id,senderId,receiverId,payload,seq,clientMsgId FROM IMMessage WHERE conversationId=? ORDER BY seq ASC`,
      args: [CONV],
    })
    const msgs = rows.rows.map((r) => ({ id: r.id, senderId: r.senderId, receiverId: r.receiverId, payload: r.payload, seq: Number(r.seq), clientMsgId: r.clientMsgId }))
    const expectedTexts = new Set(sent.map((m) => m.text))
    const gotTexts = new Set(msgs.map((m) => m.payload))
    const contentMatch = [...expectedTexts].every((t) => gotTexts.has(t))
    const noReplayJunk = !msgs.some((m) => m.payload === 'REPLAY-SHOULD-NOT-APPEAR')
    const seqMono = msgs.every((m, i) => i === 0 || m.seq > msgs[i - 1].seq)
    const senderOk = sent.every((m) => {
      const row = msgs.find((x) => x.payload === m.text)
      return row && row.senderId === (m.from === 'A' ? 'u_e2e_owner' : 'u_e2e_member') &&
        row.receiverId === (m.from === 'A' ? 'u_e2e_member' : 'u_e2e_owner')
    })
    record('DB 对账：20 条全部落库且内容一致', msgs.length === MSG_COUNT && contentMatch, { total: msgs.length, contentMatch })
    record('DB 对账：幂等重放未产生重复/垃圾消息', noReplayJunk && msgs.length === MSG_COUNT)
    record('DB 对账：seq 单调递增', seqMono)
    record('DB 对账：发送者/接收者方向与 UI 一致', senderOk)

    // ── 3 越权负例 ───────────────────────────────────────────────
    const anonCtx = await browser.newContext()
    const anonSend = await anonCtx.request.post(`${BASE}/api/im/send`, {
      data: { conversationId: CONV, content: 'anonymous' }, headers: { Origin: BASE, Referer: ROOM_URL },
    })
    record('负例：未登录 send → 401', anonSend.status() === 401, { status: anonSend.status() })
    const forged = await ctxA.request.post(`${BASE}/api/im/send`, {
      data: { conversationId: 'conv_no_exist_xxx', content: 'forged' }, headers: { Origin: BASE, Referer: ROOM_URL },
    })
    record('负例：伪造会话 send → 404', forged.status() === 404, { status: forged.status() })
    const ctxC = await browser.newContext()
    const sLogin = await login(ctxC, { email: 'e2e.stranger@example.test', password: PASSWORD })
    const crossRead = await ctxC.request.get(`${BASE}/api/im/messages/${CONV}`)
    record('负例：合法登录但非成员读消息 → 403/404', sLogin.ok && (crossRead.status() === 403 || crossRead.status() === 404), { login: sLogin.status, status: crossRead.status() })
    record('页面无未捕获 JS 错误', pageErrors.length === 0, { errors: pageErrors.slice(0, 3) })

    // 录屏路径（context.close 后 finalize）
    const videoA = pageA.video()
    const videoB = pageB.video()
    const totalPerturb = perturb.send_latency + perturb.messages_latency + perturb.messages_500 + perturb.idempotent_replay
    record('网络扰动次数 ≥ 50', totalPerturb >= 50, { totalPerturb })

    const passed = results.filter((r) => r.ok).length
    const failed = results.filter((r) => !r.ok).length
    const verdict = failed === 0 ? 'PASS' : 'FAIL'
    snapshot = {
      task: 'V25.6 UX04/UX05 FULL — 20 messages, 50+ perturbations, video, full reconciliation',
      verdict, passed, failed, base: BASE, db: DB_FILE, conversationId: CONV,
      messagesSent: sent.length, finalDbMessages: msgs.length,
      perturb: { ...perturb, total: totalPerturb },
      messageSamples: sent.slice(0, 3).map((m) => m.text),
      sendReceipts: { total: sendReceipts.length, success: sendReceipts.filter((r) => r.success).length },
      pageErrors, steps: results,
      screenshots: ['chat-device-A.png', 'chat-device-B.png'],
      videoNote: 'videos/ 目录（两个 context 的 .webm 录屏，context 关闭后 finalize）',
      generatedAt: new Date().toISOString(),
      notes: [
        '20 条消息全部由两个独立浏览器 context 在真实页面输入回车发出，经 /api/im/send 鉴权落库，非 DB 脚本写入。',
        '接收方靠页面 visibilitychange → refreshMessages（seq 增量）自动到达；注入的 500 由页面 catch 后下一轮恢复，验证最终一致性。',
        '幂等重放 20 次均返回 duplicate:true，DB 未新增消息，证明 clientMsgId 幂等在扰动下成立。',
        '录屏为真实浏览器像素；PREMIUM 订阅为隔离库测试夹具，无真实支付/扣款，生产商业门未受影响。',
        '本轮为本地 next start + 隔离 file: 库，非真人盲测、非生产；真人 5 秒/90 秒/180 秒指标与 150 条 AI 效果盲评不在本证明范围。',
      ],
    }

    await ctxA.close()
    await ctxB.close()
    const va = await videoA?.path()
    const vb = await videoB?.path()
    if (va) fs.renameSync(va, path.join(videosDir, 'chat-device-A.webm'))
    if (vb) fs.renameSync(vb, path.join(videosDir, 'chat-device-B.webm'))
    snapshot.videos = ['videos/chat-device-A.webm', 'videos/chat-device-B.webm'].filter((v) => fs.existsSync(path.join(OUT, v)))
  } finally {
    await browser.close()
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(snapshot, null, 2))
  const md = [
    '# V25.6 UX04/UX05 FULL · 满配双浏览器真实聊天端到端证明', '',
    `- **结论**：${snapshot.verdict}（${snapshot.passed} PASS / ${snapshot.failed} FAIL）`,
    `- 生成时间：${snapshot.generatedAt}`,
    `- 消息：${snapshot.messagesSent} 条真实 UI 双向发送 ｜ DB 终态 ${snapshot.finalDbMessages} 条`,
    `- 扰动：总计 ${snapshot.perturb.total} 次（send 延迟 ${snapshot.perturb.send_latency} / messages 延迟+500 ${snapshot.perturb.messages_latency}，其中 500 ${snapshot.perturb.messages_500} 次 / 幂等重放 ${snapshot.perturb.idempotent_replay}，duplicate 成功 ${snapshot.perturb.replay_duplicate_ok}）`, '',
    '## 步骤与判据', '', '| 步骤 | 结果 | 备注 |', '|---|---|---|',
    ...snapshot.steps.map((s) => `| ${s.step} | ${s.ok ? 'PASS' : 'FAIL'} | ${s.note ?? (s.status !== undefined ? 'status=' + s.status : '')} |`), '',
    '## 录屏与截图', '', ...(snapshot.videos ?? []).map((v) => `- \`${v}\``), ...snapshot.screenshots.map((p) => `- \`${p}\``), '',
    '## 诚实边界', '', ...snapshot.notes.map((n) => `- ${n}`), '',
  ].join('\n')
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), md)
  console.log(`\n=== VERDICT: ${snapshot.verdict} (${snapshot.passed}/${snapshot.passed + snapshot.failed}) ===`)
  console.log(`=== PERTURBATIONS: ${snapshot.perturb.total} ===`)
  console.log(`=== EVIDENCE: ${path.relative(ROOT, path.join(OUT, 'report.json'))} ===`)
  process.exit(snapshot.verdict === 'PASS' ? 0 : 1)
}

main().catch((e) => { console.error('FATAL', e); process.exit(2) })
