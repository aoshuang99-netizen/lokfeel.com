/**
 * B4 · G4 单格判定（纯函数，唯一真源）
 *
 * 把「有没有真的扫到」与「扫到之后合不合格」分开，避免空集恒真的假绿：
 *   - rulesEvaluated <= 0（axe 未运行 / 页面空白 / 规则全 inapplicable）⇒ ERROR，绝不计 PASS
 *   - hard gate 只看 serious + critical；moderate/minor 不误伤
 *   - 横向溢出 > 1px（1px 为测量噪声容差）⇒ FAIL
 *
 * 主脚本 scripts/qa/b4-g4-public-matrix.mjs 与回归测试 b4-g4-verdict.test.mjs
 * 共用本函数，保证「被验证的逻辑」就是「实际跑矩阵的逻辑」。
 */

/**
 * @param {object} input
 * @param {number} input.rulesEvaluated axe 实际评估出结果的规则条数
 *   （passes + violations + incomplete；由主脚本从 axe.run 结果汇总，不是常量）
 * @param {Array<{impact?: string, nodes?: number}>} [input.violations]
 * @param {number} [input.overflow] documentElement.scrollWidth - clientWidth
 * @returns {{verdict: 'PASS'|'FAIL'|'ERROR', reason?: string, seriousCount: number, overflow: number}}
 */
export function evaluateCell({ rulesEvaluated, violations = [], overflow = 0 } = {}) {
  const list = Array.isArray(violations) ? violations : []
  const delta = Number.isFinite(overflow) ? overflow : 0

  // 前置非空断言：没有证据表明 axe 真的跑过，就不能声称「零违规」。
  if (!Number.isFinite(rulesEvaluated) || rulesEvaluated <= 0) {
    return { verdict: 'ERROR', reason: 'AXE_NOT_RUN', seriousCount: 0, overflow: delta }
  }

  const serious = list.filter((v) => v && (v.impact === 'serious' || v.impact === 'critical'))
  const seriousCount = serious.reduce((sum, v) => sum + (Number(v.nodes) || 0), 0)

  if (serious.length > 0) {
    return { verdict: 'FAIL', reason: 'AXE_SERIOUS', seriousCount, overflow: delta }
  }
  if (delta > 1) {
    return { verdict: 'FAIL', reason: 'H_OVERFLOW', seriousCount: 0, overflow: delta }
  }
  return { verdict: 'PASS', seriousCount: 0, overflow: delta }
}
