/**
 * V21 · C05 —— 任务列表信封解析（纯函数，无 IO）
 *
 * `paginated()`（src/lib/api-response.ts:95）的形状是 `{ success, data: T[], meta }`。
 * 这里把"怎么从响应里取出条目"变成一个可单测的纯函数 —— 因为它曾经读错层级，
 * 把"有任务"显示成"没有任务"。
 */

type UnknownRecord = Record<string, unknown>

function isRecord(v: unknown): v is UnknownRecord {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 从列表响应里取任务条目：
 *   - 标准信封：`{ data: MissionDto[] }`
 *   - 兼容形状：`{ data: { items: MissionDto[] } }`（某些代理/包装层）
 * 不认识的形状一律 `[]`，不抛错 —— 列表页崩掉比空更难排查。
 */
export function missionsFromListPayload<T = UnknownRecord>(payload: unknown): T[] {
  if (!isRecord(payload)) return []
  const data = payload.data
  const raw = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.items) ? data.items : []
  return raw.filter(isRecord) as T[]
}
