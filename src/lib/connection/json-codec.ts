/**
 * T02 · JSON-in-String 编解码 —— **唯一入口**
 *
 * 为什么要有这个文件：
 *   libSQL 没有 `jsonb`，契约（contracts/schema.sql）里的 JSON 列在本仓一律落为
 *   `String`（TEXT）。若各处自行 `JSON.parse` / `JSON.stringify`，迟早会出现
 *   「有的行存 `["a"]`、有的行存 `[object Object]`、有的行存裸字符串」的静默腐化
 *   —— 这类问题**不会报错**，只会在某天让匹配/披露逻辑出错，属于最贵的一类缺陷
 *   （见 docs/implementation/T02/risks.md R2）。
 *
 * 因此约定：
 *   - **写路径**一律经 `encodeJson()`；先经 `normalizeStringArray()` / `normalizeObject()`
 *     把外部输入收敛成已知形状，再编码。**不接受**未校验的形状直接落库。
 *   - **读路径**一律经 `decodeJson()`；它是**全函数**（total）——任何脏数据都返回
 *     fallback，绝不抛异常。读路径抛异常等于「一行脏数据打挂整个列表接口」。
 */

/** 编码：把值序列化为 JSON 文本。`undefined` → `null`（表示"无值"，而非 `"undefined"`）。 */
export function encodeJson(value: unknown): string | null {
  if (value === undefined) return null
  return JSON.stringify(value)
}

/**
 * 解码：任何输入都不抛异常。
 * - 空值 → fallback
 * - 已是目标类型（历史代码可能直接传对象） → 原样返回
 * - 合法 JSON 文本 → 解析
 * - 非法文本 → fallback
 */
export function decodeJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === '') return fallback
  if (typeof text !== 'string') return fallback
  try {
    const parsed = JSON.parse(text)
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

/**
 * 解码为字符串数组（约束类字段专用）。
 * 契约把 constraints 定义为字符串数组；这里**额外容忍**三种历史/脏形态：
 *   - `'["a","b"]'` → `['a','b']`
 *   - `'a'`（裸字符串）→ `['a']`（把单值提升为数组，而不是丢弃数据）
 *   - `'["a",1,null]'` → `['a']`（过滤非字符串，避免把数字带进下游）
 * 其余一律 → `[]`。
 */
export function decodeStringArray(text: string | null | undefined): string[] {
  if (text === null || text === undefined || text === '') return []
  if (Array.isArray(text)) return text.filter((v): v is string => typeof v === 'string')
  if (typeof text !== 'string') return []

  const trimmed = text.trim()
  // JSON 对象文本 → 形状错误，不是"裸字符串"。返回空数组而不是把它当成
  // 单元素数组（那会把 `{"a":1}` 原样带进下游业务逻辑）。
  if (trimmed.startsWith('{')) return []
  // 其余不以 `[` 开头的 → 历史/脏形态的裸字符串 → 提升为单元素数组。
  if (!trimmed.startsWith('[')) {
    return trimmed ? [trimmed] : []
  }
  const parsed = decodeJson<unknown>(trimmed, null)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((v): v is string => typeof v === 'string')
}

/** 单个字符串的最大长度（防止把整篇文档塞进约束数组）。 */
export const MAX_ARRAY_ITEM_LENGTH = 500
/** 数组最大元素数（与参考后端 `max_length=20` 对齐）。 */
export const MAX_ARRAY_ITEMS = 20

/**
 * 写路径校验：把任意输入收敛成受约束的 `string[]`。
 *
 * 规则（顺序即语义）：
 *   1. 非数组 → `[]`（不猜测意图）
 *   2. 只保留字符串，逐项 `trim`
 *   3. 丢弃空串
 *   4. 截断超长项（不丢弃整项，避免"用户输入被静默吞掉"）
 *   5. 去重（保序）
 *   6. 截断到 MAX_ARRAY_ITEMS
 */
export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const item = raw.trim().slice(0, MAX_ARRAY_ITEM_LENGTH)
    if (!item) continue
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
    if (out.length >= MAX_ARRAY_ITEMS) break
  }
  return out
}

/** 写路径校验：把任意输入收敛成"纯对象"（数组/标量/null → `{}`）。 */
export function normalizeObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) return {}
  // 只保留可 JSON 序列化的扁平/嵌套普通对象；Date 等会被 JSON.stringify 处理。
  return { ...(value as Record<string, unknown>) }
}
