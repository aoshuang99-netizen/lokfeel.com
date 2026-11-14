/**
 * Mission 面向用户的语言契约（TDD · 先红后绿）
 *
 * V21 · C05：任务列表要接进工作区。用户看到的必须是**人话状态**，
 * 而不是 `DRAFT/ACTIVE/PAUSED/CLOSED` 这种服务端枚举。
 * 状态迁移表必须与服务端 `TRANSITIONS`（src/lib/connection/missions.ts）一致 ——
 * 前端不允许出现"点了必然 409"的按钮。
 */

import { missionStatusLabel, missionTransitions } from '@/lib/living/missions/labels'

describe('missionStatusLabel', () => {
  it('四种服务端状态都有人话标签（不含英文枚举词）', () => {
    expect(missionStatusLabel('DRAFT')).toBe('草稿')
    expect(missionStatusLabel('ACTIVE')).toBe('进行中')
    expect(missionStatusLabel('PAUSED')).toBe('已暂停')
    expect(missionStatusLabel('CLOSED')).toBe('已结束')
  })

  it('未知状态不猜标签（诚实抛错优于静默显示枚举原文）', () => {
    expect(() => missionStatusLabel('UNKNOWN' as never)).toThrow()
  })
})

describe('missionTransitions · 与服务端 TRANSITIONS 表逐格对齐', () => {
  it('DRAFT → 可发布、可关闭；不可暂停/恢复', () => {
    const keys = missionTransitions('DRAFT', true).map((t) => t.action)
    expect(keys).toContain('publish')
    expect(keys).toContain('close')
    expect(keys).not.toContain('pause')
    expect(keys).not.toContain('resume')
  })

  it('ACTIVE → 可暂停、可关闭；不可再发布', () => {
    const keys = missionTransitions('ACTIVE', true).map((t) => t.action)
    expect(keys).toContain('pause')
    expect(keys).toContain('close')
    expect(keys).not.toContain('publish')
    expect(keys).not.toContain('resume')
  })

  it('PAUSED → 可恢复、可关闭', () => {
    const keys = missionTransitions('PAUSED', true).map((t) => t.action)
    expect(keys).toContain('resume')
    expect(keys).toContain('close')
  })

  it('CLOSED → 没有任何可做动作（终态不给按钮）', () => {
    expect(missionTransitions('CLOSED', true)).toEqual([])
  })

  it('没有 mission.update 能力 → 全部不给（canUpdate=false）', () => {
    expect(missionTransitions('ACTIVE', false)).toEqual([])
  })

  it('每个迁移动作都带人话标签与去向状态', () => {
    for (const t of missionTransitions('DRAFT', true)) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(['ACTIVE', 'PAUSED', 'CLOSED']).toContain(t.to)
    }
  })
})
