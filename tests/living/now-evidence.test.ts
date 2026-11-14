/**
 * Evidence Lens 的展示契约（TDD · 先红后绿）
 *
 * 起因：`/workspace` 首屏右侧的证据面板，第一眼是六行 `GET /api/... → 0`。
 * 那是对**工程师**有用的审计轨迹，对用户只是"这产品坏了吗"。
 *
 * 结论不是删掉它（数字必须可追源），而是**分层**：
 *   第一层 = 人话标签 + 真实值；第二层（折叠）= 接口与原始值。
 * 纯函数 `buildEvidenceRows` 把这条分层变成可断言的契约：
 *   label / value 里**不允许**出现接口路径，endpoint 是唯一允许出现的地方。
 */

import { buildEvidenceRows, type EvidenceInput } from '@/lib/living/now/evidence'

/** jest 的 expect 不收第二参数，失败信息用显式断言带出来。 */
function assertTrue(cond: boolean, message: string): void {
  if (!cond) throw new Error(message)
}

const FULL: EvidenceInput = {
  unreadNotifications: 0,
  unreadChats: 13,
  totalChats: 4,
  capabilities: { state: 'ready', count: 6 },
  pendingProposals: 2,
  awaitingApproval: 1,
  unverifiedOutcomes: 5,
}

describe('buildEvidenceRows', () => {
  it('六个数字各一行，key 不重复', () => {
    const rows = buildEvidenceRows(FULL)
    expect(rows).toHaveLength(6)
    expect(new Set(rows.map((r) => r.key)).size).toBe(6)
  })

  it('人话在前：label 与 value 里都没有接口路径', () => {
    for (const row of buildEvidenceRows(FULL)) {
      assertTrue(!/\/api\//.test(row.label), `${row.key} 的标签漏了接口`)
      assertTrue(!/\/api\//.test(row.value), `${row.key} 的值漏了接口`)
      expect(row.label).not.toMatch(/GET\s/)
    }
  })

  it('接口只出现在 endpoint 字段，且必须是 GET 路径', () => {
    for (const row of buildEvidenceRows(FULL)) {
      expect(row.endpoint).toMatch(/^GET \/api\//)
    }
  })

  it('读不到就是读不到：null 不许兜成 0', () => {
    const rows = buildEvidenceRows({
      ...FULL,
      unreadNotifications: null,
      unreadChats: null,
      pendingProposals: null,
      awaitingApproval: null,
      unverifiedOutcomes: null,
    })
    for (const row of rows.filter((r) => r.key !== 'capabilities')) {
      assertTrue(row.ok === false, `${row.key} 把"读不到"当成了有值`)
      expect(row.value).toBe('读不到')
    }
  })

  it('能力探测失败要带上真实原因，而不是显示成 0 项', () => {
    const [row] = buildEvidenceRows({
      ...FULL,
      capabilities: { state: 'error', count: 0, error: 'HTTP 403' },
    })
    expect(row.ok).toBe(false)
    expect(row.value).toContain('403')
  })

  it('有值时才报数，且带单位', () => {
    const byKey = Object.fromEntries(buildEvidenceRows(FULL).map((r) => [r.key, r]))
    expect(byKey.notifications.value).toBe('0 条')
    expect(byKey.chats.value).toBe('13 条')
    expect(byKey.chats.detail).toContain('4')
    expect(byKey.capabilities.value).toBe('6 项')
  })

  it('加载中与"没有"是两件事', () => {
    const [row] = buildEvidenceRows({
      ...FULL,
      capabilities: { state: 'pending', count: 0 },
    })
    expect(row.ok).toBe(false)
    expect(row.value).toBe('读取中')
  })
})
