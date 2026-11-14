/**
 * Evidence Lens 的展示分层（纯函数，无 React、无 IO）
 *
 * 每一行只做一件事：把「一个真实数字」翻译成一句人话，并把接口留在**下一层**。
 *
 * 🔴 为什么分层而不是删掉接口：
 *   这个产品的卖点是"每个数字都能追到源"。把源删掉等于把卖点删掉。
 *   但把源摆在第一眼，等于让用户替我们做代码审查。
 *   于是：人话在上（默认可见），接口在下（折叠），两者由同一行数据派生 ——
 *   不可能是两套数字。
 *
 * 🔴 为什么 `null` 必须是「读不到」而不是 0：
 *   0 是"真的没有"，null 是"没读到"。混为一谈就是虚报，
 *   而虚报恰恰是这个产品最不能犯的错。
 */

export interface EvidenceCapabilities {
  state: 'pending' | 'error' | 'ready'
  /** 已探测到的能力数（`state !== 'ready'` 时无意义）。 */
  count: number
  /** `state === 'error'` 时的原始原因（例如 `HTTP 403`）。 */
  error?: string | null
}

export interface EvidenceInput {
  unreadNotifications: number | null
  unreadChats: number | null
  totalChats: number | null
  capabilities: EvidenceCapabilities
  pendingProposals: number | null
  awaitingApproval: number | null
  unverifiedOutcomes: number | null
}

export interface EvidenceRow {
  key: string
  /** 人话标签（不含接口路径）。 */
  label: string
  /** 人话取值（不含接口路径）。 */
  value: string
  /** 补充说明（可无），例如"共 4 个会话"。 */
  detail?: string
  /** 这一行是否拿到了真实值。 */
  ok: boolean
  /** 唯一允许出现接口路径的字段。 */
  endpoint: string
}

const NOT_READ = '读不到'

function countRow(
  key: string,
  label: string,
  value: number | null,
  unit: string,
  endpoint: string,
  detail?: string,
): EvidenceRow {
  if (value === null) return { key, label, value: NOT_READ, ok: false, endpoint, detail }
  return { key, label, value: `${value} ${unit}`, ok: true, endpoint, detail }
}

/**
 * 顺序是刻意的：能力探测在最前 —— 它决定了后面几行**为什么**读不到，
 * 先看到"403"再看"读不到"，因果关系才成立。
 */
export function buildEvidenceRows(input: EvidenceInput): EvidenceRow[] {
  const caps = input.capabilities
  const capsRow: EvidenceRow =
    caps.state === 'ready'
      ? {
          key: 'capabilities',
          label: '可用的社群能力',
          value: `${caps.count} 项`,
          ok: true,
          endpoint: 'GET /api/v1/org',
          detail: caps.count === 0 ? '当前账号不是任何活跃社群的成员' : undefined,
        }
      : caps.state === 'error'
        ? {
            key: 'capabilities',
            label: '可用的社群能力',
            value: `探测失败（${caps.error ?? '原因未知'}）`,
            ok: false,
            endpoint: 'GET /api/v1/org',
          }
        : {
            key: 'capabilities',
            label: '可用的社群能力',
            value: '读取中',
            ok: false,
            endpoint: 'GET /api/v1/org',
          }

  return [
    capsRow,
    countRow(
      'notifications',
      '未读通知',
      input.unreadNotifications,
      '条',
      'GET /api/notifications',
    ),
    countRow(
      'chats',
      '未读消息',
      input.unreadChats,
      '条',
      'GET /api/chats/unread-count',
      input.totalChats === null ? undefined : `共 ${input.totalChats} 个会话`,
    ),
    countRow(
      'proposals',
      '待表态的提案',
      input.pendingProposals,
      '条',
      'GET /api/v1/connections/proposals',
    ),
    countRow(
      'execution',
      '待批准的执行',
      input.awaitingApproval,
      '个',
      'GET /api/v1/workflow/jobs',
    ),
    countRow('outcomes', '未核验的成果', input.unverifiedOutcomes, '条', 'GET /api/v1/outcomes'),
  ]
}
