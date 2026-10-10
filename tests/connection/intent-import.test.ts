/**
 * T03 · 档案导入许可测试（AC-12「用户主动授权」）
 *
 * 关键取向：**拒绝必须说得出原因**，且**不得静默过滤**。
 * 「用户勾了 5 个字段、系统只导入 3 个却不告知」是比报错危险得多的行为 ——
 * 他会误判自己的披露面。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ValidationError } from '@/lib/errors'
import {
  MAX_IMPORT_FIELDS,
  assertImportPlanAllAccepted,
  parseImportFields,
  planProfileImport,
} from '@/lib/connection/intent-import'

describe('T03 · 档案导入许可', () => {
  it('全部可导入字段 → accepted 完整、rejected 为空', () => {
    const plan = planProfileImport(['displayName', 'bio', 'occupation'])
    expect(plan.accepted).toEqual(['displayName', 'bio', 'occupation'])
    expect(plan.rejected).toEqual([])
    expect(plan.includesSensitive).toBe(false)
  })

  it('敏感字段被导入时标出 includesSensitive（审计要能单独检索）', () => {
    const plan = planProfileImport(['displayName', 'age'])
    expect(plan.accepted).toEqual(['displayName', 'age'])
    expect(plan.includesSensitive).toBe(true)
  })

  it('未知字段 → rejected.unknown_field（不静默吞掉）', () => {
    const plan = planProfileImport(['displayName', 'notAField'])
    expect(plan.accepted).toEqual(['displayName'])
    expect(plan.rejected).toEqual([{ field: 'notAField', reason: 'unknown_field' }])
  })

  it('🔒 email 之类的受保护字段 → rejected.not_importable', () => {
    const plan = planProfileImport(['email', 'displayName'])
    expect(plan.accepted).toEqual(['displayName'])
    expect(plan.rejected).toEqual([{ field: 'email', reason: 'not_importable' }])
  })

  it('去重并保持首次出现顺序；空白项忽略', () => {
    const plan = planProfileImport(['bio', 'bio', '  ', 'city'])
    expect(plan.accepted).toEqual(['bio', 'city'])
  })

  it('非数组输入 → 空计划（不猜测意图）', () => {
    expect(planProfileImport(undefined).accepted).toEqual([])
    expect(planProfileImport('displayName').accepted).toEqual([])
    expect(planProfileImport({ a: 1 }).accepted).toEqual([])
  })

  it('parseImportFields：undefined 视为"不导入"，不报错', () => {
    const plan = parseImportFields(undefined)
    expect(plan).toEqual({ accepted: [], rejected: [], includesSensitive: false })
  })

  it('🔒 parseImportFields：有被拒字段 → 400，且 details 列出**全部**拒绝项', () => {
    try {
      parseImportFields(['displayName', 'email', 'notAField'])
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError)
      const details = (e as ValidationError).details as any
      expect(details.field).toBe('importFields')
      expect(details.rejected).toEqual([
        { field: 'email', reason: 'not_importable' },
        { field: 'notAField', reason: 'unknown_field' },
      ])
    }
  })

  it('parseImportFields：非数组 / 含非字符串 → 400', () => {
    expect(() => parseImportFields('displayName')).toThrow(ValidationError)
    expect(() => parseImportFields(['displayName', 42])).toThrow(ValidationError)
  })

  it('超过上限 → 400（防止把整张档案塞进一次请求）', () => {
    const many = Array.from({ length: MAX_IMPORT_FIELDS + 1 }, (_, i) => `f${i}`)
    expect(() => parseImportFields(many)).toThrow(ValidationError)
  })

  it('assertImportPlanAllAccepted 对干净计划不抛异常', () => {
    expect(() =>
      assertImportPlanAllAccepted({ accepted: ['bio'], rejected: [], includesSensitive: false })
    ).not.toThrow()
  })
})
