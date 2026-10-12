/**
 * T06 · 通知内容与披露边界（纯函数）—— AC-09「消息合规」
 *
 * 三层防线各自要有一个可证伪的断言：
 *   1. 类型层：`RenderInput` 没有 rationale/档案字段 → 想传也传不进来（编译期保证，
 *      这里用"运行时也不泄漏"做行为佐证）；
 *   2. 运行时：`assertNoLeakage()` 对渲染结果做长公共子串检测，命中即抛错；
 *   3. 身份声明：每条通知**必须**携带"由谁通过 LokFeel 发出"。
 */

import {
  LEAK_MIN_OVERLAP,
  NOTIFICATION_TEMPLATES,
  NotificationLeakError,
  SENDER_ATTRIBUTION_SUFFIX,
  assertNoLeakage,
  hasSenderAttribution,
  isNotificationTemplate,
  longestCommonSubstringLength,
  renderNotification,
  type NotificationTemplate,
} from '@/lib/workflow/notification-content'

describe('T06 · renderNotification（模板与身份声明）', () => {
  it('每个登记模板都能渲染出非空 subject 与 body（覆盖到全部模板）', () => {
    for (const template of NOTIFICATION_TEMPLATES) {
      const r = renderNotification({ template, organizationName: '示例社群' })
      expect(r.subject.length).toBeGreaterThan(0)
      expect(r.body.length).toBeGreaterThan(0)
    }
  })

  it('★ 每条通知**必须**带身份声明后缀（AC-09：不得静默冒充真人）', () => {
    for (const template of NOTIFICATION_TEMPLATES) {
      const r = renderNotification({ template, organizationName: '示例社群' })
      expect(hasSenderAttribution(r)).toBe(true)
      expect(r.body).toContain(SENDER_ATTRIBUTION_SUFFIX)
    }
  })

  it('身份声明里点名组织，让"系统/组织方发出"与"真人私聊"在文本层面不可混淆', () => {
    const r = renderNotification({ template: 'proposal.pending', organizationName: '春藤会' })
    expect(r.body).toContain('春藤会')
  })

  it('组织名为空 → 回落到中性默认名（不渲染出「」空引号）', () => {
    const r = renderNotification({ template: 'proposal.pending', organizationName: '   ' })
    expect(r.body).toContain('你的社群')
    expect(r.body).not.toContain('「」')
  })

  it('missionTitle 是唯一可选业务文本，且只在提供时出现', () => {
    const withTitle = renderNotification({
      template: 'proposal.pending',
      organizationName: '社群',
      missionTitle: '出海合规对接',
    })
    expect(withTitle.body).toContain('出海合规对接')
    const without = renderNotification({ template: 'proposal.pending', organizationName: '社群' })
    expect(without.body).not.toContain('任务：')
  })

  it('actionUrl 原样带出；未提供 → null（不是空串）', () => {
    const r = renderNotification({
      template: 'connection.introduced',
      organizationName: '社群',
      actionUrl: '/m/tok/proposals',
    })
    expect(r.actionUrl).toBe('/m/tok/proposals')
    expect(renderNotification({ template: 'connection.introduced', organizationName: '社群' }).actionUrl).toBeNull()
  })

  it('★ 提案待处理通知**不**包含"对方是谁/为什么是你"（那是披露页的职责）', () => {
    const r = renderNotification({ template: 'proposal.pending', organizationName: '社群' })
    expect(r.body).toContain('连接页')
    // 明确告诉用户：在你同意之前不会披露你的信息
    expect(r.body).toContain('不会向对方披露')
  })

  it('isNotificationTemplate 只认登记在册的模板（共 5 个）', () => {
    expect(NOTIFICATION_TEMPLATES).toHaveLength(5)
    expect(isNotificationTemplate('proposal.pending')).toBe(true)
    expect(isNotificationTemplate('connection.followup')).toBe(true)
    // R9 新增：运营告警模板也必须被登记，否则 alerts.ts 的投递会被当成非法模板
    expect(isNotificationTemplate('operator.attention')).toBe(true)
    expect(isNotificationTemplate('proposal.rejected')).toBe(false)
    expect(isNotificationTemplate(42)).toBe(false)
  })

  it('★ 运营告警**不**引用任务标题（告警只说"有事"，不说是谁的什么事）', () => {
    const withMission = renderNotification({
      template: 'operator.attention',
      organizationName: '静山读书会',
      missionTitle: '东南亚清关资源对接',
    })
    // 即便是传了 missionTitle，运营告警模板也不该把它渲染出去
    expect(withMission.body).not.toContain('东南亚清关资源对接')
    expect(withMission.body).toContain(SENDER_ATTRIBUTION_SUFFIX)
  })
})

describe('T06 · longestCommonSubstringLength', () => {
  it('空串 → 0', () => {
    expect(longestCommonSubstringLength('', 'abc')).toBe(0)
    expect(longestCommonSubstringLength('abc', '')).toBe(0)
  })

  it('相同串 → 全长', () => {
    expect(longestCommonSubstringLength('abcdef', 'abcdef')).toBe(6)
  })

  it('能抓到"截断后的泄漏"（includes() 抓不到的那种）', () => {
    const protectedText = '你们互补：他在找东南亚清关资源，你有雅加达落地经验'
    const leaked = `系统提示：${protectedText.slice(0, 20)}…`
    expect(leaked.includes(protectedText)).toBe(false) // 整串包含不成立
    expect(longestCommonSubstringLength(leaked, protectedText)).toBeGreaterThanOrEqual(20)
  })

  it('无关文本 → 短重合（不误报）', () => {
    expect(longestCommonSubstringLength('你好世界', 'abcdef')).toBe(0)
  })
})

describe('T06 · assertNoLeakage（披露边界守卫）', () => {
  const rendered = renderNotification({ template: 'proposal.pending', organizationName: '社群' })

  it('受保护原文与正文无关 → 不抛错', () => {
    expect(() =>
      assertNoLeakage(rendered, ['完全不相干的另一段推荐理由'], 'proposal.pending')
    ).not.toThrow()
  })

  it('★ 受保护原文整个被拼进正文 → 抛 NotificationLeakError（带 overlap）', () => {
    const rationale = '你们互补：他在找东南亚清关，你有雅加达落地资源。'
    const evil = {
      subject: rendered.subject,
      body: `${rendered.body}\n${rationale}`,
      actionUrl: null,
    }
    try {
      assertNoLeakage(evil, [rationale], 'proposal.pending')
      throw new Error('应当抛错')
    } catch (err) {
      expect(err).toBeInstanceOf(NotificationLeakError)
      expect((err as NotificationLeakError).template).toBe('proposal.pending')
      expect((err as NotificationLeakError).overlap).toBeGreaterThanOrEqual(LEAK_MIN_OVERLAP)
    }
  })

  it('★ 截断后的泄漏（20 字片段）也能被抓到', () => {
    const rationale = '你们互补：他在找东南亚清关资源，你有雅加达落地经验可以互补。'
    const evil = {
      subject: rendered.subject,
      body: `${rendered.body}\n（补充：${rationale.slice(0, 18)}）`,
      actionUrl: null,
    }
    expect(() => assertNoLeakage(evil, [rationale], 'proposal.pending')).toThrow(NotificationLeakError)
  })

  it('短于阈值的巧合重合不误报（阈值 12 字）', () => {
    // 构造一个仅 8 字重合的文本 —— 应当放行
    const short = '连接页查看' // 8 字
    expect(longestCommonSubstringLength(`${rendered.subject}\n${rendered.body}`, short)).toBeLessThan(
      LEAK_MIN_OVERLAP
    )
    expect(() => assertNoLeakage(rendered, [short], 'proposal.pending')).not.toThrow()
  })

  it('受保护文本为 null/undefined/空白 → 跳过（不因空值误判）', () => {
    expect(() => assertNoLeakage(rendered, [null, undefined, '   '], 'proposal.pending')).not.toThrow()
  })

  it('多个受保护文本任一中招即抛', () => {
    const evil = { subject: rendered.subject, body: `${rendered.body}\n这一段完全一致的字串ABC`, actionUrl: null }
    expect(() =>
      assertNoLeakage(evil, ['无关文本', '这一段完全一致的字串ABC'], 'proposal.pending')
    ).toThrow(NotificationLeakError)
  })

  it('守卫在**发送之前**：renderNotification 的产物本身永不触发（模板没带受保护内容）', () => {
    const rationale = '你们互补：他在找东南亚清关，你有雅加达落地资源。'
    for (const template of NOTIFICATION_TEMPLATES) {
      const r = renderNotification({ template, organizationName: '社群' })
      expect(() => assertNoLeakage(r, [rationale], template as NotificationTemplate)).not.toThrow()
    }
  })
})
