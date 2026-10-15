/**
 * 示例的配置解析 —— **本仓库不包含任何凭据**。
 *
 * ── 三种凭据来源，按优先级 ──────────────────────────────────────
 *   ① `LOKFEEL_COOKIE`            —— 直接给会话 Cookie 头值（CI / 已登录的浏览器里复制）
 *   ② `LOKFEEL_LOGIN_EMAIL` + `LOKFEEL_LOGIN_PASSWORD`
 *                                 —— 示例**自己**走 `/api/auth/login` 换 cookie
 *   ③ 都没有                      —— 匿名（只有"发现面"示例能这么跑）
 *
 * 需要凭据的示例在 ①②③ 全缺时**立即退出并打印用法**，绝不退化成一个
 * "拿匿名身份跑完、看起来也通过"的假绿示例 —— 那种示例比没有示例更危险，
 * 因为它会让人以为"授权链路验过了"。
 *
 * 🔴 本服务**没有** `Authorization: Bearer` 入口（身份来自 NextAuth 会话 cookie），
 *    所以这里不提供 `LOKFEEL_TOKEN`。凭据的唯一两种取得方式就是上面 ① ②。
 */

import { LokFeelClient } from './lokfeel-client'

export type CredentialSource = 'env-cookie' | 'login' | 'anonymous'

export type Session = {
  client: LokFeelClient
  baseUrl: string
  source: CredentialSource
}

/** 只解析 baseUrl（用于"完全匿名"的示例，它们不该被环境里的 cookie 影响）。 */
export function resolveBaseUrl(): string {
  return (process.env.LOKFEEL_BASE_URL ?? 'http://localhost:3099').replace(/\/+$/, '')
}

function printUsage(): void {
  console.error(
    [
      '✗ 需要凭据：请提供会话 Cookie，或提供账号让示例自行登录。',
      '',
      '  方式①（推荐给 CI / 脚本）',
      '    LOKFEEL_BASE_URL=https://app.lokfeel.com \\',
      '    LOKFEEL_COOKIE="$COOKIE_FROM_BROWSER" \\',
      '      npx tsx examples/sdk/demo-mcp.ts',
      '',
      '    （浏览器 → DevTools → Network → 任一 /api 请求 → Request Headers → Cookie）',
      '',
      '  方式②（推荐给本地开发）',
      '    LOKFEEL_BASE_URL=http://localhost:3099 \\',
      '    LOKFEEL_LOGIN_EMAIL=you@example.com \\',
      '    LOKFEEL_LOGIN_PASSWORD=… \\',
      '      npx tsx examples/sdk/demo-mcp.ts',
      '',
      '说明：',
      '  · LOKFEEL_BASE_URL 省略时默认 http://localhost:3099（`npm run dev` 的端口）。',
      '  · 凭据请从本地密钥环 / CI secret 注入；**不要**提交进仓库。',
      '  · 只想看"发现面"（工具清单、agent card）请用 demo-discovery.ts，它无需凭据。',
      '  · ⚠️ 本服务没有 Bearer 令牌入口 —— 身份是 NextAuth 会话 cookie（见 lokfeel-client.ts 文件头）。',
    ].join('\n'),
  )
}

/**
 * 建一个客户端。`requireCredential: true` 时缺凭据即退出（不静默降级为匿名）。
 */
export async function createClient(opts: { requireCredential: boolean }): Promise<Session> {
  const baseUrl = resolveBaseUrl()

  const envCookie = process.env.LOKFEEL_COOKIE?.trim()
  if (envCookie) {
    return { client: new LokFeelClient({ baseUrl, cookie: envCookie }), baseUrl, source: 'env-cookie' }
  }

  const email = process.env.LOKFEEL_LOGIN_EMAIL?.trim()
  const password = process.env.LOKFEEL_LOGIN_PASSWORD
  if (email && password) {
    const client = new LokFeelClient({ baseUrl })
    await client.login(email, password)
    return { client, baseUrl, source: 'login' }
  }

  if (opts.requireCredential) {
    printUsage()
    process.exit(1)
  }
  return { client: new LokFeelClient({ baseUrl }), baseUrl, source: 'anonymous' }
}
