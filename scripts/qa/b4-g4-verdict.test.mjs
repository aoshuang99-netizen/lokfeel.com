/**
 * B4 · G4 判定层回归测试（TDD 红→绿）
 *
 * 背景：G4 全矩阵曾得出 112/112 PASS。若 axe 未真正运行（脚本注入失败、页面空白、
 * 规则全数 inapplicable），violations=[] 同样会判 PASS —— 这是「空集恒真」的假绿。
 * 本测试通过负控证明：判定函数对已知违规敏感，且拒绝把「没扫到」当成「扫过且合格」。
 *
 * 运行：node --test scripts/qa/b4-g4-verdict.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateCell } from './b4-g4-verdict.mjs'

const CLEAN = {
  rulesEvaluated: 41,
  violations: [],
  overflow: 0,
}

test('① 正常扫描（规则确实运行）+ 无 serious + 无横向溢出 ⇒ PASS', () => {
  const d = evaluateCell(CLEAN)
  assert.equal(d.verdict, 'PASS')
  assert.equal(d.seriousCount, 0)
})

test('② 负控：注入一条 serious 违规 ⇒ FAIL（证明门禁对真实缺陷敏感）', () => {
  const d = evaluateCell({
    ...CLEAN,
    violations: [{ id: 'color-contrast', impact: 'serious', nodes: 2 }],
  })
  assert.equal(d.verdict, 'FAIL')
  assert.equal(d.seriousCount, 2)
  assert.equal(d.reason, 'AXE_SERIOUS')
})

test('③ 防假绿：axe 未真正运行（rulesEvaluated=0，violations 空）⇒ ERROR 而非 PASS', () => {
  const d = evaluateCell({ violations: [], overflow: 0, rulesEvaluated: 0 })
  assert.equal(d.verdict, 'ERROR')
  assert.equal(d.reason, 'AXE_NOT_RUN')
})

test('③b 前置缺失（rulesEvaluated 为 undefined/NaN）同样 ⇒ ERROR', () => {
  assert.equal(evaluateCell({ violations: [], overflow: 0 }).verdict, 'ERROR')
  assert.equal(evaluateCell({ ...CLEAN, rulesEvaluated: NaN }).verdict, 'ERROR')
})

test('④ 口径：仅 moderate/minor 违规不计入 hard gate ⇒ PASS', () => {
  const d = evaluateCell({
    ...CLEAN,
    violations: [{ id: 'region', impact: 'moderate', nodes: 1 }],
  })
  assert.equal(d.verdict, 'PASS')
  assert.equal(d.seriousCount, 0)
})

test('⑤ 横向溢出 > 1px ⇒ FAIL（响应式硬信号）', () => {
  const d = evaluateCell({ ...CLEAN, overflow: 2 })
  assert.equal(d.verdict, 'FAIL')
  assert.equal(d.reason, 'H_OVERFLOW')
  // 1px 是测量噪声容差，不判 FAIL
  assert.equal(evaluateCell({ ...CLEAN, overflow: 1 }).verdict, 'PASS')
})

test('⑥ critical 违规同样计入 hard gate ⇒ FAIL', () => {
  const d = evaluateCell({
    ...CLEAN,
    violations: [{ id: 'aria-hidden-focus', impact: 'critical', nodes: 1 }],
  })
  assert.equal(d.verdict, 'FAIL')
  assert.equal(d.seriousCount, 1)
})

test('⑦ seriousCount 按节点数累加，mixed 违规只累计 serious/critical', () => {
  const d = evaluateCell({
    ...CLEAN,
    violations: [
      { id: 'a', impact: 'serious', nodes: 3 },
      { id: 'b', impact: 'critical', nodes: 2 },
      { id: 'c', impact: 'moderate', nodes: 9 },
    ],
  })
  assert.equal(d.seriousCount, 5)
  assert.equal(d.verdict, 'FAIL')
})
