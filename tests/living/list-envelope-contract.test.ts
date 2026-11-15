/**
 * V21 · 第二批 —— 列表信封「真实契约」测试（TDD · 先红后绿）
 *
 * 用户特别要求：新增所有列表都应进行真实信封契约测试，覆盖**数据非空**和
 * **权限错误**，不允许空数组假绿；「集合断言先证前置非空（空集恒真=假绿）」。
 *
 * 因此每条非空用例都先 `assertNonEmpty(result)`，再断言条目内容；
 * 权限错误断言 kind='error' 且**不等于** 'empty'（错误 ≠ 没有数据）。
 * fixtures 来自真实端点响应形状，供单测与独立 QA 共用。
 */

import {
  parseListEnvelope,
  assertNonEmpty,
  ENVELOPE_CONTRACT_FIXTURES,
} from '@/lib/living/api/envelope'

describe('ENVELOPE_CONTRACT_FIXTURES · 真实端点响应形状', () => {
  it('fixtures 至少 6 条，且覆盖权限错误与畸形载荷', () => {
    expect(ENVELOPE_CONTRACT_FIXTURES.length).toBeGreaterThanOrEqual(6)
    expect(
      ENVELOPE_CONTRACT_FIXTURES.some((f) => f.expectKind === 'error' && f.permissionDenied),
    ).toBe(true)
    expect(ENVELOPE_CONTRACT_FIXTURES.some((f) => f.expectKind === 'unexpected')).toBe(true)
  })

  for (const fixture of ENVELOPE_CONTRACT_FIXTURES) {
    it(`[${fixture.id}] ${fixture.endpoint} → ${fixture.expectKind}`, () => {
      const result = parseListEnvelope(fixture.payload, { status: fixture.httpStatus })
      expect(result.kind).toBe(fixture.expectKind)
      expect(result.count).toBe(fixture.expectCount)
      expect(result.items).toHaveLength(fixture.expectCount)

      if (fixture.expectKind === 'ok') {
        // ① 先证前置非空：空集恒真 = 假绿
        expect(fixture.firstItem).toBeDefined()
        expect(() => assertNonEmpty(result)).not.toThrow()
        assertNonEmpty(result)
        expect(result.kind).not.toBe('empty')
        // ② 再断言条目内容（此时已保证 items 非空）
        expect(result.items[0]).toMatchObject(fixture.firstItem!)
      }

      if (fixture.expectKind === 'error') {
        // 权限错误：items 为空，但语义上「不等于没有数据」
        expect(result.kind).not.toBe('empty')
        expect(result.items).toEqual([])
        expect(result.code).toBeTruthy()
        expect(result.message).toBeTruthy()
        if (fixture.permissionDenied) {
          expect(result.permissionDenied).toBe(true)
          expect(['PERMISSION_DENIED', 'UNAUTHORIZED']).toContain(result.code as string)
        }
      }

      if (fixture.expectKind === 'unexpected') {
        // 无法识别的形状：不是静默空数组，也绝不能被当成合法空
        expect(result.kind).not.toBe('empty')
        expect(result.items).toEqual([])
        expect(result.count).toBe(0)
      }
    })
  }
})

describe('parseListEnvelope · 契约边界', () => {
  const forbiddenError = {
    code: 'PERMISSION_DENIED',
    message: 'You do not have permission to perform this action',
    details: { capability: 'mission.read' },
  }

  it('success:false 绝不映射成空列表（即使 data 恰是 []）', () => {
    const r = parseListEnvelope({ success: false, data: [], error: forbiddenError })
    expect(r.kind).toBe('error')
    expect(r.kind).not.toBe('empty')
    expect(r.items).toEqual([])
    expect(r.code).toBe('PERMISSION_DENIED')
    expect(r.message).toContain('permission')
  })

  it('HTTP 401/403 即使 success:true 也判 error（权限错误）', () => {
    const okShaped = { success: true, data: [{ id: 'm1' }] }
    const r403 = parseListEnvelope(okShaped, { status: 403 })
    expect(r403.kind).toBe('error')
    expect(r403.permissionDenied).toBe(true)
    expect(r403.items).toEqual([])
    const r401 = parseListEnvelope(okShaped, { status: 401 })
    expect(r401.kind).toBe('error')
    expect(r401.permissionDenied).toBe(true)
  })

  it('合法空是 empty，不是 unexpected，也不是 error', () => {
    const r = parseListEnvelope({
      success: true,
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    })
    expect(r.kind).toBe('empty')
    expect(r.count).toBe(0)
    expect(r.items).toEqual([])
    expect(() => assertNonEmpty(r)).toThrow(/非空/)
  })

  it('数组 data 非空 → ok + count 与 meta 解耦', () => {
    const rows = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]
    const r = parseListEnvelope({ success: true, data: rows, meta: { total: 3 } })
    expect(r.kind).toBe('ok')
    expect(r.count).toBe(3)
    assertNonEmpty(r)
    expect(r.items).toEqual(rows)
  })

  it('自定义 itemKeys 可扩展命名键', () => {
    const r = parseListEnvelope(
      { success: true, data: { invites: [{ id: 'i1' }] } },
      { itemKeys: ['invites'] },
    )
    expect(r.kind).toBe('ok')
    expect(r.items).toEqual([{ id: 'i1' }])
  })

  it('未知命名键但对象里恰好一个数组属性 → 自动识别，不静默空', () => {
    const r = parseListEnvelope({ success: true, data: { roster: [{ id: 'u1' }], total: 1 } })
    expect(r.kind).toBe('ok')
    expect(r.items).toEqual([{ id: 'u1' }])
  })

  it('畸形载荷 → unexpected，不是静默空数组', () => {
    expect(parseListEnvelope(null).kind).toBe('unexpected')
    expect(parseListEnvelope('oops').kind).toBe('unexpected')
    expect(parseListEnvelope({ success: true }).kind).toBe('unexpected')
    expect(parseListEnvelope({ success: true, data: 'oops' }).kind).toBe('unexpected')
    expect(parseListEnvelope({ success: true, data: { items: 'not-an-array' } }).kind).toBe(
      'unexpected',
    )
    expect(parseListEnvelope({ success: true, data: { count: 0, filters: {} } }).kind).toBe(
      'unexpected',
    )
  })

  it('assertNonEmpty 对 empty / error / unexpected 一律抛错（防假绿）', () => {
    expect(() => assertNonEmpty(parseListEnvelope({ success: true, data: [] }))).toThrow(/非空/)
    expect(() => assertNonEmpty(parseListEnvelope({ success: false, data: null }))).toThrow(/非空/)
    expect(() => assertNonEmpty(parseListEnvelope({ success: true, data: 'oops' }))).toThrow(/非空/)
  })
})
