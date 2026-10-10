/**
 * T02 · Mission 输入校验单元测试
 *
 * 覆盖：必填字段的长度边界、日期语义、限额边界、未知字段丢弃、
 * 以及「更新必须至少带一个可改字段」。
 */

import { ValidationError } from '@/lib/errors'
import {
  LIMITS,
  parseJoin,
  parseMissionAction,
  parseMissionCreate,
  parseMissionPatch,
} from '@/lib/connection/mission-input'

const NOW = new Date('2026-10-10T00:00:00.000Z')

const validBody = {
  goal: '在 3 个月内找到 2 家东南亚分销伙伴',
  offer: '产品样品 + 培训 + 联合营销预算',
  successCriteria: '签署试销协议并完成首批出货',
}

describe('T02 · mission-input', () => {
  describe('parseMissionCreate —— 正常路径', () => {
    it('最小必填集可用，title 缺省由 goal 派生', () => {
      const parsed = parseMissionCreate(validBody, NOW)
      expect(parsed.title).toBe(validBody.goal.slice(0, 80))
      expect(parsed.constraints).toEqual([])
      expect(parsed.publicPreview).toBe(true)
      expect(parsed.publish).toBe(false) // 保守：默认落 DRAFT
      expect(parsed.maxParticipants).toBeNull()
      expect(parsed.expiresAt).toBeNull()
    })

    it('title 显式给出时以其为准', () => {
      const parsed = parseMissionCreate({ ...validBody, title: '  渠道合作  ' }, NOW)
      expect(parsed.title).toBe('渠道合作')
    })

    it('constraints 经写路径收敛（trim/去重/过滤非字符串）', () => {
      const parsed = parseMissionCreate(
        { ...validBody, constraints: [' 东南亚 ', '东南亚', 1, null, ''] },
        NOW
      )
      expect(parsed.constraints).toEqual(['东南亚'])
    })

    it('publish=true 直接发布；discoverable=true 同义', () => {
      expect(parseMissionCreate({ ...validBody, publish: true }, NOW).publish).toBe(true)
      expect(parseMissionCreate({ ...validBody, discoverable: true }, NOW).publish).toBe(true)
      expect(parseMissionCreate({ ...validBody, discoverable: false }, NOW).publish).toBe(false)
    })

    it('maxParticipants 边界内可用', () => {
      expect(parseMissionCreate({ ...validBody, maxParticipants: 5 }, NOW).maxParticipants).toBe(5)
      expect(
        parseMissionCreate({ ...validBody, maxParticipants: LIMITS.maxParticipantsMax }, NOW)
          .maxParticipants
      ).toBe(LIMITS.maxParticipantsMax)
    })

    it('expiresAt 接受未来 ISO 时间', () => {
      const future = '2026-12-01T00:00:00.000Z'
      expect(parseMissionCreate({ ...validBody, expiresAt: future }, NOW).expiresAt?.toISOString()).toBe(
        future
      )
    })
  })

  describe('parseMissionCreate —— 拒绝路径', () => {
    const expectField = (fn: () => unknown, field: string) => {
      try {
        fn()
        throw new Error('应当抛出 ValidationError')
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError)
        expect((e as ValidationError).details).toEqual({ field })
      }
    }

    it('非对象 body → 400', () => {
      expect(() => parseMissionCreate([], NOW)).toThrow(ValidationError)
      expect(() => parseMissionCreate('x', NOW)).toThrow(ValidationError)
      expect(() => parseMissionCreate(null, NOW)).toThrow(ValidationError)
    })

    it('goal 过短 / 过长 / 非字符串', () => {
      expectField(() => parseMissionCreate({ ...validBody, goal: '太短' }, NOW), 'goal')
      expectField(
        () => parseMissionCreate({ ...validBody, goal: 'x'.repeat(LIMITS.goalMax + 1) }, NOW),
        'goal'
      )
      expectField(() => parseMissionCreate({ ...validBody, goal: 123 }, NOW), 'goal')
    })

    it('offer 空串 / successCriteria 过短', () => {
      expectField(() => parseMissionCreate({ ...validBody, offer: '   ' }, NOW), 'offer')
      expectField(() => parseMissionCreate({ ...validBody, successCriteria: 'ok' }, NOW), 'successCriteria')
    })

    it('maxParticipants 越界 / 非整数', () => {
      expectField(() => parseMissionCreate({ ...validBody, maxParticipants: 0 }, NOW), 'maxParticipants')
      expectField(
        () => parseMissionCreate({ ...validBody, maxParticipants: LIMITS.maxParticipantsMax + 1 }, NOW),
        'maxParticipants'
      )
      expectField(() => parseMissionCreate({ ...validBody, maxParticipants: 1.5 }, NOW), 'maxParticipants')
    })

    it('expiresAt 为过去时间 → 拒（创建即失效的任务是无效输入）', () => {
      expectField(
        () => parseMissionCreate({ ...validBody, expiresAt: '2020-01-01T00:00:00.000Z' }, NOW),
        'expiresAt'
      )
    })

    it('expiresAt 非法格式 → 拒', () => {
      expectField(() => parseMissionCreate({ ...validBody, expiresAt: 'not-a-date' }, NOW), 'expiresAt')
    })

    it('🔒 未知字段被丢弃（不进入下游，更不落库）', () => {
      const parsed = parseMissionCreate(
        { ...validBody, organizationId: 'org_attacker', ownerId: 'u_attacker', id: 'x', status: 'ACTIVE' },
        NOW
      )
      expect(Object.keys(parsed)).not.toContain('organizationId')
      expect(Object.keys(parsed)).not.toContain('ownerId')
      expect(Object.keys(parsed)).not.toContain('id')
      expect(Object.keys(parsed)).not.toContain('status')
    })
  })

  describe('parseMissionPatch', () => {
    it('只改显式给出的字段', () => {
      const patch = parseMissionPatch({ title: '新标题' }, NOW)
      expect(patch).toEqual({ title: '新标题' })
    })

    it('至少一个可改字段，否则 400', () => {
      expect(() => parseMissionPatch({}, NOW)).toThrow(ValidationError)
    })

    it('允许把 expiresAt 改到过去（"立即结束"是合法操作）', () => {
      const patch = parseMissionPatch({ expiresAt: '2020-01-01T00:00:00.000Z' }, NOW)
      expect(patch.expiresAt?.toISOString()).toBe('2020-01-01T00:00:00.000Z')
    })

    it('expiresAt=null 用于清空截止时间', () => {
      expect(parseMissionPatch({ expiresAt: null }, NOW).expiresAt).toBeNull()
    })

    it('maxParticipants=null 用于改为不限名额', () => {
      expect(parseMissionPatch({ maxParticipants: null }, NOW).maxParticipants).toBeNull()
    })

    it('publicPreview 只接受布尔值', () => {
      expect(parseMissionPatch({ publicPreview: false }, NOW).publicPreview).toBe(false)
      expect(() => parseMissionPatch({ publicPreview: 'false' }, NOW)).toThrow(ValidationError)
    })
  })

  describe('parseJoin / parseMissionAction', () => {
    it('空 body → 无留言', () => {
      expect(parseJoin(undefined)).toEqual({ note: null })
      expect(parseJoin(null)).toEqual({ note: null })
      expect(parseJoin('')).toEqual({ note: null })
      expect(parseJoin({})).toEqual({ note: null })
    })

    it('留言超长 → 400', () => {
      expect(() => parseJoin({ note: 'x'.repeat(LIMITS.noteMax + 1) })).toThrow(ValidationError)
    })

    it('action 白名单：publish/pause/resume/close', () => {
      expect(parseMissionAction('publish')).toBe('publish')
      expect(parseMissionAction('close')).toBe('close')
      expect(() => parseMissionAction('delete')).toThrow(ValidationError)
      expect(() => parseMissionAction('ACTIVE')).toThrow(ValidationError)
      expect(() => parseMissionAction(undefined)).toThrow(ValidationError)
    })
  })
})
