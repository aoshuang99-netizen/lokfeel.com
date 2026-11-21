/**
 * GA-02 Hotfix 负例：已登录、凭据齐备也不得创建 Provider 结账会话。
 *
 * 只在生产祖先 b50e53e 的最小 fail-closed 分支运行。所有边界（auth、租户、
 * 配置、Provider 客户端）都是系统边界桩；被测行为是真实 checkout route 的
 * 商业门分支，而不是重新实现一遍 gate。
 */
import { POST } from '@/app/api/payments/dodo/checkout/route'

const createCheckoutSession = jest.fn(async () => ({ checkout_url: 'must-not-happen', session_id: 'must-not-happen' }))

jest.mock('@/lib/auth/auth', () => ({
  requireAuth: jest.fn(async () => ({ user: { id: 'u_hotfix_probe' } })),
}))
jest.mock('@/lib/db', () => ({
  db: { user: { findUnique: jest.fn(async () => ({ email: 'probe@example.test', name: 'Probe' })) } },
}))
jest.mock('@/lib/tenancy/capabilities', () => ({ can: () => true }))
jest.mock('@/lib/tenancy/resolve', () => ({
  resolveActiveTenant: jest.fn(async () => ({ organizationId: 'org_hotfix_probe', role: 'OWNER' })),
}))
jest.mock('@/lib/tenancy/guard', () => ({ hasCapability: () => true }))
jest.mock('@/lib/payments/availability', () => ({ isPaymentChannelReady: () => true }))
jest.mock('@/lib/payments/dodo/config', () => {
  const actual = jest.requireActual('@/lib/payments/dodo/config')
  return {
    ...actual,
    readDodoConfig: () => ({ ok: true, config: { environment: 'live_mode' } }),
  }
})
jest.mock('@/lib/payments/dodo/client', () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
  DodoApiError: class DodoApiError extends Error {},
}))
jest.mock('@/lib/payments/dodo/store', () => ({
  readOrgSubscription: jest.fn(async () => ({ status: 'NONE' })),
}))
jest.mock('@/lib/http/public-origin', () => ({ publicOriginOf: () => 'http://localhost:3104' }))

describe('GA-02 · checkout fail-closed', () => {
  beforeEach(() => {
    process.env.DODO_PAYMENTS_API_KEY = ['dodo', 'live', 'hotfix', 'placeholder'].join('_')
    process.env.DODO_PAYMENTS_ENVIRONMENT = 'live_mode'
  })

  it('PRICING_APPROVED=false 时已登录 checkout 被拒，Provider create 调用数为 0', async () => {
    const res = await POST({
      json: async () => ({ plan: 'STARTER', interval: 'monthly' }),
    } as never)
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe('PRICING_NOT_APPROVED')
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })
})
