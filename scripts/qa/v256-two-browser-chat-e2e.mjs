#!/usr/bin/env node
/**
 * V25.6 UX04/UX05 —— 两个真实浏览器会话的端到端聊天证明
 * ═══════════════════════════════════════════════════════════════════════
 * 直接回应 V25.6 总令对 V25.5 的核心批评：
 *   "21 条双向消息是通过底层数据库写入与读取脚本验证的，
 *    不是两个用户在真实前端完成的聊天流程。"
 *
 * 本脚本**不直接写库造消息**。它做：
 *   1. 两个互相隔离的 Playwright BrowserContext（= 两台设备 / 两个真人）
 *   2. 各自用站点自己的 /api/auth/login 真登录（真实 JWT cookie）
 *   3. A 在真实聊天页 input 里逐字输入 → 回车 → 走真实 /api/im/send（鉴权+落库）
 *   4. B 在独立 context 打开同一会话 → 靠页面自身的 seq 增量轮询**自动**看到 A 的消息
 *   5. B 真实输入并回车回复 → A 自动看到
 *   6. 直接读 libSQL 对账：消息条数 / 发送者 / 内容 / seq 单调递增
 *   7. 越权负例：未登录 context 调 /api/im/send → 401；伪造会话 id → 404
 *
 * 证据全部落盘，且**不含** cookie / password / token。
 *
 * 前置（调用方负责）：
 *   - 隔离库已用 seed-t02-e2e.mjs 建好，且已插入 conv_v256_chat_e2e + 2 participant
 *   - next start 以 DATABASE_URL=file:/tmp/v256-chat.db 启动在本脚本 --base 指定端口
 *
 * 用法：
 *   node scripts/qa/v256-two-browser-chat-e2e.mjs \
 *     --base=http://127.0.0.1:3102 --db=/tmp/v256-chat.db --out=docs/v25.6/evidence/UX04_05
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
const OUT = path.resolve(ROOT, argOf('out', 'docs/v25.6/evidence/UX04_05'))
const CONV = 'conv_v256_chat_e2e'
const ROOM_URL = `${BASE}/dashboard/chats/${CONV}`

const ACCOUNTS = {
  A: { email: 'e2e.owner@example.test', password: 'E2E-Test-Passw0rd!' },
  B: { email: 'e2e.member@example.test', password: 'E2E-Test-Passw0rd!' },
}

const results = []
function record(step, ok, detail = {}) {
  results.push({ step, ok, ...detail })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`  [${mark}] ${step}${detail.note ? ' — ' + detail.note : ''}`)
}

/** 判定 React 是否水合：input 上挂了 __reactFiber* 属性 */
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
  return { status: res.status(), ok: res.ok() && body?.success === true, body }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome' })
  let snapshot = null

  try {
    // ── 0. DB 基线 ───────────────────────────────────────────────
    const { createClient } = require('@libsql/client')
    const db = createClient({ url: `file:${DB_FILE}` })
    const before = await db.execute({
      sql: 'SELECT count(*) AS n FROM IMMessage WHERE conversationId = ?',
      args: [CONV],
    })
    const baseline = Number(before.rows[0].n)
    record('DB 基线消息数读取', true, { baseline })

    // 造一个"合法登录但不在本会话"的第三人（复制 owner 的 bcrypt hash，密码相同）
    const STRANGER = 'e2e_stranger_v256'
    await db.execute({
      sql: `INSERT INTO "User" (id,name,email,password,role,tokenVersion,isBot,createdAt,updatedAt)
            SELECT ?, 'E2E Stranger', 'e2e.stranger@example.test', password, role, tokenVersion, isBot, ?, ?
            FROM "User" WHERE id = 'u_e2e_owner'
            ON CONFLICT(id) DO NOTHING`,
      args: [STRANGER, new Date().toISOString(), new Date().toISOString()],
    })
    record('夹具：第三用户(不在会话)就绪', true)

    // ── 1. 两个独立 context 真登录 ───────────────────────────────
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 860 } })
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 860 } })
    const loginA = await login(ctxA, ACCOUNTS.A)
    const loginB = await login(ctxB, ACCOUNTS.B)
    record('设备A 真实登录', loginA.ok, { status: loginA.status })
    record('设备B 真实登录', loginB.ok, { status: loginB.status })
    if (!loginA.ok || !loginB.ok) throw new Error('登录失败，终止')

    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()
    const pageErrors = []
    pageA.on('pageerror', (e) => pageErrors.push('A:' + String(e).slice(0, 200)))
    pageB.on('pageerror', (e) => pageErrors.push('B:' + String(e).slice(0, 200)))

    // API receipt 采集：捕获真实 /api/im/send 响应
    const sendReceipts = []
    for (const [tag, page] of [['A', pageA], ['B', pageB]]) {
      page.on('response', async (resp) => {
        if (resp.url().includes('/api/im/send')) {
          try {
            const j = await resp.json()
            sendReceipts.push({ from: tag, status: resp.status(), success: j?.success === true, duplicate: j?.duplicate === true })
          } catch { /* ignore */ }
        }
      })
    }

    const INPUT = 'input[placeholder="Type a message..."]'
    const stamp = Date.now()
    const msgA = `Hello from device A — real browser ${stamp}`
    const msgB = `Reply from device B — real browser ${stamp}`

    // ── 2. A 打开真实会话页 + 水合 ───────────────────────────────
    const respA = await pageA.goto(ROOM_URL, { waitUntil: 'domcontentloaded' })
    await waitForHydration(pageA, INPUT)
    record('设备A 打开真实聊天页并水合', respA?.ok() === true, { status: respA?.status() })

    // ── 3. A 真实输入 + 回车发送 ─────────────────────────────────
    await pageA.locator(INPUT).fill(msgA)
    await pageA.waitForTimeout(300) // 等 React onChange state 落定，避免 Enter 读到旧值
    await pageA.locator(INPUT).press('Enter')
    await pageA.getByText(msgA, { exact: false }).first().waitFor({ state: 'visible', timeout: 15000 })
    record('设备A 页面输入回车发送并自见', true, { note: msgA })

    // ── 4. B 独立 context 打开会话，靠轮询自动看到 A ──────────────
    const respB = await pageB.goto(ROOM_URL, { waitUntil: 'domcontentloaded' })
    await waitForHydration(pageB, INPUT)
    record('设备B 打开真实聊天页并水合', respB?.ok() === true, { status: respB?.status() })
    await pageB.getByText(msgA, { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 })
    record('设备B 独立浏览器收到设备A消息', true, { note: 'seq 增量轮询自动到达，无刷新/无DB脚本注入' })

    // ── 5. B 真实回复 ────────────────────────────────────────────
    await pageB.locator(INPUT).fill(msgB)
    await pageB.waitForTimeout(300)
    await pageB.locator(INPUT).press('Enter')
    try {
      await pageB.getByText(msgB, { exact: false }).first().waitFor({ state: 'visible', timeout: 15000 })
    } catch (e) {
      console.log('  [DIAG] B send receipts:', JSON.stringify(sendReceipts), 'pageErrors:', JSON.stringify(pageErrors))
      const bInputVal = await pageB.locator(INPUT).inputValue().catch(() => '<gone>')
      console.log('  [DIAG] B input value after Enter:', bInputVal)
      throw e
    }
    record('设备B 页面输入回车回复并自见', true, { note: msgB })

    // ── 6. A 自动看到 B 回复 ─────────────────────────────────────
    await pageA.getByText(msgB, { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 })
    record('设备A 独立浏览器收到设备B回复', true, { note: 'seq 增量轮询自动到达' })

    // ── 7. 截图（真实浏览器像素）─────────────────────────────────
    const shotA = path.join(OUT, 'chat-device-A.png')
    const shotB = path.join(OUT, 'chat-device-B.png')
    await pageA.screenshot({ path: shotA, fullPage: false })
    await pageB.screenshot({ path: shotB, fullPage: false })
    record('双端真实浏览器截图落盘', fs.existsSync(shotA) && fs.existsSync(shotB))

    // ── 8. DB 对账：内容 / 发送者 / seq ───────────────────────────
    const rows = await db.execute({
      sql: `SELECT id, senderId, receiverId, payload, seq, clientMsgId
            FROM IMMessage WHERE conversationId = ? ORDER BY seq ASC`,
      args: [CONV],
    })
    const msgs = rows.rows.map((r) => ({
      id: r.id, senderId: r.senderId, receiverId: r.receiverId,
      payload: r.payload, seq: Number(r.seq), hasClientMsgId: !!r.clientMsgId,
    }))
    const added = msgs.filter((m) => m.payload === msgA || m.payload === msgB)
    const aMsg = msgs.find((m) => m.payload === msgA)
    const bMsg = msgs.find((m) => m.payload === msgB)
    const seqMono = msgs.every((m, i) => i === 0 || m.seq > msgs[i - 1].seq)
    record('DB 对账：两条消息均由真实浏览器落库', added.length === 2, { count: added.length, baseline, total: msgs.length })
    record('DB 对账：发送者/接收者正确', aMsg?.senderId === 'u_e2e_owner' && bMsg?.senderId === 'u_e2e_member' && aMsg?.receiverId === 'u_e2e_member' && bMsg?.receiverId === 'u_e2e_owner')
    record('DB 对账：seq 单调递增', seqMono)
    record('DB 对账：带 clientMsgId（幂等锚点）', aMsg?.hasClientMsgId === true && bMsg?.hasClientMsgId === true)
    record('API receipt：两次 send 均 success', sendReceipts.filter((r) => r.from === 'A' || r.from === 'B').length >= 2 && sendReceipts.every((r) => r.status === 200 && r.success), { receipts: sendReceipts })

    // ── 9. 越权负例 ──────────────────────────────────────────────
    const anonCtx = await browser.newContext()
    const anonSend = await anonCtx.request.post(`${BASE}/api/im/send`, {
      data: { conversationId: CONV, content: 'anonymous injection' },
      headers: { Origin: BASE, Referer: ROOM_URL },
    })
    record('负例：未登录 send → 401', anonSend.status() === 401, { status: anonSend.status() })

    const forgedSend = await ctxA.request.post(`${BASE}/api/im/send`, {
      data: { conversationId: 'conv_does_not_exist_xxx', content: 'forged' },
      headers: { Origin: BASE, Referer: ROOM_URL },
    })
    record('负例：伪造会话 send → 404', forgedSend.status() === 404, { status: forgedSend.status() })

    // 跨会话读取负例：C 不在会话里，读消息接口应 403/404
    const ctxC = await browser.newContext()
    const strangerLogin = await login(ctxC, { email: 'e2e.stranger@example.test', password: 'E2E-Test-Passw0rd!' })
    const crossRead = await ctxC.request.get(`${BASE}/api/im/messages/${CONV}`)
    record('负例：合法登录但非会话成员读消息 → 403/404', strangerLogin.ok && (crossRead.status() === 403 || crossRead.status() === 404), { login: strangerLogin.status, status: crossRead.status() })

    record('页面无未捕获 JS 错误', pageErrors.length === 0, { errors: pageErrors.slice(0, 3) })

    const passed = results.filter((r) => r.ok).length
    const failed = results.filter((r) => !r.ok).length
    const verdict = failed === 0 ? 'PASS' : 'FAIL'

    snapshot = {
      task: 'V25.6 UX04/UX05 two independent browser contexts, real UI chat',
      verdict,
      passed,
      failed,
      base: BASE,
      db: DB_FILE,
      conversationId: CONV,
      baselineMessages: baseline,
      finalMessages: msgs.length,
      messageA: msgA,
      messageB: msgB,
      sendReceipts,
      pageErrors,
      screenshots: [shotA, shotB].map((p) => path.relative(ROOT, p)),
      steps: results,
      generatedAt: new Date().toISOString(),
      // 诚实边界：Pusher 未配置时靠页面 seq 增量轮询（真实浏览器自身行为），非外部注入
      notes: [
        '消息由两个隔离 BrowserContext 在真实页面 input 输入并回车发出，经 /api/im/send 鉴权落库，非 DB 脚本写入。',
        '接收端靠页面自身的 afterSeq 轮询自动到达；Pusher 实时推送本轮未配置，未宣称实时性。',
        '本轮为本地 next start + 隔离 file: 库，非生产；真人盲测、双物理设备、真实模型 AI 草稿不在此证明范围。',
      ],
    }
  } finally {
    await browser.close()
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(snapshot, null, 2))
  const md = [
    '# V25.6 UX04/UX05 · 双浏览器真实聊天端到端证明',
    '',
    `- **结论**：${snapshot.verdict}（${snapshot.passed} PASS / ${snapshot.failed} FAIL）`,
    `- 生成时间：${snapshot.generatedAt}`,
    `- 会话：\`${CONV}\` ｜ 基线消息 ${snapshot.baselineMessages} → 结束 ${snapshot.finalMessages}`,
    '',
    '## 步骤与判据',
    '',
    '| 步骤 | 结果 | 备注 |',
    '|---|---|---|',
    ...snapshot.steps.map((s) => `| ${s.step} | ${s.ok ? 'PASS' : 'FAIL'} | ${s.note ?? (s.status !== undefined ? 'status=' + s.status : '')} |`),
    '',
    '## 截图（真实浏览器像素）',
    '',
    ...snapshot.screenshots.map((p) => `- \`${p}\``),
    '',
    '## 诚实边界',
    '',
    ...snapshot.notes.map((n) => `- ${n}`),
    '',
  ].join('\n')
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), md)

  console.log(`\n=== VERDICT: ${snapshot.verdict} (${snapshot.passed}/${snapshot.passed + snapshot.failed}) ===`)
  console.log(`=== EVIDENCE: ${path.relative(ROOT, path.join(OUT, 'report.json'))} ===`)
  process.exit(snapshot.verdict === 'PASS' ? 0 : 1)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(2)
})
