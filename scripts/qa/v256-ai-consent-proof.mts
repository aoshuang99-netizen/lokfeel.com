/**
 * V25.6 UX06 · 服务端 AI 处理授权真实 DB 集成证明（隔离库 / 不部署 / 不扣款）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 与 ai-consent.test.ts（纯函数穷举）互补：这里用**真实 Prisma 落隔离库**，
 * 验证服务端签发 → 查库校验 → 撤销 → 重放失效的完整链路，证明 consentRef
 * 是"服务端事实"而非"客户端字符串"。
 *
 * ── 诚实边界 ──────────────────────────────────────────────────────
 *   · 隔离库 /tmp/v256-consent.db，与生产无关；零真实扣款、零对外消息；
 *   · 本脚本证明的是**授权门**正确性，不证明真实模型翻译质量（无云凭据，
 *     标 PROVIDER_NOT_TESTED）；
 *   · 通过服务端函数进程内调用，非 TCP HTTP（HTTP 层由 jest 路由测试覆盖）。
 *
 * 用法：
 *   E2E_DB_FILE=/tmp/v256-consent.db E2E_DDL_FILE=/tmp/v256-consent-ddl.sql \
 *     env -u NODE_OPTIONS node scripts/qa/seed-t02-e2e.mjs --reset --regenerate
 *   V256_DB_FILE=/tmp/v256-consent.db env -u NODE_OPTIONS npx tsx \
 *     scripts/qa/v256-ai-consent-proof.mts --out=docs/v25.6/evidence/UX06_AI_CONSENT_DB_PROOF.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const DB_FILE = process.env.V256_DB_FILE || '/tmp/v256-consent.db'
process.env.DATABASE_URL = `file:${DB_FILE}`
;(process.env as Record<string, string>)['NODE_ENV'] = 'test'

const arg = (name: string, fallback: string) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

const consent = await import('@/lib/social-ai/ai-consent')
const dbmod = await import('@/lib/db')
const db = dbmod.db

const OWNER = 'u_e2e_owner'
const MEMBER = 'u_e2e_member'
const CONV = 'conv_v256_consent_proof'
const hash = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex').slice(0, 16)

interface Step {
  id: string
  scenario: string
  result: Record<string, unknown>
}
const steps: Step[] = []
const failures: string[] = []
const expect = (cond: boolean, msg: string) => { if (!cond) failures.push(msg) }
const step = (id: string, scenario: string, result: Record<string, unknown>) => steps.push({ id, scenario, result })

try {
  // ── 0. 夹具会话（owner + member 都是成员）────────────────────────
  await db.conversation.upsert({
    where: { id: CONV },
    create: { id: CONV, userAId: OWNER, userBId: MEMBER, initiatorId: OWNER },
    update: {},
  })
  step('S0', '夹具：owner+member 真实会话', { conversationId: CONV, userAId: OWNER, userBId: MEMBER })

  // ── 1. 服务端签发（本人会话 / cloud 用途）────────────────────────
  const issued = await consent.issueAIProcessingConsent({
    userId: OWNER,
    conversationId: CONV,
    purpose: 'translate',
    recipientScope: CONV,
    processingLocation: 'cloud',
    modelScope: null,
    requestId: 'v256_proof_req_1',
    ttlMs: 15 * 60 * 1000,
  })
  expect(issued.ok === true, 'S1 issue must succeed for session member')
  if (!issued.ok) throw new Error('issue failed: ' + issued.reason)
  const ref = issued.consentRef
  // 服务端签发 = 真实落库；查库确认记录存在且主体正确
  const row = await db.aIProcessingConsent.findUnique({ where: { id: ref } })
  expect(!!row && row.userId === OWNER && row.status === 'ACTIVE', 'S1 consentRef must be persisted server-side')
  step('S1', '服务端签发 consentRef 并落库', { consentRef: ref, persisted: !!row, userId: row?.userId, status: row?.status })

  // ── 2. 合法授权 → 校验通过 ──────────────────────────────────────
  const ok = await consent.verifyAIProcessingConsent({
    consentRef: ref, userId: OWNER, conversationId: CONV, purpose: 'translate',
    recipientScope: CONV, wantsCloud: true,
  })
  expect(ok.ok === true, 'S2 valid consent must verify')
  step('S2', '合法授权查库校验通过', { ok: ok.ok, reason: ok.ok ? null : ok.reason })

  // ── 3. 客户端伪造 consentRef → 查库拒绝 ──────────────────────────
  const forged = await consent.verifyAIProcessingConsent({
    consentRef: 'client_made_up_consent_xyz', userId: OWNER, conversationId: CONV,
    purpose: 'translate', recipientScope: CONV, wantsCloud: true,
  })
  expect(forged.ok === false && forged.reason === 'CONSENT_NOT_FOUND', 'S3 forged ref must be rejected')
  step('S3', '客户端伪造 consentRef → CONSENT_NOT_FOUND', { ok: forged.ok, reason: forged.ok ? null : forged.reason })

  // ── 4. 拿他人授权（owner ≠ 发起者）→ 拒绝 ────────────────────────
  const wrongOwner = await consent.verifyAIProcessingConsent({
    consentRef: ref, userId: MEMBER, conversationId: CONV, purpose: 'translate',
    recipientScope: CONV, wantsCloud: true,
  })
  expect(wrongOwner.ok === false && wrongOwner.reason === 'CONSENT_OWNER_MISMATCH', 'S4 wrong owner must be rejected')
  step('S4', '跨用户复用授权 → CONSENT_OWNER_MISMATCH', { ok: wrongOwner.ok, reason: wrongOwner.ok ? null : wrongOwner.reason })

  // ── 5. 用途不符 → 拒绝 ──────────────────────────────────────────
  const wrongPurpose = await consent.verifyAIProcessingConsent({
    consentRef: ref, userId: OWNER, conversationId: CONV, purpose: 'expression',
    recipientScope: CONV, wantsCloud: true,
  })
  expect(wrongPurpose.ok === false && wrongPurpose.reason === 'CONSENT_PURPOSE_MISMATCH', 'S5 wrong purpose must be rejected')
  step('S5', 'translate 授权挪作 expression → CONSENT_PURPOSE_MISMATCH', { ok: wrongPurpose.ok, reason: wrongPurpose.ok ? null : wrongPurpose.reason })

  // ── 6. 本人撤销 → 成功；撤销后重放即时失效 ────────────────────────
  const revoked = await consent.revokeAIProcessingConsent({ consentRef: ref, userId: OWNER })
  expect(revoked.ok === true, 'S6 owner revoke must succeed')
  const afterRevoke = await consent.verifyAIProcessingConsent({
    consentRef: ref, userId: OWNER, conversationId: CONV, purpose: 'translate',
    recipientScope: CONV, wantsCloud: true,
  })
  expect(afterRevoke.ok === false && afterRevoke.reason === 'CONSENT_REVOKED', 'S6 revoked ref must fail closed')
  // 非本人撤销必须失败
  const badRevoke = await consent.revokeAIProcessingConsent({ consentRef: ref, userId: MEMBER })
  expect(badRevoke.ok === false, 'S6 non-owner revoke must fail')
  step('S6', '本人撤销成功 + 重放失效 + 非本人撤销失败', {
    revoke: revoked.ok, replay: afterRevoke.ok ? null : afterRevoke.reason, badRevoke: badRevoke.ok,
  })

  // ── 7. 签发一条限定模型的授权 → 模型不符拒绝、匹配通过 ────────────
  const scoped = await consent.issueAIProcessingConsent({
    userId: OWNER, conversationId: CONV, purpose: 'expression', recipientScope: CONV,
    processingLocation: 'cloud', modelScope: 'deepseek-v4.1-flash', ttlMs: 60000,
  })
  expect(scoped.ok === true, 'S7 scoped issue must succeed')
  if (scoped.ok) {
    const wrongModel = await consent.verifyAIProcessingConsent({
      consentRef: scoped.consentRef, userId: OWNER, conversationId: CONV, purpose: 'expression',
      recipientScope: CONV, wantsCloud: true, modelId: 'other-model',
    })
    expect(wrongModel.ok === false && wrongModel.reason === 'CONSENT_MODEL_NOT_ALLOWED', 'S7 wrong model must be rejected')
    step('S7', '模型范围授权：换模型被拒', { ok: wrongModel.ok, reason: wrongModel.ok ? null : wrongModel.reason })
  }

  // ── 8. local 授权 + 想上云 → 拒绝 ────────────────────────────────
  const localOnly = await consent.issueAIProcessingConsent({
    userId: OWNER, conversationId: CONV, purpose: 'translate', recipientScope: CONV,
    processingLocation: 'local', ttlMs: 60000,
  })
  expect(localOnly.ok === true, 'S8 local issue must succeed')
  if (localOnly.ok) {
    const wantsCloud = await consent.verifyAIProcessingConsent({
      consentRef: localOnly.consentRef, userId: OWNER, conversationId: CONV, purpose: 'translate',
      recipientScope: CONV, wantsCloud: true,
    })
    expect(wantsCloud.ok === false && wantsCloud.reason === 'CONSENT_CLOUD_NOT_AUTHORIZED', 'S8 local grant must block cloud')
    step('S8', 'local 授权 + wantsCloud=true → CONSENT_CLOUD_NOT_AUTHORIZED', { ok: wantsCloud.ok, reason: wantsCloud.ok ? null : wantsCloud.reason })
  }
} catch (err) {
  failures.push(`FATAL: ${err instanceof Error ? err.message : String(err)}`)
}

const report = {
  task: 'UX06 服务端 AI 处理授权 DB 证明',
  version: 'V25.6',
  generatedAt: new Date().toISOString(),
  dbFile: DB_FILE,
  isolation: 'local libSQL file, production untouched',
  scope: '服务端授权门（非真实模型质量；PROVIDER_NOT_TESTED）',
  steps,
  failures,
  verdict: failures.length === 0 ? 'PASS' : 'FAIL',
  inputHash: hash(JSON.stringify(steps.map((s) => s.id + s.scenario))),
}

const outPath = path.resolve(ROOT, arg('out', 'docs/v25.6/evidence/UX06_AI_CONSENT_DB_PROOF.json'))
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ verdict: report.verdict, steps: steps.length, failures, outPath }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
