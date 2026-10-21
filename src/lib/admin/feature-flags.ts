/**
 * 功能开关页：API 响应 → 视图行（纯函数，可单测）
 *
 * ── 为什么单独抽出来（V16 · T01）────────────────────────────────────────────
 * 修复前该页是一份**硬编码的假列表**，且初始值在 `useState` 里调用
 * `new Date().toISOString()`，渲染时又用 `toLocaleString("zh-CN")` 格式化 ——
 * 服务端与客户端的"此刻"和时区都不同，首帧必然不一致，React 抛 #418。
 *
 * 现在改成：数据只来自 `/api/admin/features`（服务端确认），时间只在客户端
 * 按固定格式渲染；归一化逻辑放这里，缺失/畸形字段一律降级，不抛错。
 */

export interface FeatureFlagRow {
  id: string
  name: string
  code: string
  description: string
  enabled: boolean
  category: string
  /** 归一化后的 ISO 时间；无效或缺失为 null（UI 显示 "—"） */
  lastModified: string | null
  modifiedBy: string | null
}

export interface FeatureFlagStats {
  total: number
  enabled: number
  disabled: number
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toIsoOrNull(value: unknown): string | null {
  const raw = asString(value)
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function toFeatureFlagRow(raw: Record<string, unknown>): FeatureFlagRow | null {
  const id = asString(raw.id)
  if (!id) return null
  return {
    id,
    name: asString(raw.name) || asString(raw.code) || '未命名开关',
    code: asString(raw.code),
    description: asString(raw.description),
    enabled: raw.enabled === true,
    category: asString(raw.category) || 'unknown',
    lastModified: toIsoOrNull(raw.lastModified),
    modifiedBy: asString(raw.modifiedBy) || null,
  }
}

export function toFeatureFlagRows(payload: unknown): FeatureFlagRow[] {
  if (!Array.isArray(payload)) return []
  const rows: FeatureFlagRow[] = []
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue
    const row = toFeatureFlagRow(item as Record<string, unknown>)
    if (row) rows.push(row)
  }
  return rows
}

export function computeStats(rows: readonly FeatureFlagRow[]): FeatureFlagStats {
  const enabled = rows.filter((r) => r.enabled).length
  return { total: rows.length, enabled, disabled: rows.length - enabled }
}

/**
 * 固定格式 `YYYY-MM-DD HH:mm`（UTC）—— 刻意不用 `toLocaleString`：
 * 后者依赖运行环境的时区与 ICU 数据，SSR 与浏览器之间可能不一致，
 * 正是本次 #418 的成因之一。固定格式在两端逐字相同。
 */
export function formatUpdatedAt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}
