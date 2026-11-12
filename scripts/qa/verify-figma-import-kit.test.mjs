import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateKit, KIT_DIR } from './verify-figma-import-kit.mjs'

test('F1 · 完整资产包通过校验，且统计分母真实非空', () => {
  const result = validateKit(KIT_DIR)
  assert.equal(result.ok, true, result.errors.join('; '))
  assert.ok(result.stats.frames >= 20, `frames=${result.stats.frames}`)
  assert.ok(result.stats.colorTokens >= 33, `colorTokens=${result.stats.colorTokens}`)
  assert.ok(result.stats.components >= 6, `components=${result.stats.components}`)
  // V20.7 作战包 §3 指定 --lf-*（Deep Field / Living Paper）为 Workspace 权威源，
  // 资产包必须覆盖第三套系统，否则 Figma 建稿会退回猜测色板。
  assert.deepEqual([...result.stats.systems].sort(), ['landing-light', 'living-connection-os', 'public-dark'])
})

test('F2 · 缺 tokens.json → 返回 ok=false 而不是崩溃（负控）', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'figma-kit-'))
  try {
    cpSync(KIT_DIR, tmp, { recursive: true })
    rmSync(path.join(tmp, 'tokens.json'))
    let result
    assert.doesNotThrow(() => {
      result = validateKit(tmp)
    }, '缺文件时门禁不应抛异常')
    assert.equal(result.ok, false)
    assert.match(result.errors.join(' '), /tokens\.json/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('F4 · 删掉全部 --lf-* Token → ok=false（作战包权威源不可缺失）', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'figma-kit-'))
  try {
    cpSync(KIT_DIR, tmp, { recursive: true })
    const p = path.join(tmp, 'tokens.json')
    const doc = JSON.parse(readFileSync(p, 'utf8'))
    doc.tokens = doc.tokens.filter((t) => !String(t.name).startsWith('--lf-'))
    writeFileSync(p, JSON.stringify(doc, null, 2))
    const result = validateKit(tmp)
    assert.equal(result.ok, false, '缺 --lf-* 权威源时门禁必须失败')
    assert.match(result.errors.join(' '), /--lf-|权威源|系统/i)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('F3 · frames.csv 的 code_path 指向不存在文件 → ok=false（负控）', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'figma-kit-'))
  try {
    cpSync(KIT_DIR, tmp, { recursive: true })
    const csvPath = path.join(tmp, 'frames.csv')
    writeFileSync(
      csvPath,
      readFileSync(csvPath, 'utf8').replaceAll('src/app/(landing)/page.tsx', 'src/app/__MISSING__.tsx'),
    )
    const result = validateKit(tmp)
    assert.equal(result.ok, false)
    assert.match(result.errors.join(' '), /code_path|不存在|missing/i)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
