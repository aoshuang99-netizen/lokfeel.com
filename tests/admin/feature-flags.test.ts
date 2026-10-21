/**
 * V16 · T01 回归：功能开关归一化与时间格式
 *
 * 核心断言是「时间渲染与运行环境无关」—— 修复前页面用
 * `new Date().toISOString()` 当初始值 + `toLocaleString("zh-CN")` 渲染，
 * SSR 与浏览器首帧文本不同，React 抛 #418。
 */
import {
  computeStats,
  formatUpdatedAt,
  toFeatureFlagRow,
  toFeatureFlagRows,
} from '@/lib/admin/feature-flags'

describe('toFeatureFlagRow', () => {
  it('归一化 API 形状', () => {
    const row = toFeatureFlagRow({
      id: '1',
      code: 'MATCHING_ENABLED',
      name: '匹配功能',
      description: '启用/禁用用户匹配功能',
      enabled: true,
      category: 'core',
      lastModified: '2026-10-21T02:00:00.000Z',
      modifiedBy: 'admin_1',
    })

    expect(row).not.toBeNull()
    expect(row?.code).toBe('MATCHING_ENABLED')
    expect(row?.enabled).toBe(true)
    expect(row?.lastModified).toBe('2026-10-21T02:00:00.000Z')
    expect(row?.modifiedBy).toBe('admin_1')
  })

  it('缺 id 返回 null（无法切换的行不渲染）', () => {
    expect(toFeatureFlagRow({ name: 'x' })).toBeNull()
    expect(toFeatureFlagRow({ id: '   ' })).toBeNull()
  })

  it('非法时间降级为 null，不抛错', () => {
    expect(toFeatureFlagRow({ id: '1', lastModified: 'garbage' })?.lastModified).toBeNull()
    expect(toFeatureFlagRow({ id: '1' })?.lastModified).toBeNull()
  })

  it('enabled 只认布尔 true（字符串 "true" 不算启用）', () => {
    expect(toFeatureFlagRow({ id: '1', enabled: 'true' })?.enabled).toBe(false)
    expect(toFeatureFlagRow({ id: '1', enabled: true })?.enabled).toBe(true)
  })

  it('缺 name 时退回 code，再退回固定占位', () => {
    expect(toFeatureFlagRow({ id: '1', code: 'X' })?.name).toBe('X')
    expect(toFeatureFlagRow({ id: '1' })?.name).toBe('未命名开关')
  })
})

describe('toFeatureFlagRows', () => {
  it('非数组返回空数组', () => {
    expect(toFeatureFlagRows(null)).toEqual([])
    expect(toFeatureFlagRows({ features: [] })).toEqual([])
  })

  it('丢弃非对象与缺 id 项', () => {
    const rows = toFeatureFlagRows([null, 1, 'x', { name: 'y' }, { id: 'ok' }])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('ok')
  })
})

describe('computeStats', () => {
  it('统计启用/禁用数量', () => {
    const rows = toFeatureFlagRows([
      { id: '1', enabled: true },
      { id: '2', enabled: false },
      { id: '3', enabled: true },
    ])
    expect(computeStats(rows)).toEqual({ total: 3, enabled: 2, disabled: 1 })
  })

  it('空列表为全零（不是 undefined）', () => {
    expect(computeStats([])).toEqual({ total: 0, enabled: 0, disabled: 0 })
  })
})

describe('formatUpdatedAt — hydration 安全', () => {
  it('输出固定 UTC 格式，不含本地化字符串', () => {
    expect(formatUpdatedAt('2026-10-21T02:05:00.000Z')).toBe('2026-10-21 02:05 UTC')
  })

  it('同一输入在任何时区产出相同文本（这就是 #418 的根治点）', () => {
    const iso = '2026-10-21T02:05:00.000Z'
    const before = process.env.TZ
    const results: string[] = []
    for (const tz of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
      process.env.TZ = tz
      results.push(formatUpdatedAt(iso))
    }
    process.env.TZ = before
    expect(new Set(results).size).toBe(1)
    expect(results[0]).toBe('2026-10-21 02:05 UTC')
  })

  it('null / 非法值显示破折号', () => {
    expect(formatUpdatedAt(null)).toBe('—')
    expect(formatUpdatedAt('nope')).toBe('—')
  })
})
