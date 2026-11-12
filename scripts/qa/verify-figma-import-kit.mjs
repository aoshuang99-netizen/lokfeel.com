/**
 * Figma 可导入资产包 · 完整性门禁。
 * 导出 validateKit(dir) 供测试与 CLI 共用；只读，不修改资产。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')

export const KIT_DIR = path.resolve(
  REPO,
  'docs/release/lokfeel-final-20261110/figma-import-kit',
)

/** 支持引号包裹含逗号字段的最小 CSV 解析器。 */
export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const rows = []
  for (const line of lines) {
    const cells = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          inQuotes = !inQuotes
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current)
        current = ''
      } else {
        current += ch
      }
    }
    cells.push(current)
    rows.push(cells)
  }
  const header = rows.shift() ?? []
  return rows.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])))
}

const REQUIRED_FILES = ['tokens.json', 'frames.csv', 'components.csv', 'README.md']

export function validateKit(dir = KIT_DIR) {
  const errors = []
  const stats = { frames: 0, colorTokens: 0, components: 0, systems: [] }

  for (const file of REQUIRED_FILES) {
    if (!existsSync(path.join(dir, file))) errors.push(`缺少资产文件：${file}`)
  }
  if (errors.length) return { ok: false, errors, stats }

  const tokensDoc = JSON.parse(readFileSync(path.join(dir, 'tokens.json'), 'utf8'))
  const frames = parseCsv(readFileSync(path.join(dir, 'frames.csv'), 'utf8'))
  const components = parseCsv(readFileSync(path.join(dir, 'components.csv'), 'utf8'))

  const colorTokens = (tokensDoc.tokens ?? []).filter((t) => t.type === 'color')
  stats.colorTokens = colorTokens.length
  stats.systems = [...new Set(colorTokens.map((t) => t.system))]
  stats.frames = frames.length
  stats.components = components.length

  for (const token of colorTokens) {
    if (!token.name || !token.value || !token.type) errors.push(`token 字段不全：${JSON.stringify(token)}`)
  }
  for (const frame of frames) {
    if (!frame.route || !frame.code_path) {
      errors.push(`帧缺 route/code_path：${JSON.stringify(frame)}`)
    } else if (!existsSync(path.resolve(REPO, frame.code_path))) {
      errors.push(`帧映射的代码文件不存在：${frame.code_path}`)
    }
  }
  for (const component of components) {
    if (!component.component || !component.code_path) {
      errors.push(`组件缺字段：${JSON.stringify(component)}`)
    } else if (!existsSync(path.resolve(REPO, component.code_path))) {
      errors.push(`组件映射的代码文件不存在：${component.code_path}`)
    }
  }

  return { ok: errors.length === 0, errors, stats }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateKit()
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}
