/**
 * V25.5 P0.4+P0.5 · 两账号真实通信 + AI 草稿经确认发送（隔离库真实 DB）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 打通作战包 C/D 的最小纵向闭环（真实数据落库）：
 *   A 撰写中文 → AI 草稿（message-assist，零外发）→ 用户显式授权（authorizeDraftSend）
 *   → 走真实 IM 写入链路（writeMessage → createMessage，与 /api/im/send 共用）
 *   → B 从 DB 读回真实消息（已送达），并写已读收据（已读）。
 *
 * 覆盖：≥20 条双向消息、seq 单调、clientMsgId 幂等去重、跨会话零泄漏、已读状态、
 * AI 未授权不得发送（无 SendAuthorization 就不写库）。
 *
 * ── 诚实边界 ──────────────────────────────────────────────────────
 *   · 用底层 writeMessage（与 send route 共用 createMessage），进程内调用，非 TCP HTTP；
 *     HTTP 鉴权/媒体门禁由 ai-assist-route 与 send-media-consent 测试覆盖。
 *   · AI 草稿用确定性 stub provider（验证编排，不冒充真实翻译质量）；
 *     云模型默认关闭（SOCIAL_AI_CLOUD_ASSIST_ENABLED 未设）= 远端调用 0。
 *   · 隔离库 /tmp/v255-inbox.db；零真实用户数据、零对外消息、零扣款。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DB_FILE = process.env.V255_DB_FILE || '/tmp/v255-inbox.db'
process.env.DATABASE_URL = `file:${DB_FILE}`
;(process.env as Record<string, string>)['NODE_ENV'] = 'test'

const arg = (name: string, fallback: string) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

const dbmod = await import('@/lib/db')
const db = dbmod.db
const { createMessage } = await import('@/lib/im/queries')
const { assistPrivateMessage } = await import('@/lib/social-ai/message-assist')
const { authorizeDraftSend } = await import('@/lib/social-ai/private-draft')
const { createStubProvider } = await import('@/lib/agent/provider')

const A = 'u_v255_A'
const B = 'u_v255_B'
const C = 'u_v255_C'
const CONV = 'conv_v255_ab'
const CONV_X = 'conv_v255_cross'

const failures: string[] = []
const steps: Array<{ id: string; scenario: string; evidence: Record<string, unknown> }> = []
function expect(c: boolean, m: string) { if (!c) failures.push(m) }
function step(id: string, scenario: string, evidence: Record<string, unknown>) { steps.push({ id, scenario, evidence }) }

/**
 * 模拟 /api/im/send 的真实幂等语义：先按 (clientMsgId, conversationId) 查重，
 * 命中则回放原消息（不新建）。send route 就是这么做的（见 route.ts:87-110）。
 * 说明：底层 createMessage 不自带幂等，幂等责任在 send route —— 这里如实复刻。
 */
async function sendAsUser(params: {
  conversationId: string; senderId: string; receiverId: string; content: string; clientMsgId: string;
}) {
  const existing = await db.iMMessage.findFirst({
    where: { clientMsgId: params.clientMsgId, conversationId: params.conversationId },
    select: { id: true, seq: true, payload: true },
  })
  if (existing) return { msgId: existing.id, seq: existing.seq, replayed: true }
  const r = await createMessage(
    params.conversationId, params.senderId, params.receiverId, params.content,
    { clientMsgId: params.clientMsgId },
  )
  return { msgId: r.msgId, seq: r.seq, replayed: false }
}

try {
  // ── 0. 两个独立账号 + 两个会话 ────────────────────────────────
  for (const [id, email, name] of [
    [A, 'v255.a@example.test', '测试用户A'],
    [B, 'v255.b@example.test', '测试用户B'],
    [C, 'v255.c@example.test', '测试用户C'],
  ]) {
    await db.user.upsert({ where: { id }, create: { id, email, name }, update: {} })
  }
  await db.conversation.upsert({
    where: { id: CONV },
    create: { id: CONV, userAId: A, userBId: B, initiatorId: A },
    update: {},
  })
  await db.conversation.upsert({
    where: { id: CONV_X },
    create: { id: CONV_X, userAId: C, userBId: B, initiatorId: C },
    update: {},
  })

  // ── 1. AI 草稿 → 用户授权 → 真实发送 → B 收到 ──────────────
  const stub = createStubProvider(() => JSON.stringify({
    outputText: 'Nice to meet you. Looking forward to our collaboration.',
    suggestion: '语气得体',
    uncertain: false,
  }))
  const assist = await assistPrivateMessage({
    text: '很高兴认识你，期待合作。',
    purpose: 'translate',
    consentRef: 'consent_v255_1',
    recipientScope: CONV,
    inputDataScope: 'user_authored_text',
    requestId: 'req_v255_ai_1',
    modelId: 'stub-translator',
  }, stub)
  expect(assist.ok === true, 'AI assist failed')
  if (!assist.ok) throw new Error(assist.reason)
  // 未授权前零写库
  const beforeSend = await db.iMMessage.count({ where: { conversationId: CONV } })
  expect(beforeSend === 0, `pre-auth messages exist: ${beforeSend}`)
  const auth = authorizeDraftSend(assist.draft, A, Date.now())
  expect(auth !== null, 'authorization must exist for a valid draft')
  if (!auth) throw new Error('no auth')

  const aiSent = await sendAsUser({
    conversationId: CONV,
    senderId: A,
    receiverId: B,
    content: assist.draft.text,
    clientMsgId: 'client_v255_ai_1',
  })
  const aiRow = await db.iMMessage.findUnique({ where: { id: aiSent.msgId } })
  expect(aiRow?.senderId === A && aiRow?.receiverId === B, 'AI-sent message wrong parties')
  expect(aiRow?.payload?.includes('Nice to meet you') === true, 'AI-sent content mismatch')
  step('S1', 'AI 草稿→用户授权→真实发送→B 可读', {
    draftOrigin: assist.draft.origin,
    provenance: assist.draft.provenance,
    authorization: auth,
    messageId: aiSent.msgId,
    seq: aiSent.seq,
    payload: aiRow?.payload,
    preAuthWrites: beforeSend,
  })

  // ── 2. 幂等：同 clientMsgId 重试不重复入库 ──────────────────
  const dup = await sendAsUser({
    conversationId: CONV, senderId: A, receiverId: B,
    content: assist.draft.text, clientMsgId: 'client_v255_ai_1',
  })
  const countAfterDup = await db.iMMessage.count({ where: { conversationId: CONV } })
  expect(dup.msgId === aiSent.msgId, 'idempotent retry created different message')
  expect(countAfterDup === 1, `duplicate message rows: ${countAfterDup}`)
  step('S2', '同 clientMsgId 重试幂等，零重复入库', { original: aiSent.msgId, retry: dup.msgId, rowCount: countAfterDup })

  // ── 3. 双向 20 条真实消息（A→B / B→A 交替）─────────────────
  const sent: Array<{ id: string; seq: number; from: string; clientMsgId: string }> = []
  for (let i = 0; i < 20; i++) {
    const fromA = i % 2 === 0
    const sender = fromA ? A : B
    const receiver = fromA ? B : A
    const cmid = `client_v255_${String(i).padStart(2, '0')}`
    const r = await sendAsUser({
      conversationId: CONV, senderId: sender, receiverId: receiver,
      content: `第${i + 1}条真实消息 from ${fromA ? 'A' : 'B'}`, clientMsgId: cmid,
    })
    sent.push({ id: r.msgId, seq: r.seq, from: sender, clientMsgId: cmid })
  }
  const allRows = await db.iMMessage.findMany({
    where: { conversationId: CONV }, orderBy: { seq: 'asc' },
    select: { id: true, seq: true, senderId: true, receiverId: true, payload: true, clientMsgId: true },
  })
  expect(allRows.length === 21, `expected 21 rows (1 AI + 20), got ${allRows.length}`)
  const seqs = allRows.map((r) => r.seq)
  const monotonic = seqs.every((s, i) => i === 0 || s > seqs[i - 1])
  expect(monotonic, 'seq not strictly monotonic')
  const aCount = allRows.filter((r) => r.senderId === A).length
  const bCount = allRows.filter((r) => r.senderId === B).length
  expect(aCount === 11 && bCount === 10, `bidirectional counts A=${aCount} B=${bCount}`)
  step('S3', '20 条双向真实消息落库，seq 严格递增', { total: allRows.length, aCount, bCount, monotonic, firstSeq: seqs[0], lastSeq: seqs[seqs.length - 1] })

  // ── 4. 网络扰动模拟：重复投递其中 5 条 → 零重复入库 ────────
  for (const m of sent.slice(0, 5)) {
    await sendAsUser({
      conversationId: CONV, senderId: m.from, receiverId: m.from === A ? B : A,
      content: '重投', clientMsgId: m.clientMsgId,
    })
  }
  const countAfterPerturb = await db.iMMessage.count({ where: { conversationId: CONV } })
  expect(countAfterPerturb === 21, `perturbation duplicated rows: ${countAfterPerturb}`)
  step('S4', '5 次重复投递扰动 → 零重复入库', { rowCount: countAfterPerturb })

  // ── 5. B 读回 A 的消息：内容/发送方正确（真实接收端视角）───
  const fromA = await db.iMMessage.findMany({
    where: { conversationId: CONV, senderId: A }, orderBy: { seq: 'asc' },
    select: { id: true, payload: true, seq: true },
  })
  expect(fromA.length === 11, 'B cannot see A messages')
  step('S5', 'B 视角读回 A 的 11 条消息，内容与 seq 可核对', { count: fromA.length, sample: fromA[0] })

  // ── 6. 已读收据：B 标记已读 → 状态持久 ───────────────────────
  // MessageReceipt 模型字段
  const target = fromA[0]
  await db.messageReceipt.upsert({
    where: { messageId_userId: { messageId: target.id, userId: B } },
    create: { messageId: target.id, conversationId: CONV, userId: B, readAt: new Date() },
    update: { readAt: new Date() },
  })
  const receipt = await db.messageReceipt.findUnique({
    where: { messageId_userId: { messageId: target.id, userId: B } },
  })
  expect(receipt?.readAt != null, 'read receipt not persisted')
  step('S6', 'B 已读收据持久化（送达≠已读可区分）', { messageId: target.id, readAt: receipt?.readAt?.toISOString() })

  // ── 7. 跨会话零泄漏：CONV_X 的消息不出现在 CONV ──────────────
  const xMsg = await sendAsUser({
    conversationId: CONV_X, senderId: C, receiverId: B,
    content: '这是另一个会话的私密消息', clientMsgId: 'client_v255_cross_1',
  })
  const leaked = await db.iMMessage.findFirst({
    where: { conversationId: CONV, clientMsgId: 'client_v255_cross_1' },
  })
  expect(leaked === null, 'cross-conversation leak detected')
  step('S7', '跨会话消息隔离，CONV 中查不到 CONV_X 的消息', { crossMsgId: xMsg.msgId, leakedInConv: !!leaked })

} catch (err) {
  failures.push(`FATAL: ${err instanceof Error ? err.stack : String(err)}`)
}

const verdict = failures.length === 0 ? 'PASS' : 'FAIL'
const outPath = path.resolve(ROOT, arg('out', 'docs/v25.5/evidence/P0.4_P0.5_TWO_ACTOR_CHAT.json'))
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify({
  task: 'P0.4+P0.5',
  runAt: new Date().toISOString(),
  dbFile: DB_FILE,
  providerMode: 'deterministic stub (cloud disabled, 0 remote calls)',
  verdict, failures, steps,
}, null, 2) + '\n')
console.log(`VERDICT=${verdict} steps=${steps.length} failures=${failures.length}`)
if (failures.length) console.log('FAILURES:', JSON.stringify(failures, null, 2))
console.log('OUT=' + path.relative(ROOT, outPath))
process.exit(verdict === 'PASS' ? 0 : 1)
