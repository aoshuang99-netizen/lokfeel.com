/**
 * Workspace 深链接纯函数单测（V20.3 · G-03 / Continuity）
 *
 * 纪律：每条「A ⇒ B」都必须有对应「not A」用例，否则空集恒真 = 假绿。
 * 特别是白名单：不仅要测「合法视图能写入」，更要测「未接线的 missions 写不进去」。
 */

import {
  DEFAULT_WORKSPACE_VIEW,
  WORKSPACE_VIEW_PARAM,
  resolveWorkspaceView,
  withWorkspaceView,
  workspaceViewUrl,
} from '@/lib/living/workspace-view'

/** 与 `living-workspace.tsx` NAV 中 ready:true 的六屏一致（不含 missions）。 */
const READY_VIEWS = ['now', 'studio', 'field', 'consent', 'outcomes', 'agents'] as const

describe('resolveWorkspaceView · 白名单解析', () => {
  it('合法视图：逐个都能被解析回自身', () => {
    for (const view of READY_VIEWS) {
      expect(resolveWorkspaceView(view, READY_VIEWS)).toBe(view)
    }
  })

  it('缺省 / 空值 → null（不覆盖当前 state）', () => {
    expect(resolveWorkspaceView(null, READY_VIEWS)).toBeNull()
    expect(resolveWorkspaceView('', READY_VIEWS)).toBeNull()
  })

  it('🔴 未接线屏 missions 不在白名单 → null，不得伪装可用', () => {
    expect(READY_VIEWS).not.toContain('missions')
    expect(resolveWorkspaceView('missions', READY_VIEWS)).toBeNull()
  })

  it('未知 / 大小写 / 注入串 → null', () => {
    for (const bad of ['unknown', 'NOW', 'now%27', '<script>', 'constructor', '__proto__']) {
      expect(resolveWorkspaceView(bad, READY_VIEWS)).toBeNull()
    }
  })

  it('not A：把同一个值放进空白名单 → null（证明上一条不是恒真）', () => {
    expect(resolveWorkspaceView('consent', [])).toBeNull()
    expect(resolveWorkspaceView('consent', ['now'])).toBeNull()
    expect(resolveWorkspaceView('consent', READY_VIEWS)).toBe('consent')
  })
})

describe('withWorkspaceView · 生成 search', () => {
  it('非默认视图写入 view 参数', () => {
    expect(withWorkspaceView('', 'consent', READY_VIEWS)).toBe('?view=consent')
  })

  it('默认视图 now 移除 view 参数，URL 保持干净', () => {
    expect(withWorkspaceView('?view=consent', DEFAULT_WORKSPACE_VIEW, READY_VIEWS)).toBe('')
    expect(withWorkspaceView('?view=agents', 'now', READY_VIEWS)).toBe('')
  })

  it('保留其他 query 参数原值', () => {
    const out = withWorkspaceView('?foo=bar&view=now&x=1', 'agents', READY_VIEWS)
    expect(new URLSearchParams(out).get('foo')).toBe('bar')
    expect(new URLSearchParams(out).get('x')).toBe('1')
    expect(new URLSearchParams(out).get(WORKSPACE_VIEW_PARAM)).toBe('agents')
  })

  it('🔴 白名单外视图（missions）不写入，且清掉已有的 view', () => {
    expect(withWorkspaceView('?view=consent', 'missions', READY_VIEWS)).toBe('')
    expect(withWorkspaceView('?foo=1&view=consent', 'missions', READY_VIEWS)).toBe('?foo=1')
  })

  it('重复 view 参数折叠为单个（URLSearchParams.set 语义）', () => {
    const out = new URLSearchParams(withWorkspaceView('?view=now&view=agents', 'field', READY_VIEWS))
    expect(out.getAll(WORKSPACE_VIEW_PARAM)).toEqual(['field'])
  })

  it('往返一致：写入 → 解析回原值', () => {
    for (const view of READY_VIEWS.filter((v) => v !== DEFAULT_WORKSPACE_VIEW)) {
      const search = withWorkspaceView('', view, READY_VIEWS)
      const raw = new URLSearchParams(search).get(WORKSPACE_VIEW_PARAM)
      expect(resolveWorkspaceView(raw, READY_VIEWS)).toBe(view)
    }
  })
})

describe('workspaceViewUrl · 同源 URL 拼装', () => {
  it('保留 pathname 与 hash', () => {
    expect(workspaceViewUrl('/workspace', '', '#evidence', 'outcomes', READY_VIEWS)).toBe(
      '/workspace?view=outcomes#evidence',
    )
  })

  it('默认视图只留 pathname + hash', () => {
    expect(workspaceViewUrl('/workspace', '?view=agents', '', 'now', READY_VIEWS)).toBe('/workspace')
  })

  it('not A：非法视图不产生带 view 的 URL', () => {
    expect(workspaceViewUrl('/workspace', '', '', 'missions', READY_VIEWS)).toBe('/workspace')
    expect(workspaceViewUrl('/workspace', '', '', 'consent', READY_VIEWS)).toBe('/workspace?view=consent')
  })
})
