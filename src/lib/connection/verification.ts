/**
 * V21 · G09 —— 独立成果核验（服务层）
 *
 * 设计约束（G09 的关键）：
 *   - 服务端强制五道前置：sourceRunId / EXECUTED / 真实 AgentExecution 回执 /
 *     criteria 全 true / verifierId !== run.requestedBy，缺一 409；
 *   - strict 校验：proposal / modelOutput / spec 一律 400 MODEL_OUTPUT_NOT_EVIDENCE，
 *     其余未知字段也拒绝 —— **不把模型输出当核验证据**；
 *   - 响应只陈述事实（http 摘要 / DB 行 id / Audit 事件类型 / receipt 引用），
 *     **不宣布目标达成**；verificationLevel 恒为 COUNTERPARTY_CONFIRMED。
 *
 * 🔴 与 Outcome 体系的关系：Outcome 需要 proposalId，与 AgentRun 无关联，
 *    因此本批次用独立的 `ExecutionVerification` 表表达「这条 mission 的运行
 *    被第二人按验收判据核验过」，不复用、不假装写进 Outcome。
 */

import { db } from '@/lib/db'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import { asObject } from './input-helpers'

export interface VerificationCriterion {
  label: string
  confirmed: boolean
  note?: string
}

export interface ParsedVerification {
  criteria: VerificationCriterion[]
  evidenceNote: string | null
}

export interface VerificationGateFacts {
  sourceRunId: string | null
  runStatus: string | null
  hasReceipt: boolean
  criteria: VerificationCriterion[]
  verifierId: string
  requestedBy: string | null
}

export interface VerificationEvidence {
  http: { method: string; path: string; organizationId: string }
  dbRows: {
    verificationId: string
    missionId: string
    runId: string
    executionId: string
  }
  auditEventType: string
  receipt: {
    deliveryId: string | null
    deliveryStatus: string
    channel: string
    kind: string
  }
}

export interface VerificationResult {
  id: string
  organizationId: string
  missionId: string
  runId: string
  receiptRef: string | null
  verdict: string
  criteria: VerificationCriterion[]
  evidenceNote: string | null
  verifierId: string
  createdAt: string
  verificationLevel: 'COUNTERPARTY_CONFIRMED'
  evidence: VerificationEvidence
  /** 只陈述事实，不宣布目标达成。 */
  statement: string
}

/** 🔴 模型输出**不是**证据：这三个键在入口即被拒，且带专用语义码。 */
const MODEL_OUTPUT_KEYS = ['proposal', 'modelOutput', 'spec'] as const
const ALLOWED_KEYS = new Set(['criteria', 'evidenceNote'])
const CRITERION_KEYS = new Set(['label', 'confirmed', 'note'])
const EVIDENCE_NOTE_MAX = 1000
const AUDIT_EVENT_TYPE = 'mission.verification_recorded'

interface VerificationRow {
  id: string
  organizationId: string
  missionId: string
  runId: string
  receiptRef: string | null
  verdict: string
  criteriaJson: string
  evidenceNote: string | null
  verifierId: string
  createdAt: Date
}

interface ReceiptRow {
  id: string
  deliveryId: string | null
  deliveryStatus: string
  channel: string
  kind: string
}

export function parseVerificationBody(body: unknown): ParsedVerification {
  const b = asObject(body)

  // ① 模型输出当证据 → 400 专用码（优先于通用未知字段检查）。
  for (const key of MODEL_OUTPUT_KEYS) {
    if (key in b) {
      throw new ValidationError(`${key} is model output and is not admissible evidence`, {
        code: 'MODEL_OUTPUT_NOT_EVIDENCE',
        field: key,
      })
    }
  }
  // ② strict：其余未知字段一律拒绝（verdict / verifierId / 身份字段都不接受）。
  for (const key of Object.keys(b)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new ValidationError(`Unknown field: ${key}`, { field: key })
    }
  }

  if (!Array.isArray(b.criteria) || b.criteria.length === 0) {
    throw new ValidationError('criteria must be a non-empty array', { field: 'criteria' })
  }

  const criteria: VerificationCriterion[] = b.criteria.map((raw: unknown, index: number) => {
    const o = asObject(raw)
    for (const key of Object.keys(o)) {
      if (!CRITERION_KEYS.has(key)) {
        throw new ValidationError(`Unknown field in criteria[${index}]: ${key}`, { field: 'criteria' })
      }
    }
    if (typeof o.label !== 'string' || !o.label.trim()) {
      throw new ValidationError(`criteria[${index}].label must be a non-empty string`, { field: 'criteria' })
    }
    if (typeof o.confirmed !== 'boolean') {
      throw new ValidationError(`criteria[${index}].confirmed must be a boolean`, { field: 'criteria' })
    }
    if (o.note !== undefined && typeof o.note !== 'string') {
      throw new ValidationError(`criteria[${index}].note must be a string`, { field: 'criteria' })
    }
    return {
      label: (o.label as string).trim(),
      confirmed: o.confirmed as boolean,
      ...(typeof o.note === 'string' ? { note: (o.note as string).trim() } : {}),
    }
  })

  let evidenceNote: string | null = null
  if (b.evidenceNote !== undefined && b.evidenceNote !== null) {
    if (typeof b.evidenceNote !== 'string' || b.evidenceNote.length > EVIDENCE_NOTE_MAX) {
      throw new ValidationError(`evidenceNote must be a string of at most ${EVIDENCE_NOTE_MAX} chars`, {
        field: 'evidenceNote',
      })
    }
    evidenceNote = b.evidenceNote.trim() || null
  }

  return { criteria, evidenceNote }
}

/** 五道前置的**纯判定**：返回拒绝码，或 null 表示放行。 */
export function evaluateVerificationGate(
  facts: VerificationGateFacts
): { code: string; reason: string } | null {
  if (!facts.sourceRunId) {
    return { code: 'MISSION_NOT_LINKED', reason: 'Mission has no linked AgentRun' }
  }
  if (facts.runStatus !== 'EXECUTED') {
    return { code: 'RUN_NOT_EXECUTED', reason: 'Linked AgentRun is not EXECUTED' }
  }
  if (!facts.hasReceipt) {
    return { code: 'RECEIPT_MISSING', reason: 'No real AgentExecution receipt for the linked run' }
  }
  if (facts.criteria.length === 0 || !facts.criteria.every((c) => c.confirmed === true)) {
    return { code: 'CRITERIA_NOT_CONFIRMED', reason: 'Every acceptance criterion must be confirmed:true' }
  }
  if (facts.requestedBy && facts.verifierId === facts.requestedBy) {
    return { code: 'SELF_VERIFICATION_FORBIDDEN', reason: 'Verifier must differ from the run requester' }
  }
  return null
}

function toResult(row: VerificationRow, receipt: ReceiptRow | null): VerificationResult {
  const deliveryId = receipt?.deliveryId ?? row.receiptRef ?? null
  return {
    id: row.id,
    organizationId: row.organizationId,
    missionId: row.missionId,
    runId: row.runId,
    receiptRef: row.receiptRef ?? null,
    verdict: row.verdict,
    criteria: JSON.parse(row.criteriaJson) as VerificationCriterion[],
    evidenceNote: row.evidenceNote ?? null,
    verifierId: row.verifierId,
    createdAt: new Date(row.createdAt ?? Date.now()).toISOString(),
    verificationLevel: 'COUNTERPARTY_CONFIRMED',
    // 四重清单：只陈述事实，不宣布目标达成。
    evidence: {
      http: {
        method: 'POST',
        path: `/api/v1/missions/${row.missionId}/verification`,
        organizationId: row.organizationId,
      },
      dbRows: {
        verificationId: row.id,
        missionId: row.missionId,
        runId: row.runId,
        executionId: receipt?.id ?? '',
      },
      auditEventType: AUDIT_EVENT_TYPE,
      receipt: {
        deliveryId,
        deliveryStatus: receipt?.deliveryStatus ?? 'UNKNOWN',
        channel: receipt?.channel ?? 'UNKNOWN',
        kind: receipt?.kind ?? 'UNKNOWN',
      },
    },
    statement:
      '本记录仅陈述已核验的事实（HTTP 请求摘要 / DB 行 id / 审计事件类型 / 回执引用），' +
      '不宣布目标达成，也不把模型输出当作证据。',
  }
}

/** GET：核验记录或 **null**（不是空数组假绿）。带 organizationId 谓词。 */
export async function getVerification(
  ctx: TenantContext,
  missionId: string
): Promise<VerificationResult | null> {
  const row = (await db.executionVerification.findFirst({
    where: { missionId, organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
  })) as unknown as VerificationRow | null
  if (!row) return null

  const receipt = (await db.agentExecution.findFirst({
    where: { runId: row.runId, organizationId: ctx.organizationId },
    select: { id: true, deliveryId: true, deliveryStatus: true, channel: true, kind: true },
  })) as unknown as ReceiptRow | null
  return toResult(row, receipt)
}

export async function createVerification(
  ctx: TenantContext,
  missionId: string,
  body: unknown
): Promise<VerificationResult> {
  const parsed = parseVerificationBody(body)

  const mission = await db.mission.findFirst({
    where: { id: missionId, organizationId: ctx.organizationId },
    select: { id: true, sourceRunId: true },
  })
  if (!mission) throw new NotFoundError('Mission not found')

  // 三张事实表都带 organizationId 谓词；身份只取会话 ctx.userId。
  const run = mission.sourceRunId
    ? ((await db.agentRun.findFirst({
        where: { id: mission.sourceRunId, organizationId: ctx.organizationId },
        select: { id: true, status: true, requestedBy: true },
      })) as { id: string; status: string; requestedBy: string } | null)
    : null

  const receipt = mission.sourceRunId
    ? ((await db.agentExecution.findFirst({
        where: { runId: mission.sourceRunId, organizationId: ctx.organizationId },
        select: { id: true, deliveryId: true, deliveryStatus: true, channel: true, kind: true },
      })) as ReceiptRow | null)
    : null

  const denial = evaluateVerificationGate({
    sourceRunId: mission.sourceRunId,
    runStatus: run?.status ?? null,
    hasReceipt: Boolean(receipt),
    criteria: parsed.criteria,
    verifierId: ctx.userId,
    requestedBy: run?.requestedBy ?? null,
  })
  if (denial) throw new ConflictError(denial.reason, { code: denial.code })

  // 走到这里 gate 已放行：run 与 receipt 必然存在。
  const activeRun = run as { id: string; status: string; requestedBy: string }
  const activeReceipt = receipt as ReceiptRow

  let row: VerificationRow
  try {
    row = (await db.executionVerification.create({
      data: {
        organizationId: ctx.organizationId,
        missionId,
        runId: activeRun.id,
        receiptRef: activeReceipt.deliveryId,
        // 🔴 服务端派生，不接受客户端入参。
        verdict: 'CONFIRMED',
        criteriaJson: JSON.stringify(parsed.criteria),
        evidenceNote: parsed.evidenceNote,
        verifierId: ctx.userId,
      },
    })) as unknown as VerificationRow
  } catch (error) {
    // 🔴 真实 QA 取证发现：重复提交 / 并发撞 `@@unique([missionId, runId])` 时
    //    Prisma 抛 P2002，未映射会变成 500 INTERNAL_ERROR —— 既不是可判定的业务冲突，
    //    也会把「核验记录已存在」这个事实藏进 5xx。这里显式转成 409，
    //    且**不写审计**（没有新记录，不能留一条假事件）。
    const code = (error as { code?: unknown } | null)?.code
    const message = error instanceof Error ? error.message : ''
    const uniqueViolation =
      code === 'P2002' ||
      /unique constraint failed/i.test(message) ||
      /SQLITE_CONSTRAINT(_UNIQUE)?/i.test(String(code ?? ''))
    if (uniqueViolation) {
      throw new ConflictError('这条任务已经有核验记录，不能重复核验。', {
        code: 'VERIFICATION_ALREADY_RECORDED',
        missionId,
        runId: activeRun.id,
      })
    }
    throw error
  }

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: AUDIT_EVENT_TYPE,
    resourceType: 'execution_verification',
    resourceId: row.id,
    safeMetadata: {
      missionId,
      runId: activeRun.id,
      criterionCount: parsed.criteria.length,
      hasReceiptRef: Boolean(activeReceipt.deliveryId),
    },
  }).catch(() => {})

  return toResult(row, activeReceipt)
}
