/**
 * T02 · 公开投影单元测试
 *
 * 这一层承载两条验收铁律：
 *   1. **最小披露**：白名单字段之外的一切不得出现在投影里（含负测断言）。
 *   2. **无候选时不伪造**：`candidates` 恒为空、`candidatesAvailable` 恒为 false。
 */

import {
  EXCLUDED_PUBLIC_FIELDS,
  buildSeats,
  evaluateJoinability,
  toPublicMissionView,
} from '@/lib/connection/public-view'

const base = {
  title: '寻找东南亚渠道伙伴',
  goal: '在 3 个月内为新品找到 2 家东南亚分销伙伴',
  offer: '提供产品样品、培训与联合营销预算',
  successCriteria: '双方签署试销协议并完成首批出货',
  status: 'ACTIVE' as const,
  expiresAt: null,
  publishedAt: new Date('2026-10-10T00:00:00.000Z'),
}

describe('T02 · 公开投影（最小披露）', () => {
  describe('字段白名单', () => {
    const view = toPublicMissionView(base, {
      participantCount: 3,
      communityName: '跨境卖家社群',
      capacity: 10,
    })

    it('输出且仅输出允许的字段', () => {
      expect(Object.keys(view).sort()).toEqual(
        [
          'acceptingJoins',
          'candidates',
          'candidatesAvailable',
          'community',
          'expiresAt',
          'goal',
          'joinBlockedReason',
          'offer',
          'publishedAt',
          'seats',
          'status',
          'successCriteria',
          'title',
        ].sort()
      )
    })

    it('🔒 内部标识与内部约束一律不出现（防止未来"顺手加字段"）', () => {
      const json = JSON.stringify(view)
      for (const field of EXCLUDED_PUBLIC_FIELDS) {
        expect(Object.keys(view)).not.toContain(field)
        // 用**带引号的键名**判定，而不是裸子串 ——
        // 裸子串会误报（例如 "candidates" 里含 "id"）。泄露必然表现为 JSON 键。
        expect(json).not.toContain(`"${field}"`)
      }
    })

    it('日期序列化为 ISO 字符串（不是 Date 对象，避免 JSON 里变成 {}）', () => {
      expect(view.publishedAt).toBe('2026-10-10T00:00:00.000Z')
      expect(view.expiresAt).toBeNull()
    })

    it('社群名为 null 时不抛异常', () => {
      const v = toPublicMissionView(base, { participantCount: 0, communityName: null })
      expect(v.community).toBeNull()
    })
  })

  describe('铁律：无候选时不伪造', () => {
    it('candidates 恒为空数组，candidatesAvailable 恒为 false', () => {
      const v = toPublicMissionView(base, { participantCount: 0, communityName: null })
      expect(v.candidates).toEqual([])
      expect(v.candidatesAvailable).toBe(false)
      expect(v.candidates).toHaveLength(0)
    })

    it('即便名额与人数都为 0，也不生成任何占位候选', () => {
      const v = toPublicMissionView(base, { participantCount: 0, communityName: 'X', capacity: 0 })
      expect(v.candidates).toEqual([])
      // 投影里唯一与候选相关的字段就是这两个常量，不存在承接候选的容器。
      expect(v.candidatesAvailable).toBe(false)
      expect(Object.keys(v)).not.toContain('candidateItems')
      expect(Object.keys(v)).not.toContain('matches')
    })
  })

  describe('joinability —— 每个拒绝都能说出原因', () => {
    const seats = buildSeats(10, 3)

    it('ACTIVE 且未过期且未满 → 可加入', () => {
      expect(evaluateJoinability(base, seats)).toEqual({ acceptingJoins: true, reason: null })
    })

    it('PAUSED / CLOSED / DRAFT → 明确原因', () => {
      expect(evaluateJoinability({ ...base, status: 'PAUSED' }, seats).reason).toBe('paused')
      expect(evaluateJoinability({ ...base, status: 'CLOSED' }, seats).reason).toBe('closed')
      expect(evaluateJoinability({ ...base, status: 'DRAFT' }, seats).reason).toBe('draft')
    })

    it('已过期 → expired（且优先于满员判定）', () => {
      const past = new Date('2000-01-01T00:00:00.000Z')
      expect(
        evaluateJoinability({ ...base, expiresAt: past }, buildSeats(1, 1)).reason
      ).toBe('expired')
    })

    it('名额已满 → full', () => {
      expect(evaluateJoinability(base, buildSeats(3, 3)).reason).toBe('full')
      expect(evaluateJoinability(base, buildSeats(3, 4)).reason).toBe('full')
    })

    it('不限名额（capacity=null）永不满员', () => {
      expect(evaluateJoinability(base, buildSeats(null, 9999)).acceptingJoins).toBe(true)
    })
  })

  describe('buildSeats —— 脏计数不得产生负数或 NaN', () => {
    it('负数/NaN/小数被收敛', () => {
      expect(buildSeats(10, -1)).toEqual({ capacity: 10, taken: 0, remaining: 10 })
      expect(buildSeats(10, NaN).taken).toBe(0)
      expect(buildSeats(10, 3.7).taken).toBe(3)
    })

    it('taken 超过 capacity 时 remaining 钳制为 0', () => {
      expect(buildSeats(2, 5).remaining).toBe(0)
    })

    it('capacity 为 null 时 remaining 为 null', () => {
      expect(buildSeats(null, 5)).toEqual({ capacity: null, taken: 5, remaining: null })
    })
  })
})
