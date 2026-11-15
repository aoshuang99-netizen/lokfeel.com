/**
 * V21 · 第二批 —— 通用列表信封解析（纯函数，无 IO）
 *
 * 服务端统一信封（`src/lib/api-response.ts`）：
 *   `success(data)`  → `{ success:true, data }`
 *   `paginated(arr)` → `{ success:true, data: <数组>, meta }`
 *   错误             → `{ success:false, data:null, error:{ code,message,details } }`
 *
 * v1 列表**混用两种形状**：4 个分页端点给数组 data；`agents/runs`、`outcomes`、
 * `connections/proposals`、`workflow/jobs` 给对象 data（`{items}` / `{proposals}` / `{jobs}`）。
 * 首批 F2 缺陷就是按 `data.items` 读数组 data，把「有任务」显示成「没有任务」。
 *
 * 解析结果显式分四种 kind，绝不把错误/畸形静默映射成空列表：
 *   - 'ok'         合法非空（items 非空，count > 0）
 *   - 'empty'      合法空（items=[]，count=0）
 *   - 'error'      success:false / HTTP>=400 / 401/403（items=[]，带 code/message）
 *   - 'unexpected' 形状不认识（items=[]，但**不是**合法空，不静默降级）
 *
 * `assertNonEmpty` 供测试与独立 QA 做「前置非空」断言：集合断言先证前置非空，
 * 空集恒真 = 假绿；断言条目内容之前必须先证明集合非空。
 */

export type ListEnvelopeKind = 'ok' | 'empty' | 'error' | 'unexpected'

export interface ListEnvelopeResult<T = unknown> {
  kind: ListEnvelopeKind
  items: T[]
  count: number
  /** 仅 kind='error' 时有意义。 */
  code?: string
  message?: string
  /** 401/403 权限错误：错误 ≠ 没有数据。 */
  permissionDenied?: boolean
}

export interface ParseListEnvelopeOptions {
  /** HTTP 状态码；>= 400 一律判 error，绝不映射成空列表。 */
  status?: number
  /** 对象 data 上额外的命名数组键（优先于默认键）。 */
  itemKeys?: string[]
}

export interface EnvelopeFixture {
  id: string
  endpoint: string
  description: string
  payload: unknown
  httpStatus?: number
  expectKind: ListEnvelopeKind
  expectCount: number
  /** kind='ok' 时首条目应匹配的内容（前置非空后再断言）。 */
  firstItem?: Record<string, unknown>
  permissionDenied?: boolean
}

/**
 * 真实端点响应形状（已逐个核对路由实现）：
 *   - missions/intents/members/mission intents：`paginated()` → 数组 data
 *   - agents/runs、outcomes：对象 data.items
 *   - connections/proposals：对象 data.proposals
 *   - workflow/jobs：对象 data.jobs
 *   - 403/401：错误信封
 *   - 合法空、畸形载荷
 *
 * 供单测与独立 QA 共用；至少 6 条，覆盖「数据非空」与「权限错误」。
 */
export const ENVELOPE_CONTRACT_FIXTURES: EnvelopeFixture[] = [
  {
    id: 'missions-array',
    endpoint: 'GET /api/v1/missions',
    description: 'paginated() → data 是数组（F2 缺陷所涉形状）',
    payload: {
      success: true,
      data: [{ id: 'm1', title: '联合发布', status: 'DRAFT' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    },
    expectKind: 'ok',
    expectCount: 1,
    firstItem: { id: 'm1', title: '联合发布', status: 'DRAFT' },
  },
  {
    id: 'agent-runs-items',
    endpoint: 'GET /api/v1/agents/runs',
    description: 'success(result) → 对象 data.items',
    payload: {
      success: true,
      data: {
        items: [{ id: 'r1', skill: 'INTENT_EXTRACTION', status: 'EXECUTED' }],
        count: 1,
        filters: { status: null, skill: null, limit: 20 },
      },
    },
    expectKind: 'ok',
    expectCount: 1,
    firstItem: { id: 'r1', skill: 'INTENT_EXTRACTION', status: 'EXECUTED' },
  },
  {
    id: 'outcomes-items',
    endpoint: 'GET /api/v1/outcomes',
    description: 'success({items,count,unverifiedCount,filters}) → 对象 data.items',
    payload: {
      success: true,
      data: {
        items: [{ id: 'o1', label: '已交付', level: 'SELF_REPORTED', verified: false }],
        count: 1,
        unverifiedCount: 1,
        filters: { level: null, missionId: null, verifiedOnly: false, limit: 50 },
      },
    },
    expectKind: 'ok',
    expectCount: 1,
    firstItem: { id: 'o1', label: '已交付', level: 'SELF_REPORTED' },
  },
  {
    id: 'proposals-object',
    endpoint: 'GET /api/v1/connections/proposals',
    description: 'success({proposals}) → 对象 data.proposals',
    payload: {
      success: true,
      data: { proposals: [{ id: 'p1', state: 'CONSENT_PENDING' }] },
    },
    expectKind: 'ok',
    expectCount: 1,
    firstItem: { id: 'p1', state: 'CONSENT_PENDING' },
  },
  {
    id: 'jobs-object',
    endpoint: 'GET /api/v1/workflow/jobs',
    description: 'success({jobs}) → 对象 data.jobs',
    payload: {
      success: true,
      data: { jobs: [{ id: 'j1', kind: 'INTRO_DRAFT', status: 'SUCCEEDED' }] },
    },
    expectKind: 'ok',
    expectCount: 1,
    firstItem: { id: 'j1', kind: 'INTRO_DRAFT', status: 'SUCCEEDED' },
  },
  {
    id: 'legal-empty',
    endpoint: 'GET /api/v1/intents',
    description: 'paginated([]) → 合法空（不是错误，也不是 unexpected）',
    payload: {
      success: true,
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    },
    expectKind: 'empty',
    expectCount: 0,
  },
  {
    id: 'forbidden-403',
    endpoint: 'GET /api/v1/missions（缺 mission.read 能力）',
    description: 'forbidden() → 权限错误信封，绝不能显示成「没有数据」',
    httpStatus: 403,
    payload: {
      success: false,
      data: null,
      error: {
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission to perform this action',
        details: { capability: 'mission.read' },
      },
    },
    expectKind: 'error',
    expectCount: 0,
    permissionDenied: true,
  },
  {
    id: 'unauthorized-401',
    endpoint: 'GET /api/v1/agents/runs（未登录）',
    description: 'unauthorized() → 401 权限错误信封',
    httpStatus: 401,
    payload: {
      success: false,
      data: null,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    },
    expectKind: 'error',
    expectCount: 0,
    permissionDenied: true,
  },
  {
    id: 'malformed-data-string',
    endpoint: '任意列表端点（畸形载荷）',
    description: 'data 是字符串 → 形状不认识，返回 unexpected 而不是静默空数组',
    payload: { success: true, data: 'oops' },
    expectKind: 'unexpected',
    expectCount: 0,
  },
  {
    id: 'malformed-items-string',
    endpoint: '任意列表端点（命名键存在但非数组）',
    description: 'data.items 不是数组 → unexpected，不静默降级为空',
    payload: { success: true, data: { items: 'not-an-array', count: 0 } },
    expectKind: 'unexpected',
    expectCount: 0,
  },
]

/** 对象 data 上已知的命名数组键（真实端点逐个核对过）。 */
const DEFAULT_ITEM_KEYS = [
  'items',
  'proposals',
  'jobs',
  'runs',
  'intents',
  'members',
  'missions',
  'outcomes',
  'invitations',
  'introductions',
] as const

type UnknownRecord = Record<string, unknown>

function isRecord(v: unknown): v is UnknownRecord {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function unexpected<T>(): ListEnvelopeResult<T> {
  return { kind: 'unexpected', items: [], count: 0 }
}

function errorResult<T>(
  payload: UnknownRecord,
  status: number | undefined,
  fallbackMessage: string,
): ListEnvelopeResult<T> {
  const err = isRecord(payload.error) ? payload.error : null
  const code =
    err && typeof err.code === 'string'
      ? err.code
      : typeof status === 'number'
        ? `HTTP_${status}`
        : 'UNKNOWN_ERROR'
  const message =
    err && typeof err.message === 'string' && err.message.length > 0
      ? err.message
      : fallbackMessage
  const permissionDenied =
    code === 'PERMISSION_DENIED' ||
    code === 'UNAUTHORIZED' ||
    status === 401 ||
    status === 403
  return {
    kind: 'error',
    items: [],
    count: 0,
    code,
    message,
    permissionDenied,
  }
}

export function parseListEnvelope<T = unknown>(
  payload: unknown,
  options: ParseListEnvelopeOptions = {},
): ListEnvelopeResult<T> {
  if (!isRecord(payload)) return unexpected<T>()

  const status = options.status
  // ① HTTP 错误（含 401/403）优先于一切形状判断：绝不映射成空列表。
  if (typeof status === 'number' && status >= 400) {
    return errorResult<T>(payload, status, `HTTP ${status} 请求失败`)
  }
  // ② 明确失败信封（success:false）。即使 data 恰是 []，也按 error 处理。
  if (payload.success === false) {
    return errorResult<T>(payload, status, '服务端返回错误')
  }

  // ③ 取条目：数组 data，或对象 data 上的命名数组键。
  const data = payload.data
  let raw: unknown[] | null = null
  if (Array.isArray(data)) {
    raw = data
  } else if (isRecord(data)) {
    const keys = [...(options.itemKeys ?? []), ...DEFAULT_ITEM_KEYS]
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        if (Array.isArray(data[key])) raw = data[key] as unknown[]
        // 命名键存在但不是数组 → 形状不认识，不静默兜底。
        break
      }
    }
    if (raw === null) {
      // 保守兜底：对象里恰好只有一个自有数组属性，就认它（兼容未来命名键）。
      // 多于一个或零个都不猜 —— 猜错就是假数据。
      const arrayKeys = Object.keys(data).filter((k) => Array.isArray(data[k]))
      if (arrayKeys.length === 1) raw = data[arrayKeys[0]] as unknown[]
    }
  }

  // ④ 无法识别的形状：unexpected，不是静默空数组，也不是合法空。
  if (raw === null) return unexpected<T>()

  const items = raw as T[]
  return {
    kind: items.length > 0 ? 'ok' : 'empty',
    items,
    count: items.length,
  }
}

/**
 * 前置非空断言：集合断言必须先证非空（空集恒真 = 假绿）。
 * empty / error / unexpected 或 items 为空一律抛错，绝不静默通过；
 * 权限错误也在此被拦下 —— 它不等于「没有数据」。
 */
export function assertNonEmpty<T>(result: ListEnvelopeResult<T>): void {
  if (result.kind !== 'ok' || result.count <= 0 || result.items.length === 0) {
    throw new Error(
      `[envelope] 前置非空断言失败：kind=${result.kind}, count=${result.count}。` +
        '集合断言前必须证明数据非空，空集恒真是假绿；错误/畸形载荷不得当作「没有数据」。',
    )
  }
}
