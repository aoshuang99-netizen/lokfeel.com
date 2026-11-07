/**
 * 活跃租户偏好（V20.5 · Batch 3「组织切换」）
 * ═══════════════════════════════════════════════════════════════════
 * 问题：在 V20.5 之前，一个属于多个社群的人**只能看到最早加入的那个**。
 * `resolveTenantForUser()` 在未指定 `organizationId` 时按 `createdAt asc` 取第一条，
 * 而 Console 七屏的服务端布局直接调它、又没有任何切换入口 ——
 * 于是"我的第二个社群"在 UI 上**根本不存在**。这不是"少个下拉框"，是功能缺失：
 * 角色/成员/成果全都读的是另一个租户。`listTenants()` 的注释里早就写着
 * 「租户切换器用」，但那个切换器从未被写出来。
 *
 * 解决：把"我现在在看哪个社群"存成一个 cookie（软偏好），解析时**先试它**。
 *
 * 🔴 为什么是 cookie 而不是 session token 里加字段
 * ---------------------------------------------------
 * 1. JWT 是不可撤销的（本仓已有明文结论：登出只是删客户端凭据）。把"当前租户"
 *    写进 JWT 意味着切换后旧 token 里的租户仍然是旧的，直到重新登录 —— 与
 *    「切换必须立即生效」直接冲突。
 * 2. 每次切换都重签 JWT 会把一个纯 UI 选择变成一次凭据轮换，得不偿失。
 * 3. cookie 是**每个请求都带、服务端可读、可随时改**的最小状态载体。
 *
 * 🔴 为什么它是"软"偏好（与本文件最重要的安全约定）
 * ------------------------------------------------
 * `?organizationId=` 查询参数是**硬选择器**：指定了就必须是成员，否则 403
 * （Batch 1 的 S12/S13 就是这条）。cookie 不同 —— 它是**用户自己的历史选择**，
 * 可能因为被移出该社群而失效。此时正确行为是**回落到默认租户**，
 * 而不是把用户永久挡在 Console 门外（那会因为一个陈旧的 cookie 造成事实上的
 * 账号锁死）。回落时**不写** `tenant.access_denied` 审计，否则被移出的人
 * 每刷一次页面就产生一条"有人在猜别家租户"的假安全事件。
 *
 * 一句话：**cookie 决定"看哪个"，memberships 决定"能不能看"**。
 */

import { cookies } from 'next/headers'

/** 活跃租户偏好的 cookie 名。带 `lf-` 前缀，与站内其它偏好（`lf-theme`）同族。 */
export const ACTIVE_ORG_COOKIE = 'lf-active-org'

/** 30 天。切换是一次低频的用户决策，没必要每次会话都重选。 */
export const ACTIVE_ORG_MAX_AGE = 60 * 60 * 24 * 30

/**
 * 规范化租户 id。**只做形状校验**，不做存在性/授权校验 ——
 * 后者属于 `resolveTenantForUser()` 的职责，本函数在它之前运行。
 *
 * 拒绝超长与非常规字符的理由：这个值会被原样塞进
 * `membership.findFirst({ where: { organizationId } })`，虽然 Prisma 是参数化的，
 * 但形状约束能让"被篡改的 cookie"在进入 DB 之前就变成 `null`（回落到默认租户），
 * 少一次无谓查询。
 */
export function normalizeActiveOrgId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v || v.length > 64) return null
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null
}

/** cookie 属性。`httpOnly`：前端不需要读它，只有服务端要；避免被 XSS 顺手改掉。 */
export function activeOrgCookieOptions(secure: boolean) {
  return {
    name: ACTIVE_ORG_COOKIE,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: ACTIVE_ORG_MAX_AGE,
  }
}

/**
 * 读当前请求的活跃租户偏好。
 *
 * ⚠️ `cookies()` 只能在请求作用域内调用（route handler / server component）。
 *    从脚本、单测或后台任务里调 `resolveActiveTenant()` 会抛
 *    「`cookies` was called outside a request scope」—— 这里吞掉并返回 `null`，
 *    让这些调用方自动退化成"默认租户"，而不是崩掉。
 */
export async function readActiveOrgId(): Promise<string | null> {
  try {
    const store = await cookies()
    return normalizeActiveOrgId(store.get(ACTIVE_ORG_COOKIE)?.value)
  } catch {
    return null
  }
}
