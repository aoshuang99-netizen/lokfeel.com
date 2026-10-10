/**
 * T02 · 公开投影（最小披露）
 *
 * `/m/<token>` 是**匿名可达面**：任何拿到链接的人都能访问。因此投影必须遵循
 * 「最小披露」——只输出"访客为了判断要不要加入而必须知道"的字段。
 *
 * 白名单式投影（**只列允许字段**，而不是把全行删几个字段）：
 *   这是刻意的。黑名单式（"把 ownerId 删掉"）在模型新增列时会**默认泄露**
 *   新字段；白名单式在模型新增列时**默认不泄露**。默认值取向错误是最常见的
 *   数据泄露成因之一。
 *
 * ⚠️ 根级**明确不出现**的字段（见 `EXCLUDED_PUBLIC_FIELDS`，有负测断言）：
 *   - `id` / `organizationId` / `ownerId` / `shareToken` —— 内部标识；公开无收益、有枚举收益
 *   - `constraints` —— 运营内部约束（可能是内部筛选口径）；需显式授权才披露（T10 Bridge 再议）
 *   - `publicPreview` / `maxParticipants` —— 配置原件不出现在根级；
 *     名额一律折算为 `seats` 语义输出（`seats.capacity` 是**显式**决策，不是顺手带出）
 *
 * 「无候选时不伪造」：`candidates` 在 T04（双向匹配）落地前**恒为空数组**，
 *   `candidatesAvailable` 恒为 false。**绝不生成占位候选** —— 这是 PRD 的硬要求，
 *   也是本任务的一条验收铁律。本模块**不接受**外部传入 candidates，
 *   唯一的赋值点就是下面的 `[]`（结构性保证，而非"约定别乱传"）。
 */

/** 公开投影根级**永远不出现**的字段名（供负测断言，防止未来"顺手加字段"导致泄露）。 */
export const EXCLUDED_PUBLIC_FIELDS = [
  'id',
  'organizationId',
  'ownerId',
  'shareToken',
  'constraints',
  'publicPreview',
  'maxParticipants',
] as const

export type PublicMissionStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED'

export interface PublicSeats {
  /** 名额上限；null = 不限。 */
  capacity: number | null
  /** 已加入人数（真实计数，非估算）。 */
  taken: number
  /** 剩余名额；capacity 为 null 时为 null。 */
  remaining: number | null
}

/** 不接受加入的原因（供前端给出明确文案，而不是含糊的"不可用"）。 */
export type JoinBlockReason = 'draft' | 'paused' | 'closed' | 'expired' | 'full' | null

/** 公开投影所需的 DB 行子集。刻意不含 id/organizationId/ownerId/constraints。 */
export interface PublicViewSource {
  title: string
  goal: string
  offer: string
  successCriteria: string
  status: PublicMissionStatus
  expiresAt: Date | null
  publishedAt: Date | null
}

export interface PublicMissionView {
  title: string
  goal: string
  offer: string
  successCriteria: string
  status: PublicMissionStatus
  /** 发起社群的对外名称（可空）。 */
  community: string | null
  publishedAt: string | null
  expiresAt: string | null
  acceptingJoins: boolean
  joinBlockedReason: JoinBlockReason
  seats: PublicSeats
  /** T04 之前恒为 `[]`。UI 必须渲染空态，不得伪造。 */
  candidates: never[]
  /** 匹配能力是否已在本部署启用。T02 阶段恒为 false。 */
  candidatesAvailable: false
}

/**
 * 是否接受新加入。判定顺序即语义，且**每一个拒绝都要能说出原因**
 * （`joinBlockedReason`）—— 分享页要给出确定性的解释，而不是让用户猜。
 */
export function evaluateJoinability(
  mission: Pick<PublicViewSource, 'status' | 'expiresAt'>,
  seats: PublicSeats,
  now: Date = new Date()
): { acceptingJoins: boolean; reason: JoinBlockReason } {
  if (mission.status === 'DRAFT') return { acceptingJoins: false, reason: 'draft' }
  if (mission.status === 'PAUSED') return { acceptingJoins: false, reason: 'paused' }
  if (mission.status === 'CLOSED') return { acceptingJoins: false, reason: 'closed' }
  if (mission.expiresAt && mission.expiresAt.getTime() <= now.getTime()) {
    return { acceptingJoins: false, reason: 'expired' }
  }
  if (seats.capacity !== null && seats.taken >= seats.capacity) {
    return { acceptingJoins: false, reason: 'full' }
  }
  return { acceptingJoins: true, reason: null }
}

export function buildSeats(capacity: number | null, taken: number): PublicSeats {
  const safeTaken = Number.isFinite(taken) && taken > 0 ? Math.floor(taken) : 0
  const safeCapacity =
    capacity === null || capacity === undefined || !Number.isFinite(capacity)
      ? null
      : Math.max(0, Math.floor(capacity))
  return {
    capacity: safeCapacity,
    taken: safeTaken,
    remaining: safeCapacity === null ? null : Math.max(0, safeCapacity - safeTaken),
  }
}

/** 构造公开投影。**白名单式**：返回值里出现的一切字段都由本函数显式列出。 */
export function toPublicMissionView(
  src: PublicViewSource,
  opts: {
    participantCount: number
    communityName: string | null
    /** 名额上限。null = 不限。**显式传入**，不从 src 顺手带出。 */
    capacity?: number | null
    now?: Date
  }
): PublicMissionView {
  const seats = buildSeats(opts.capacity ?? null, opts.participantCount)
  const { acceptingJoins, reason } = evaluateJoinability(src, seats, opts.now ?? new Date())

  return {
    title: src.title,
    goal: src.goal,
    offer: src.offer,
    successCriteria: src.successCriteria,
    status: src.status,
    community: opts.communityName,
    publishedAt: src.publishedAt ? src.publishedAt.toISOString() : null,
    expiresAt: src.expiresAt ? src.expiresAt.toISOString() : null,
    acceptingJoins,
    joinBlockedReason: reason,
    seats,
    // ── 铁律：无候选时不伪造 ──
    // T04（双向匹配）落地前，本仓没有任何候选来源；本函数的**唯一赋值点**就是这里。
    // 结构性保证：不接受外部传入 candidates，也不存在"开关"能绕过。
    candidates: [] as never[],
    candidatesAvailable: false,
  }
}
