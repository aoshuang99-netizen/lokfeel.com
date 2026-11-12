/**
 * P0-01 / D2 因果链 · 候选代码是否天然关闭线上收银台
 *
 * 2026-11-12 16:10 生产只读取证（evidence/p0-01-production-risk.json）：
 *   生产 commit 5a161c4 → checkoutReady=true、environment=live_mode、
 *   commercialApproval 字段缺失（旧版 plans route 没有商业门）。
 *
 * 本套件用**真实目录**（不 mock getProduct）钉住候选代码的因果链：
 *   即使注入形态合法的 live Dodo 凭据，技术门通过，商业门仍因
 *   PENDING_APPROVAL + 无 approvalRef 而挡住 ⇒ checkoutReady 必为 false。
 * 这正是「发布候选 = 一次性完成 R-15 修复 + 收银台止损」的技术依据，
 * 也是 D2 选项 A 的实证；它**不是**发布授权，也不产生任何真实扣款。
 */
import { readCheckoutGate } from '@/lib/payments/commercial-gate'
import { getProduct } from '@/config/products'
import { readStoreReadiness } from '@/lib/payments/dodo/config'

/** 形状合法的假凭据（运行时拼接，源码里不留可误判为真实密钥的字面量）。 */
const LIVE_ENV: Record<string, string> = {
  DODO_PAYMENTS_API_KEY: ['dodo', 'live', 'p0', 'placeholder', '0123456789'].join('_'),
  DODO_PAYMENTS_ENVIRONMENT: 'live_mode',
}

describe('D2 因果链 · 候选代码商业门（真实目录）', () => {
  it('真实目录当前为 PENDING_APPROVAL 且无可溯源批准引用', () => {
    const pricing = getProduct('connection-os').pricing
    expect(pricing.status).toBe('PENDING_APPROVAL')
    expect(pricing.approvalRef).toBeFalsy()
    expect(pricing.displayPrice).toBeNull()
  })

  it('注入完整 live 凭据：技术门通过，但 enabled 仍为 false（商业门单独挡住）', () => {
    const gate = readCheckoutGate(LIVE_ENV)
    expect(gate.credentialsReady).toBe(true)
    expect(gate.commercialApproved).toBe(false)
    expect(gate.enabled).toBe(false)
    expect(gate.approval.status).toBe('PENDING_APPROVAL')
    expect(gate.approval.ref).toBeNull()
  })

  it('逻辑负控：enabled=false 不是因为"没凭据"，而是因为"没批准"', () => {
    const store = readStoreReadiness(LIVE_ENV)
    const gate = readCheckoutGate(LIVE_ENV)
    // 技术门确实已就绪；若这里为 false，上一条的 enabled=false 就没有证明力。
    expect(store.ready).toBe(true)
    expect(gate.credentialsReady).toBe(true)
    expect(gate.enabled).toBe(false)
    expect(gate.enabled).toBe(gate.credentialsReady && gate.commercialApproved)
  })

  it('无凭据（本地/CI 默认）同样关闭，且 unboundProducts 只暴露变量名', () => {
    const gate = readCheckoutGate({})
    expect(gate.enabled).toBe(false)
    expect(gate.credentialsReady).toBe(false)
    for (const name of gate.unboundProducts) {
      expect(name).toMatch(/^[A-Z0-9_]+$/)
    }
  })
})
