/**
 * 任务列表信封解析（TDD · 先红后绿）
 *
 * 为什么值得单测：`paginated()` 返回的 `data` **是数组**（meta 在 `meta` 上）。
 * 按 `{items}` 读会得到 `[]` —— 而"没有任务"与"读错了"在界面上长得一模一样，
 * 是 V21 明令禁止的假空态。这是真实发生过的缺陷（2026-11-14 取证时暴露）。
 */

import { missionsFromListPayload } from '@/lib/living/missions/list'

const mission = { id: 'm1', title: '任务', status: 'DRAFT' }

describe('missionsFromListPayload', () => {
  it('标准信封（data 是数组）→ 原样取出', () => {
    const payload = { success: true, data: [mission], meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 } }
    expect(missionsFromListPayload(payload)).toEqual([mission])
  })

  it('兼容 {items} 形状（旧版/代理层包裹）', () => {
    expect(missionsFromListPayload({ success: true, data: { items: [mission] } })).toEqual([mission])
  })

  it('空数组 → 空数组（真实空态）', () => {
    expect(missionsFromListPayload({ success: true, data: [] })).toEqual([])
  })

  it('形状不认识 → 空数组，但不抛错（列表页崩掉比空更难查）', () => {
    expect(missionsFromListPayload(null)).toEqual([])
    expect(missionsFromListPayload({ data: 'oops' })).toEqual([])
    expect(missionsFromListPayload({ data: [1, 2] })).toEqual([])
  })

  it('数组里混入非对象 → 只保留对象项', () => {
    expect(missionsFromListPayload({ data: [mission, null, 'x'] })).toEqual([mission])
  })
})
