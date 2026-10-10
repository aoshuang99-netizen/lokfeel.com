/**
 * T02 · JSON-in-String codec 单元测试
 *
 * 这层的价值在于「读路径永不抛异常、写路径永不落脏数据」。
 * 因此用例分两组：宽容性（读）与收敛性（写）。
 */

import {
  decodeJson,
  decodeStringArray,
  encodeJson,
  normalizeObject,
  normalizeStringArray,
  MAX_ARRAY_ITEMS,
  MAX_ARRAY_ITEM_LENGTH,
} from '@/lib/connection/json-codec'

describe('T02 · json-codec', () => {
  describe('encodeJson', () => {
    it('undefined → null（表示"无值"，而不是 "undefined" 字符串）', () => {
      expect(encodeJson(undefined)).toBeNull()
    })

    it('null → "null"（显式空值被保留为 JSON null）', () => {
      expect(encodeJson(null)).toBe('null')
    })

    it('数组与对象序列化为合法 JSON', () => {
      expect(encodeJson(['a', 'b'])).toBe('["a","b"]')
      expect(encodeJson({ a: 1 })).toBe('{"a":1}')
      expect(decodeJson(encodeJson({ a: 1 }), {})).toEqual({ a: 1 })
    })
  })

  describe('decodeJson —— 全函数，绝不抛异常', () => {
    it('空值一律返回 fallback', () => {
      expect(decodeJson(null, 'fb')).toBe('fb')
      expect(decodeJson(undefined, 'fb')).toBe('fb')
      expect(decodeJson('', 'fb')).toBe('fb')
    })

    it('非法 JSON 返回 fallback 而不是抛异常（一行脏数据不得打挂列表接口）', () => {
      expect(() => decodeJson('{oops', 'fb')).not.toThrow()
      expect(decodeJson('{oops', { safe: true })).toEqual({ safe: true })
    })

    it('合法 JSON 正常解析', () => {
      expect(decodeJson('{"a":1}', {})).toEqual({ a: 1 })
      expect(decodeJson('[1,2]', [])).toEqual([1, 2])
    })

    it('"null" 文本 → fallback（不把 null 当有效值往上层传）', () => {
      expect(decodeJson('null', 'fb')).toBe('fb')
    })
  })

  describe('decodeStringArray —— 容忍 4 种历史/脏形态', () => {
    it('标准 JSON 数组', () => {
      expect(decodeStringArray('["a","b"]')).toEqual(['a', 'b'])
    })

    it('裸字符串 → 单元素数组（提升而不是丢弃）', () => {
      expect(decodeStringArray('只招有海外渠道的')).toEqual(['只招有海外渠道的'])
    })

    it('混入非字符串 → 过滤掉，不把数字带进下游', () => {
      expect(decodeStringArray('["a",1,null,{"x":1},"b"]')).toEqual(['a', 'b'])
    })

    it('JSON 是对象而非数组 → []', () => {
      expect(decodeStringArray('{"a":1}')).toEqual([])
    })

    it('空值 / 非法 JSON → []', () => {
      expect(decodeStringArray(null)).toEqual([])
      expect(decodeStringArray('')).toEqual([])
      expect(decodeStringArray('[broken')).toEqual([])
    })
  })

  describe('normalizeStringArray —— 写路径收敛', () => {
    it('非数组 → []（不猜测意图）', () => {
      expect(normalizeStringArray('a')).toEqual([])
      expect(normalizeStringArray({ a: 1 })).toEqual([])
      expect(normalizeStringArray(null)).toEqual([])
    })

    it('trim、去空、去重（保序）', () => {
      expect(normalizeStringArray([' a ', 'a', '', '  ', 'b'])).toEqual(['a', 'b'])
    })

    it('丢弃非字符串项', () => {
      expect(normalizeStringArray(['a', 1, null, undefined, {}, 'b'])).toEqual(['a', 'b'])
    })

    it('超长项被截断而不是整项丢弃', () => {
      const long = 'x'.repeat(MAX_ARRAY_ITEM_LENGTH + 50)
      const out = normalizeStringArray([long])
      expect(out).toHaveLength(1)
      expect(out[0]).toHaveLength(MAX_ARRAY_ITEM_LENGTH)
    })

    it('数量上限生效', () => {
      const many = Array.from({ length: MAX_ARRAY_ITEMS + 10 }, (_, i) => `i${i}`)
      expect(normalizeStringArray(many)).toHaveLength(MAX_ARRAY_ITEMS)
    })
  })

  describe('normalizeObject', () => {
    it('数组 / 标量 / null → {}', () => {
      expect(normalizeObject([])).toEqual({})
      expect(normalizeObject('x')).toEqual({})
      expect(normalizeObject(null)).toEqual({})
    })

    it('普通对象浅拷贝（不共享引用）', () => {
      const src = { a: 1 }
      const out = normalizeObject(src)
      expect(out).toEqual({ a: 1 })
      expect(out).not.toBe(src)
    })
  })
})
