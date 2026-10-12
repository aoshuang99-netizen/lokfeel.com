/**
 * T06 · 运营告警（`alerts.ts`）—— R9「死信无主动推送」的消解
 *
 * 验的是四件事：
 *   1. **判据与视图一致**（共用 `ATTENTION_JOB_STATUSES`，这里断言查询用了这三个状态）；
 *   2. **按日去重**（同一租户同一人一天一条，第二次是 replay 而不是再投）；
 *   3. **防回路**：告警**不产生 WorkflowJob**（断言 `db.workflowJob.create` 从未被调用）；
 *   4. **不吞不炸**：投递失败只计数、不留孤儿（无收件人时记 orphanedOrgs）。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@/lib/db', () => ({
  db: {
    workflowJob: { groupBy: jest.fn(), create: jest.fn() },
    organization: { findMany: jest.fn() },
    membership: { findMany: jest.fn() },
    notification: { create: jest.fn() },
    notificationDelivery: { findUnique: jest.fn(), upsert: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}))

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))

jest.mock('@/lib/tenancy/audit', () => ({ writeTenantAudit: jest.fn() }))

import { db } from '@/lib/db'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import {
  alertDayKey,
  alertOperatorsOfAttention,
  operatorAlertDedupeKey,
  OPERATOR_ALERT_TEMPLATE,
} from '@/lib/workflow/alerts'
import { SENDER_ATTRIBUTION_SUFFIX } from '@/lib/workflow/notification-content'

const groupBy = db.workflowJob.groupBy as unknown as jest.Mock
const jobCreate = db.workflowJob.create as unknown as jest.Mock
const orgFindMany = db.organization.findMany as unknown as jest.Mock
const memberFindMany = db.membership.findMany as unknown as jest.Mock
const notifCreate = db.notification.create as unknown as jest.Mock
const deliveryFindUnique = db.notificationDelivery.findUnique as unknown as jest.Mock
const deliveryUpsert = db.notificationDelivery.upsert as unknown as jest.Mock
const auditWrite = writeTenantAudit as unknown as jest.Mock

const ORG = 'org_1'
const NOW = new Date('2026-10-12T03:00:00.000Z')

function deliveryRow(over: Record<string, unknown> = {}) {
  return {
    id: 'nd_1',
    organizationId: ORG,
    dedupeKey: operatorAlertDedupeKey('u_1', NOW),
    channel: 'IN_APP',
    status: 'SENT',
    recipientId: 'u_1',
    template: OPERATOR_ALERT_TEMPLATE,
    subject: 's',
    body: 'b',
    actionUrl: null,
    capturedAt: null,
    provider: 'in-app',
    providerMessageId: null,
    failureReason: null,
    sentAt: NOW,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  groupBy.mockResolvedValue([{ organizationId: ORG, _count: { _all: 2 } }])
  orgFindMany.mockResolvedValue([{ id: ORG, name: '静山读书会' }])
  memberFindMany.mockResolvedValue([{ userId: 'u_1' }, { userId: 'u_2' }])
  notifCreate.mockResolvedValue({ id: 'n_1' })
  deliveryFindUnique.mockResolvedValue(null)
  deliveryUpsert.mockImplementation(async (args: any) => deliveryRow({ dedupeKey: args?.create?.dedupeKey }))
  auditWrite.mockResolvedValue(undefined)
})

describe('T06 · 告警键（纯函数）', () => {
  it('alertDayKey 用 UTC 天，跨时区不会把同一天劈成两条', () => {
    expect(alertDayKey(new Date('2026-10-12T23:59:59.000Z'))).toBe('2026-10-12')
    expect(alertDayKey(new Date('2026-10-13T00:00:01.000Z'))).toBe('2026-10-13')
  })

  it('operatorAlertDedupeKey 把收件人编进键里（否则第二个运营收不到）', () => {
    const a = operatorAlertDedupeKey('u_1', NOW)
    const b = operatorAlertDedupeKey('u_2', NOW)
    expect(a).not.toBe(b)
    expect(a).toContain('2026-10-12')
    expect(a).toContain('u_1')
  })
})

describe('T06 · alertOperatorsOfAttention', () => {
  it('无待处置任务 → 空报告，且不写任何东西', async () => {
    groupBy.mockResolvedValue([])
    const r = await alertOperatorsOfAttention({ now: NOW })
    expect(r).toEqual({
      scannedOrgs: 0,
      alertedOrgs: 0,
      delivered: 0,
      replayed: 0,
      failed: 0,
      orphanedOrgs: 0,
    })
    expect(notifCreate).not.toHaveBeenCalled()
    expect(auditWrite).not.toHaveBeenCalled()
  })

  it('判据与运营视图一致：查询用的是 DEAD / TAKEN_OVER / FAILED', async () => {
    await alertOperatorsOfAttention({ now: NOW })
    const arg = groupBy.mock.calls[0][0]
    expect(arg.where.status.in).toEqual(['DEAD', 'TAKEN_OVER', 'FAILED'])
  })

  it('有两个运营 → 两条站内信，且审计写一条 workflow.operator_alerted', async () => {
    const r = await alertOperatorsOfAttention({ now: NOW })
    expect(r.scannedOrgs).toBe(1)
    expect(r.alertedOrgs).toBe(1)
    expect(r.delivered).toBe(2)
    expect(r.failed).toBe(0)
    expect(notifCreate).toHaveBeenCalledTimes(2)

    const auditEvent = auditWrite.mock.calls[0][0]
    expect(auditEvent.eventType).toBe('workflow.operator_alerted')
    expect(auditEvent.organizationId).toBe(ORG)
    expect(auditEvent.actorId).toBeNull() // 系统触发
  })

  it('🔴 防回路：告警绝不产生 WorkflowJob', async () => {
    await alertOperatorsOfAttention({ now: NOW })
    expect(jobCreate).not.toHaveBeenCalled()
  })

  it('内容零业务文本 + 必带身份声明', async () => {
    await alertOperatorsOfAttention({ now: NOW })
    const data = notifCreate.mock.calls[0][0].data
    expect(data.body).toContain(SENDER_ATTRIBUTION_SUFFIX)
    // 不出现任务标题/理由之类的业务文本位
    expect(data.title).toBe('有连接任务需要人工处置')
    expect(data.data).toContain('"kind":"connection-workflow"')
  })

  it('已有当日投递 → replay，不重复投递（按日去重）', async () => {
    deliveryFindUnique.mockResolvedValue(deliveryRow({ status: 'SENT' }))
    const r = await alertOperatorsOfAttention({ now: NOW })
    expect(r.replayed).toBe(2)
    expect(r.delivered).toBe(0)
    expect(notifCreate).not.toHaveBeenCalled()
  })

  it('有待处置任务但无 OWNER/ADMIN/OPERATOR → 记 orphanedOrgs，不炸', async () => {
    memberFindMany.mockResolvedValue([])
    const r = await alertOperatorsOfAttention({ now: NOW })
    expect(r.orphanedOrgs).toBe(1)
    expect(r.delivered).toBe(0)
    expect(notifCreate).not.toHaveBeenCalled()
  })

  it('某个收件人投递失败 → 只计数，不中断其余收件人', async () => {
    notifCreate.mockRejectedValueOnce(new Error('boom'))
    const r = await alertOperatorsOfAttention({ now: NOW })
    expect(r.failed).toBe(1)
    expect(r.delivered).toBe(1)
    expect(r.alertedOrgs).toBe(1)
  })

  it('读收件人失败 → 只计数、跳过该租户，不抛出', async () => {
    memberFindMany.mockRejectedValue(new Error('db down'))
    const r = await alertOperatorsOfAttention({ now: NOW })
    expect(r.failed).toBe(1)
    expect(r.orphanedOrgs).toBe(0)
    expect(notifCreate).not.toHaveBeenCalled()
  })
})
