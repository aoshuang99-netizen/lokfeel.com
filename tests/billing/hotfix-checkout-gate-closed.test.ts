/**
 * S-02 Hotfix · 收银台**服务端真拒绝**（路由级，不是门函数级）
 *
 * 任务书 S-02 验收原文：「新 checkout 被服务端拒绝」。
 * 只测 `readCheckoutGate()` 返回 false **不够** —— 那只能证明门函数会算，
 * 不能证明路由真的把它接上了。本文件 import 真实路由处理器，
 * 用真实 `src/config/products.ts`（`PENDING_APPROVAL`）打请求，断言 HTTP 503 + `PRICING_NOT_APPROVED`。
 *
 * 关键设计：**凭据全部给齐**（live_mode），
 * 因为「没有凭据所以拒绝」是最容易被误认成功的假绿 ——
 * 那样即使商业门完全失效，测试也会因为 `PAYMENT_NOT_CONFIGURED` 而"看起来被拒"。
 */

jest.mock('@/lib/auth/auth', () => ({ requireAuth: jest.fn(), auth: jest.fn() }))
jest.mock('@/lib/tenancy/resolve', () => ({ resolveActiveTenant: jest.fn() }))
jest.mock('@/lib/tenancy/guard', () => ({ hasCapability: jest.fn() }))
jest.mock('@/lib/payments/availability', () => ({
  isPaymentChannelReady: jest.fn(),
  missingForChannel: jest.fn(() => []),
}))
jest.mock('@/lib/payments/dodo/config', () => ({
  readDodoConfig: jest.fn(),
  readStoreReadiness: jest.fn(),
}))
jest.mock('@/lib/payments/dodo/store', () => ({ readOrgSubscription: jest.fn() }))
jest.mock('@/lib/payments/dodo/client', () => ({
  createCheckoutSession: jest.fn(),
  DodoApiError: class DodoApiError extends Error {},
}))

import { NextRequest } from 'next/server'

import { requireAuth } from '@/lib/auth/auth'
import { resolveActiveTenant } from '@/lib/tenancy/resolve'
import { hasCapability } from '@/lib/tenancy/guard'
import { isPaymentChannelReady } from '@/lib/payments/availability'
import { readDodoConfig, readStoreReadiness } from '@/lib/payments/dodo/config'
import { readOrgSubscription } from '@/lib/payments/dodo/store'

import { POST } from '@/app/api/payments/dodo/checkout/route'

const mockRequireAuth = requireAuth as jest.Mock
const mockResolveTenant = resolveActiveTenant as jest.Mock
const mockHasCapability = hasCapability as jest.Mock
const mockChannelReady = isPaymentChannelReady as jest.Mock
const mockReadConfig = readDodoConfig as jest.Mock
const mockStoreReadiness = readStoreReadiness as jest.Mock
const mockReadOrgSub = readOrgSubscription as jest.Mock

function post(body: unknown = { plan: 'STARTER', interval: 'monthly' }): NextRequest {
  return new NextRequest('https://app.lokfeel.com/api/payments/dodo/checkout', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  // 注意：路由是 `({ user } = await requireAuth())` 解构，mock 必须带 `user` 包一层。
  // 直接返回 `{ id }` 会让 `user.id` 抛 TypeError 并被 catch 成 409 NO_ORGANIZATION，
  // 看起来像"组织不存在"，实则测试夹具错了 —— 这条坑已记录在文件末尾。
  mockRequireAuth.mockResolvedValue({ user: { id: 'user_1' } })
  mockResolveTenant.mockResolvedValue({
    organizationId: 'org_1',
    userId: 'user_1',
    role: 'OWNER',
    membershipId: 'mem_1',
  })
  mockHasCapability.mockReturnValue(true)
  // 技术通道**完全就绪** —— 唯一挡住它的必须是商业门
  mockChannelReady.mockReturnValue(true)
  mockReadConfig.mockReturnValue({ ok: true, config: { environment: 'live_mode' } })
  mockStoreReadiness.mockReturnValue({ ready: true, missingCredentials: [], unboundProducts: [] })
  mockReadOrgSub.mockResolvedValue({ status: 'NONE', plan: null })
})

test('H1 · 真实目录为 PENDING_APPROVAL ⇒ 路由返回 503 PRICING_NOT_APPROVED', async () => {
  const res = await POST(post())
  const body = await res.json()

  expect(res.status).toBe(503)
  expect(body.code).toBe('PRICING_NOT_APPROVED')
  expect(body.approvalStatus).toBe('PENDING_APPROVAL')
  // 绝不能是"未配置" —— 那会掩盖商业门失效
  expect(body.code).not.toBe('PAYMENT_NOT_CONFIGURED')
})

test('H2 · 拒绝发生在**创建结账会话之前**（不得先调上游再拒）', async () => {
  const { createCheckoutSession } = jest.requireMock('@/lib/payments/dodo/client')
  await POST(post())
  expect(createCheckoutSession).not.toHaveBeenCalled()
})

test('H3 · 响应禁止缓存（否则 CDN 会把"已关"缓存成"可买"或反之）', async () => {
  const res = await POST(post())
  expect(res.headers.get('cache-control')).toContain('no-store')
})

test('H4 · 未登录仍然 401（商业门不得把认证短路掉）', async () => {
  mockRequireAuth.mockRejectedValueOnce(new Error('no session'))
  const res = await POST(post())
  expect(res.status).toBe(401)
})

test('H5 · 非法请求体仍然 400（前置校验未被门替换）', async () => {
  const res = await POST(post({ plan: 'FREE_HACK', interval: 'monthly' }))
  expect(res.status).toBe(400)
})
