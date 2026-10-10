/**
 * T02 · 幂等键单元测试（AC-07 在本任务的最小落点）
 *
 * 关注四类行为：
 *   1. 键缺失/超长 → 400（不退化成"非幂等"）
 *   2. 同键同体 → 返回首次结果，**不产生第二条资源**
 *   3. 同键异体 → 409（静默返旧值是更危险的失败模式）
 *   4. 并发/写入失败 → 重读胜者；无法判定则**回收孤儿资源**并原样抛错
 */

jest.mock('@/lib/db', () => ({
  db: {
    idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
  },
}))

import { db } from '@/lib/db'
import { ConflictError, ValidationError } from '@/lib/errors'
import {
  MAX_IDEMPOTENCY_KEY_LENGTH,
  hashRequest,
  requireIdempotencyKey,
  stableStringify,
  withIdempotency,
} from '@/lib/connection/idempotency'

const findUnique = db.idempotencyRecord.findUnique as unknown as jest.Mock
const createRecord = db.idempotencyRecord.create as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  createRecord.mockResolvedValue({})
})

describe('T02 · 幂等键', () => {
  describe('requireIdempotencyKey', () => {
    it('缺失 / 非字符串 / 空白 → 400', () => {
      expect(() => requireIdempotencyKey(undefined)).toThrow(ValidationError)
      expect(() => requireIdempotencyKey(null)).toThrow(ValidationError)
      expect(() => requireIdempotencyKey(123)).toThrow(ValidationError)
      expect(() => requireIdempotencyKey('   ')).toThrow(ValidationError)
    })

    it('超长 → 400', () => {
      expect(() =>
        requireIdempotencyKey('x'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1))
      ).toThrow(ValidationError)
    })

    it('正常值被 trim 后返回', () => {
      expect(requireIdempotencyKey('  abc-123  ')).toBe('abc-123')
    })
  })

  describe('stableStringify / hashRequest', () => {
    it('键顺序不影响指纹（否则同一次重试会误判为"异体"）', () => {
      expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
      expect(hashRequest({ a: 1, b: 2 })).toBe(hashRequest({ b: 2, a: 1 }))
    })

    it('内容不同则指纹不同', () => {
      expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }))
    })

    it('数组顺序**是**语义的一部分（不得排序）', () => {
      expect(hashRequest([1, 2])).not.toBe(hashRequest([2, 1]))
    })
  })

  describe('withIdempotency', () => {
    const baseOpts = (over: Record<string, unknown> = {}) => ({
      organizationId: 'org_1',
      scope: 'mission.create',
      key: 'k-1',
      requestHash: 'hash-a',
      resourceType: 'mission',
      load: jest.fn(async () => ({ id: 'm_1' })),
      create: jest.fn(async () => ({ resourceId: 'm_1', resource: { id: 'm_1' } })),
      ...over,
    })

    it('首次执行：创建资源 + 落幂等记录，replayed=false', async () => {
      findUnique.mockResolvedValue(null)
      const opts = baseOpts()

      const out = await withIdempotency(opts as never)

      expect(out.replayed).toBe(false)
      expect(opts.create).toHaveBeenCalledTimes(1)
      expect(createRecord).toHaveBeenCalledTimes(1)
      expect(createRecord.mock.calls[0][0].data).toMatchObject({
        organizationId: 'org_1',
        scope: 'mission.create',
        key: 'k-1',
        requestHash: 'hash-a',
        resourceType: 'mission',
        resourceId: 'm_1',
      })
    })

    it('🔒 同键同体：返回首次结果，**不再创建资源**', async () => {
      findUnique.mockResolvedValue({ requestHash: 'hash-a', resourceId: 'm_1' })
      const opts = baseOpts()

      const out = await withIdempotency(opts as never)

      expect(out.replayed).toBe(true)
      expect(out.resource).toEqual({ id: 'm_1' })
      expect(opts.create).not.toHaveBeenCalled()
      expect(createRecord).not.toHaveBeenCalled()
    })

    it('🔒 同键异体：409（不得静默返回旧资源）', async () => {
      findUnique.mockResolvedValue({ requestHash: 'hash-OTHER', resourceId: 'm_1' })
      const opts = baseOpts()

      await expect(withIdempotency(opts as never)).rejects.toBeInstanceOf(ConflictError)
      expect(opts.create).not.toHaveBeenCalled()
    })

    it('幂等记录在、资源已不存在 → 409（不伪造资源、也不创建新的）', async () => {
      findUnique.mockResolvedValue({ requestHash: 'hash-a', resourceId: 'm_gone' })
      const opts = baseOpts({ load: jest.fn(async () => null) })

      await expect(withIdempotency(opts as never)).rejects.toBeInstanceOf(ConflictError)
      expect(opts.create).not.toHaveBeenCalled()
    })

    describe('并发与失败补偿', () => {
      it('落记录撞唯一键（并发）→ 重读胜者并返回其结果', async () => {
        // 第一次 findUnique = 未命中（进入创建）；第二次 = 重读时命中胜者。
        findUnique
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ requestHash: 'hash-a', resourceId: 'm_winner' })
        createRecord.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))

        const create = jest.fn(async () => ({ resourceId: 'm_loser', resource: { id: 'm_loser' } }))
        const load = jest.fn(async (id: string) => ({ id }))
        const compensate = jest.fn(async () => {})

        const out = await withIdempotency({
          organizationId: 'org_1',
          scope: 'mission.create',
          key: 'k-1',
          requestHash: 'hash-a',
          resourceType: 'mission',
          load,
          create,
          compensate,
        })

        expect(out.replayed).toBe(true)
        expect(out.resource).toEqual({ id: 'm_winner' })
        // 并发胜者是别人 → 自己的孤儿资源应被回收
        expect(compensate).toHaveBeenCalledWith('m_loser')
      })

      it('并发且请求体不同 → 409，且回收自己的孤儿资源', async () => {
        findUnique
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ requestHash: 'hash-OTHER', resourceId: 'm_winner' })
        createRecord.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))

        const compensate = jest.fn(async () => {})
        await expect(
          withIdempotency({
            organizationId: 'org_1',
            scope: 'mission.create',
            key: 'k-1',
            requestHash: 'hash-a',
            resourceType: 'mission',
            load: jest.fn(async () => ({ id: 'x' })),
            create: jest.fn(async () => ({ resourceId: 'm_loser', resource: { id: 'm_loser' } })),
            compensate,
          })
        ).rejects.toBeInstanceOf(ConflictError)

        expect(compensate).toHaveBeenCalledWith('m_loser')
      })

      it('落记录遇到非唯一键错误 → 补偿后原样抛错（不吞异常、不留孤儿）', async () => {
        findUnique.mockResolvedValue(null)
        createRecord.mockRejectedValue(new Error('connection reset'))
        findUnique.mockResolvedValueOnce(null) // 重读也不命中

        const compensate = jest.fn(async () => {})
        await expect(
          withIdempotency({
            organizationId: 'org_1',
            scope: 'mission.create',
            key: 'k-1',
            requestHash: 'hash-a',
            resourceType: 'mission',
            load: jest.fn(async () => null),
            create: jest.fn(async () => ({ resourceId: 'm_orphan', resource: { id: 'm_orphan' } })),
            compensate,
          })
        ).rejects.toThrow('connection reset')

        expect(compensate).toHaveBeenCalledWith('m_orphan')
      })

      it('补偿自身失败不掩盖原始错误', async () => {
        findUnique.mockResolvedValue(null)
        createRecord.mockRejectedValue(new Error('db down'))

        await expect(
          withIdempotency({
            organizationId: 'org_1',
            scope: 'mission.create',
            key: 'k-1',
            requestHash: 'hash-a',
            resourceType: 'mission',
            load: jest.fn(async () => null),
            create: jest.fn(async () => ({ resourceId: 'm_x', resource: { id: 'm_x' } })),
            compensate: jest.fn(async () => {
              throw new Error('compensate boom')
            }),
          })
        ).rejects.toThrow('db down')
      })
    })
  })
})
