/**
 * Now 屏的「种子目标」契约（TDD · 先红后绿）
 *
 * 为什么这些断言值得写：
 *   首页/工作区给用户的第一屏如果是空白输入框，转化率全靠用户自己会写 prompt。
 *   放三个一键可点的示例，是唯一能把"生成式"讲清楚的低成本手段。
 *   但示例一旦编译失败，就变成**死路** —— 用户点了，看到的是"没识别出目标类型"。
 *   所以这组用例把「种子必须真能跑通、且一路走到可创建」钉死。
 */

import { NOW_SEEDS } from '@/lib/living/now/seeds'
import { compileWorkspaceSpec, missionDraftFromSpec } from '@/lib/workspace-spec'

/** jest 的 expect 不收第二参数（那是 Playwright 的口径），失败信息用显式断言带出来。 */
function assertTrue(cond: boolean, message: string): void {
  if (!cond) throw new Error(message)
}

describe('NOW_SEEDS', () => {
  it('至少给三个入口（少于三个就不算"选择"）', () => {
    expect(NOW_SEEDS.length).toBeGreaterThanOrEqual(3)
  })

  it('id 与短标签都不重复', () => {
    expect(new Set(NOW_SEEDS.map((s) => s.id)).size).toBe(NOW_SEEDS.length)
    expect(new Set(NOW_SEEDS.map((s) => s.label)).size).toBe(NOW_SEEDS.length)
  })

  it('短标签是"钩子"，不是复述：不超过 20 个字符、不带句号', () => {
    for (const s of NOW_SEEDS) {
      expect(s.label.length).toBeLessThanOrEqual(20)
      expect(s.label).not.toMatch(/[。.]$/)
    }
  })

  it('每个种子都能编译出 WorkspaceSpec', () => {
    for (const s of NOW_SEEDS) {
      const result = compileWorkspaceSpec(s.goal)
      assertTrue(result.ok, `种子「${s.label}」编译失败：${result.ok ? '' : result.reason}`)
    }
  })

  it('每个种子都补全了服务端必填项 —— 点完就能创建，不会卡在"缺少对价"', () => {
    for (const s of NOW_SEEDS) {
      const result = compileWorkspaceSpec(s.goal)
      if (!result.ok) throw new Error(`种子「${s.label}」编译失败：${result.reason}`)
      const draft = missionDraftFromSpec(result.spec)
      assertTrue(
        draft.missing.length === 0,
        `种子「${s.label}」缺：${draft.missing.join('、')}`,
      )
      expect(draft.body).not.toBeNull()
    }
  })

  it('种子自带数量、期限与对价，否则编译出来仍是半个任务', () => {
    for (const s of NOW_SEEDS) {
      assertTrue(
        /\d+\s*[天周月]|[一二两三四五六七八九十]\s*(天|周|个月)/.test(s.goal),
        `「${s.label}」没有写在多久内`,
      )
      assertTrue(
        /\d+\s*(次|位|人|家|个|场|份|篇)/.test(s.goal),
        `「${s.label}」没有可数的判据`,
      )
      assertTrue(/提供|给予|付出|作为对价|换取|我们出/.test(s.goal), `「${s.label}」没有对价`)
    }
  })

  it('种子说人话：不出现接口路径、契约名、markdown 星号', () => {
    for (const s of NOW_SEEDS) {
      for (const text of [s.label, s.goal]) {
        expect(text).not.toMatch(/\/api\//)
        expect(text).not.toMatch(/\*\*/)
        expect(text).not.toMatch(/WorkspaceSpec|CONSENT_PENDING|MUTUALLY_ACCEPTED/)
      }
    }
  })
})
