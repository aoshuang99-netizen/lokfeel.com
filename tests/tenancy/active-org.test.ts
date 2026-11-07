/**
 * V20.5 · Batch 3 —— 租户软偏好（`lf-active-org`）
 *
 * 这层只守两件事，都是"错一次就会静默出错"的那类：
 *   1. **形状校验**：非法值必须在进入 DB 之前变成 `null`（回落默认租户），
 *      而不是带着引号/空格去查库；
 *   2. **cookie 属性**：`httpOnly` + `path=/` + `sameSite=lax` 缺一不可 ——
 *      缺 `httpOnly` 就等于把"当前看哪个社群"暴露给任何一段 XSS；
 *      缺 `path=/` 会让 `/console/*` 之外的请求读不到，切换看起来"时灵时不灵"。
 *
 * 不测什么：真实解析（cookie → 成员关系 → TenantContext）需要 DB，
 * 由 `verify:auth:session`（scripts/qa/v205-auth-session.mjs 的 S15–S18）在线验证。
 */

import {
  ACTIVE_ORG_COOKIE,
  ACTIVE_ORG_MAX_AGE,
  activeOrgCookieOptions,
  normalizeActiveOrgId,
} from '@/lib/tenancy/active-org'

describe('normalizeActiveOrgId', () => {
  it('接受常见形状（cuid / uuid / 带连字符）', () => {
    expect(normalizeActiveOrgId('clx1a2b3c4d5e6f7g8h9i0j1k')).toBe('clx1a2b3c4d5e6f7g8h9i0j1k')
    expect(normalizeActiveOrgId('3f0a6d5e-8c1b-4d2a-9e3f-5a6b7c8d9e0f')).toBe(
      '3f0a6d5e-8c1b-4d2a-9e3f-5a6b7c8d9e0f',
    )
    expect(normalizeActiveOrgId('  org_abc-123  ')).toBe('org_abc-123')
  })

  it('拒绝空与非字符串', () => {
    expect(normalizeActiveOrgId(undefined)).toBeNull()
    expect(normalizeActiveOrgId(null)).toBeNull()
    expect(normalizeActiveOrgId(123)).toBeNull()
    expect(normalizeActiveOrgId('')).toBeNull()
    expect(normalizeActiveOrgId('   ')).toBeNull()
  })

  it('拒绝超长（>64）', () => {
    expect(normalizeActiveOrgId('a'.repeat(64))).toBe('a'.repeat(64))
    expect(normalizeActiveOrgId('a'.repeat(65))).toBeNull()
  })

  it('拒绝注入形状与非法字符', () => {
    expect(normalizeActiveOrgId("x' OR 1=1 --")).toBeNull()
    expect(normalizeActiveOrgId('org/../other')).toBeNull()
    expect(normalizeActiveOrgId('org id')).toBeNull()
    expect(normalizeActiveOrgId('org;drop')).toBeNull()
    expect(normalizeActiveOrgId('%00')).toBeNull()
  })
})

describe('activeOrgCookieOptions', () => {
  it('http 下不写 Secure，https 下写 Secure', () => {
    expect(activeOrgCookieOptions(false)).toMatchObject({ secure: false })
    expect(activeOrgCookieOptions(true)).toMatchObject({ secure: true })
  })

  it('属性完整：httpOnly / path / sameSite / maxAge', () => {
    expect(activeOrgCookieOptions(false)).toEqual({
      name: ACTIVE_ORG_COOKIE,
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: ACTIVE_ORG_MAX_AGE,
    })
  })

  it('cookie 名与主题偏好（lf-theme）同族但不冲突', () => {
    expect(ACTIVE_ORG_COOKIE).toBe('lf-active-org')
    expect(ACTIVE_ORG_COOKIE).not.toBe('lf-theme')
    // 30 天，不是"会话级"：关掉浏览器再回来，用户不该被丢回默认社群。
    expect(ACTIVE_ORG_MAX_AGE).toBe(60 * 60 * 24 * 30)
  })
})
