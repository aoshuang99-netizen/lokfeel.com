/**
 * A-01 收银台风险哨兵 · 判定层（纯函数，无 IO）。
 *
 * 设计约束：
 * - 只依据「实际取到的生产响应」判定；字段缺失/非 200/超时一律 ERROR，绝不判 PASS。
 * - 判定与取证分离：本模块不发网络请求，由 checkout-sentinel.mjs 注入观测值。
 */

/** 证据强制字段：缺一即 ERROR，防止「有结论没证据」。 */
export const REQUIRED_EVIDENCE_FIELDS = ['environment', 'approvedAt', 'catalogVersion']

function error(reason) {
  return { verdict: 'ERROR', reasons: [reason], evidence: {} }
}

export function evaluateCheckoutSentinel(input) {
  if (input?.fetchError) return error(`生产取数失败：${input.fetchError}`)
  if (input?.httpStatus !== 200) return error(`生产响应非 200：${input?.httpStatus ?? 'missing'}`)
  if (!input?.plans || typeof input.plans !== 'object') return error('plans 响应为空或不是对象')
  if (typeof input.plans.checkoutReady !== 'boolean') return error('plans.checkoutReady 缺失或非布尔')

  const evidence = { remoteSha: input.remoteSha }
  for (const field of REQUIRED_EVIDENCE_FIELDS) evidence[field] = input.plans[field]
  for (const [key, value] of Object.entries(evidence)) {
    if (value === undefined || value === null || value === '') return error(`证据字段缺失：${key}`)
  }

  if (input.plans.checkoutReady === true && !input?.stopLossAuthorized) {
    return {
      verdict: 'RISK_OPEN',
      reasons: [
        '线上收银台仍开放：R-15 缺陷未止损（同一 payment_id 先失败后成功会收钱不开通且无告警）',
      ],
      evidence,
    }
  }
  if (input.plans.checkoutReady === false) {
    return { verdict: 'CLOSED', reasons: ['收银台已关闭'], evidence }
  }
  return { verdict: 'ACKNOWLEDGED', reasons: ['收银台开放但已获止损授权，等待执行'], evidence }
}

/** 取证计划：只读 GET，绝不含请求体、绝不写生产。 */
export function buildSentinelPlan(base = 'https://app.lokfeel.com') {
  const origin = String(base).replace(/\/$/, '')
  return [
    { method: 'GET', url: `${origin}/api/payments/dodo/plans` },
    { method: 'GET', url: `${origin}/api/health` },
  ]
}
