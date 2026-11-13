/**
 * 收银台门禁 · 批准前后两条因果链
 *
 * 2026-11-12 生产只读取证曾证明：旧版 plans route 没有商业门，
 * `checkoutReady=true` 与 `live_mode` 同时出现在一门未获批的收银台上（R-15 的土壤）。
 * 2026-11-13 产品所有者下达重新定价指令，目录转为 APPROVED。
 *
 * 本套件因此钉住的是**两个方向**，而不是只钉住"关着"：
 *   · 已批准 + 有 approvalRef ⇒ 注入合法 live 凭据时 enabled 必须为 true；
 *   · 无凭据 ⇒ enabled 必须为 false（缺凭据不能靠"已批准"绕过）。
 *
 * 反过来，若哪天有人把 approvalRef 清空却又想开卖，`validateCatalog()` 与
 * `tests/commercial/products.test.ts` 会同时报红 —— 那才是"实现者自我授权"的入口。
 */
import { readCheckoutGate } from '@/lib/payments/commercial-gate'
import { getProduct } from '@/config/products'
import { readStoreReadiness } from '@/lib/payments/dodo/config'

/** 形状合法的假凭据（运行时拼接，源码里不留可误判为真实密钥的字面量）。 */
const LIVE_ENV: Record<string, string> = {
  DODO_PAYMENTS_API_KEY: ['dodo', 'live', 'p0', 'placeholder', '0123456789'].join('_'),
  DODO_PAYMENTS_ENVIRONMENT: 'live_mode',
}

describe('收银台门禁 · 真实目录（2026-11-13 重新定价后）', () => {
  it('真实目录为 APPROVED，且批准引用可溯源', () => {
    const pricing = getProduct('connection-os').pricing
    expect(pricing.status).toBe('APPROVED')
    expect(pricing.approvalRef).toBeTruthy()
    expect(pricing.approvalRef).toContain('PRICING_APPROVAL')
    expect(pricing.displayPrice).toBeTruthy()
  })

  it('注入完整凭据 + 已批准 ⇒ enabled 为 true（两道门都过）', () => {
    const gate = readCheckoutGate(LIVE_ENV)
    expect(gate.credentialsReady).toBe(true)
    expect(gate.commercialApproved).toBe(true)
    expect(gate.enabled).toBe(true)
    expect(gate.approval.status).toBe('APPROVED')
    expect(gate.approval.ref).toContain('PRICING_APPROVAL')
  })

  it('负控：没有凭据时，已批准也不能开卖', () => {
    const gate = readCheckoutGate({})
    expect(gate.enabled).toBe(false)
    expect(gate.credentialsReady).toBe(false)
    expect(gate.commercialApproved).toBe(true)
    // enabled 必须是两道门的合取，而不是任一道
    expect(gate.enabled).toBe(gate.credentialsReady && gate.commercialApproved)
  })

  it('unboundProducts 只暴露变量名，不含任何值', () => {
    const gate = readCheckoutGate(LIVE_ENV)
    const store = readStoreReadiness(LIVE_ENV)
    expect(store.ready).toBe(true)
    for (const name of gate.unboundProducts) {
      expect(name).toMatch(/^[A-Z0-9_]+$/)
    }
    // Scale 年付受通道单笔上限约束，必然落在未绑定集合里 —— 这一格按钮禁用，
    // 另外五格照常可售，不因一格缺失整页禁售。
    expect(gate.unboundProducts).toContain('DODO_PRODUCT_SCALE_YEARLY')
  })
})
