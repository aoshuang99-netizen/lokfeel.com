#!/usr/bin/env node
/**
 * V16 · T10 —— 设计令牌的 WCAG 对比度核算（纯计算，不依赖浏览器）
 *
 * 为什么单独算：本机没有 axe-core，Playwright 也测不出"文字与背景的真实对比度"
 * （要处理继承、渐变、半透明）。而项目的**所有**颜色都收敛在 `--lf-*` 令牌里，
 * 所以直接对令牌两两计算 WCAG 2.x 比值，比截图取样更准，也能进 CI 当门禁。
 *
 * 判据（WCAG 2.2 AA）：
 *   · 正文（<18.66px 常规 / <24px 粗体）：≥ 4.5
 *   · 大字号（≥18.66px 常规 / ≥24px 粗体）：≥ 3.0
 *   · 非文本（边框、图标）：≥ 3.0
 *
 * 退出码：0 = 全部达标；1 = 有低于阈值的组合（并打印具体比值）。
 *
 * 用法：node scripts/qa/contrast-tokens.mjs [--verbose]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const CSS = path.join(ROOT, 'src/app/globals.css')
const verbose = process.argv.includes('--verbose')

/** 从 globals.css 里按选择器块抽出 `--lf-*` 颜色令牌。 */
function parseBlocks(css) {
  const blocks = {}
  const re = /(\[data-lf-theme[^{]*|[^{}]*?)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const selector = m[1].replace(/\s+/g, ' ').trim()
    if (!/data-lf-theme|data-lf-dual/.test(selector)) continue
    const tokens = {}
    for (const line of m[2].split(';')) {
      const hit = line.match(/--lf-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/)
      if (hit) tokens[hit[1]] = hit[2].trim()
    }
    if (Object.keys(tokens).length) blocks[selector] = tokens
  }
  return blocks
}

function toRgb(value) {
  if (value.startsWith('#')) {
    let hex = value.slice(1)
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  }
  const nums = value.match(/[\d.]+/g) || []
  return nums.slice(0, 3).map(Number)
}

const channel = (c) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
const luminance = (rgb) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
export function contrast(a, b) {
  const la = luminance(toRgb(a))
  const lb = luminance(toRgb(b))
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** 需要核算的组合：[前景令牌, 背景令牌, 阈值, 用途] */
const PAIRS = [
  ['text', 'bg', 4.5, '正文 / 页面底'],
  ['text', 'surface', 4.5, '正文 / 卡片'],
  ['text', 'surface-2', 4.5, '正文 / 次级面'],
  ['text-muted', 'surface', 4.5, '次要文字 / 卡片'],
  ['text-muted', 'bg', 4.5, '次要文字 / 页面底'],
  ['text-faint', 'surface', 4.5, '弱化文字 / 卡片'],
  // 弱化文字最容易被放在最硬的两种底上：深色主题的 surface-2（更亮）、浅色主题的 bg（更暗）。
  // 只测 surface 会漏掉真实用量 —— 这两条是 2026-10-21 首次核算时暴露出来的。
  ['text-faint', 'surface-2', 4.5, '弱化文字 / 次级面'],
  ['text-faint', 'bg', 4.5, '弱化文字 / 页面底'],
  ['signal', 'surface', 4.5, '强调文字 / 卡片'],
  ['signal', 'bg', 4.5, '强调文字 / 页面底'],
  ['success', 'surface', 3.0, '状态色 / 卡片（非正文）'],
  ['warning', 'surface', 3.0, '状态色 / 卡片（非正文）'],
  ['danger', 'surface', 4.5, '错误文字 / 卡片'],
  ['line', 'surface', 1.2, '分隔线（装饰性，仅记录）'],
]

const css = fs.readFileSync(CSS, 'utf8')
const blocks = parseBlocks(css)

/** 只核算"完整调色板"块（四个 dir 各有 15 个以上令牌）。 */
const themes = Object.entries(blocks).filter(([, t]) => t.text && t.surface && t.bg)

if (!themes.length) {
  console.error('✗ 没从 globals.css 解析到任何 --lf-* 调色板块 —— 解析逻辑失效，不能当作通过')
  process.exit(1)
}

let failures = 0
console.log(`解析到 ${themes.length} 个调色板块\n`)

for (const [selector, tokens] of themes) {
  console.log(`── ${selector} ──`)
  for (const [fg, bg, threshold, label] of PAIRS) {
    if (!tokens[fg] || !tokens[bg]) {
      console.log(`  ? ${label}：令牌缺失（${fg} / ${bg}）`)
      failures += 1
      continue
    }
    const ratio = contrast(tokens[fg], tokens[bg])
    const pass = ratio >= threshold
    if (!pass || verbose) {
      console.log(
        `  ${pass ? '✓' : '✗'} ${label.padEnd(22)} ${ratio.toFixed(2)} : 1 (需 ≥ ${threshold})  ${tokens[fg]} on ${tokens[bg]}`,
      )
    }
    if (!pass && threshold > 1.2) failures += 1
  }
  console.log('')
}

if (failures) {
  console.log(`✗ ${failures} 组低于 WCAG AA —— 需要调整令牌取值`)
  process.exit(1)
}
console.log('✓ 全部组合达到 WCAG AA')
