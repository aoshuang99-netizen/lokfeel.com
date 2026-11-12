/**
 * S-02 Hotfix · 收银台**正控**：商业门放行时必须能真的买到
 *
 * 为什么必须有这个文件：
 *   如果一个 hotfix 把 checkout 永久打死，只测「被拒绝」会全绿 ——
 *   那是把"故障"当成"修复"。本文件把 `products.ts` mock 成 APPROVED + approvalRef，
 *   其余条件与 `hotfix-checkout-gate-closed.test.ts` 完全一致，
 *   断言 HTTP 200 且拿到 `checkoutUrl`。
 *
 * 两者合起来的含义才是可审计的：
 *   **同一份代码，唯一的变量是定价批准状态；关则 503，开则 200。**
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
jest.mock('@/lib/db', () => ({
  db: { user: { findUnique: jest.fn() } },
}))
// 正控的唯一变量：定价已获人工批准
jest.mock('@/config/products', () => ({
  getProduct: () => ({
    id: 'connection-os',
    pricing: { status: 'APPROVED', approvalRef: 'TEST-ONLY-HUMAN-APPROVAL' },
    checkout: { kind: 'internal', label: '订阅' },
  }),
}))

import { NextRequest } from 'next/server'

import { requireAuth } from '@/lib/auth/auth'
import { resolveActiveTenant } from '@/lib/tenancy/resolve'
import { hasCapability } from '@/lib/tenancy/guard'
import { isPaymentChannelReady } from '@/lib/payments/availability'
import { readDodoConfig, readStoreReadiness } from '@/lib/payments/dodo/config'
import { readOrgSubscription } from '@/lib/payments/dodo/store'
import { createCheckoutSession } from '@/lib/payments/dodo/client'
import { db } from '@/lib/db'

import { POST } from '@/app/api/payments/dodo/checkout/route'

const mockRequireAuth = requireAuth as jest.Mock
const mockResolveTenant = resolveActiveTenant as jest.Mock
const mockHasCapability = hasCapability as jest.Mock
const mockChannelReady = isPaymentChannelReady as jest.Mock
const mockReadConfig = readDodoConfig as jest.Mock
const mockStoreReadiness = readStoreReadiness as jest.Mock
const mockReadOrgSub = readOrgSubscription as jest.Mock
const mockCreateSession = createCheckoutSession as jest.Mock
const mockFindUser = (db as unknown as { user: { findUnique: jest.Mock } }).user.findUnique

const ENV_KEYS = [
  'DODO_PRODUCT_STARTER_MONTHLY',
  'DODO_PRODUCT_STARTER_YEARLY',
  'DODO_PRODUCT_GROWTH_MONTHLY',
  'DODO_PRODUCT_GROWTH_YEARLY',
  'DODO_PRODUCT_SCALE_MONTHLY',
  'DODO_PRODUCT_SCALE_YEARLY',
]

beforeAll(() => {
  for (const k of ENV_KEYS) process.env[k] = `prod_test_${k.toLowerCase()}`
})

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireAuth.mockResolvedValue({ user: { id: 'user_1' } })
  mockResolveTenant.mockResolvedValue({
    organizationId: 'org_1',
    userId: 'user_1',
    role: 'OWNER',
    membershipId: 'mem_1',
  })
  mockHasCapability.mockReturnValue(true)
  mockChannelReady.mockReturnValue(true)
  mockReadConfig.mockReturnValue({ ok: true, config: { environment: 'test_mode' } })
  mockStoreReadiness.mockReturnValue({ ready: true, missingCredentials: [], unboundProducts: [] })
  mockReadOrgSub.mockResolvedValue({ status: 'NONE', plan: null })
  mockFindUser.mockResolvedValue({ email: 'owner@example.com', name: 'Owner' })
  mockCreateSession.mockResolvedValue({ session_id: 'cks_test_1', checkout_url: 'https://checkout.dodopayments.com/test/cks_test_1' })
})

function post(): NextRequest {
  return new NextRequest('https://app.lokfeel.com/api/payments/dodo/checkout', {
    method: 'POST',
    body: JSON.stringify({ plan: 'STARTER', interval: 'monthly' }),
    headers: { 'content-type': 'application/json' },
  })
}

test('H6 · 定价 APPROVED + 有 approvalRef ⇒ 放行并创建会话（证明门不是永久关闭）', async () => {
  const res = await POST(post())
  const body = await res.json()

  expect(res.status).toBe(200)
  expect(body.ok).toBe(true)
  expect(body.checkoutUrl).toContain('dodopayments.com')
  expect(mockCreateSession).toHaveBeenCalledTimes(1)
})

test('H7 · 放行时 metadata 必须带 organizationId 与 plan（webhook 唯一可信上下文）', async () => {
  await POST(post())
  const [, input] = mockCreateSession.mock.calls[0]
  expect(input.metadata).toMatchObject({ organizationId: 'org_1', plan: 'STARTER', interval: 'monthly' })
  expect(input.productId).toBe(process.env.DODO_PRODUCT_STARTER_MONTHLY)
})
