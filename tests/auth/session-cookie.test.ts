/**
 * 会话 cookie 命名规则的单测（V18-03）
 * ═══════════════════════════════════════════════════════════════════
 * 这些断言存在的理由不是"函数能跑"，而是把 2026-10-22 CI 那次
 * **「登录 200、之后全 401」** 的成因钉成一条不可能回归的规则：
 *
 *   站点协议 = http  ⇒  cookie 名必须是 `authjs.session-token` 且 `secure: false`
 *   站点协议 = https ⇒  cookie 名必须是 `__Secure-authjs.session-token` 且 `secure: true`
 *
 * 关键的一条是「NODE_ENV 不参与判定」。旧实现按 `NODE_ENV === 'production'`
 * 判，于是在 `next start`（production）**但站点是 http** 的环境里写出
 * `__Secure-…` cookie —— Auth.js 读的是 `authjs.…`，读不到 ⇒ 401；
 * 浏览器在 http 页面上还会直接丢弃该 cookie。
 */
import {
  SESSION_COOKIE,
  SECURE_SESSION_COOKIE,
  sessionCookieForRequest,
  sessionCookiePolicy,
} from '@/lib/auth/session-cookie'

describe('会话 cookie · 命名规则', () => {
  it('https ⇒ __Secure- 前缀 + secure:true', () => {
    expect(sessionCookiePolicy('https://app.lokfeel.com')).toEqual({
      name: SECURE_SESSION_COOKIE,
      secure: true,
    })
  })

  it('http ⇒ 无前缀 + secure:false（CI / 自托管 / 内网的形状）', () => {
    expect(sessionCookiePolicy('http://127.0.0.1:3000')).toEqual({
      name: SESSION_COOKIE,
      secure: false,
    })
  })

  it('名字与 secure 标记永远同向（不允许"安全名 + secure:false"这种半吊子组合）', () => {
    for (const origin of ['https://a.example', 'http://a.example', '', 'not a url', null]) {
      const p = sessionCookiePolicy(origin)
      expect(p.secure).toBe(p.name === SECURE_SESSION_COOKIE)
    }
  })

  it('解析不出 origin 时回落到非安全名（宁可少一层保护，也不要让浏览器直接丢 cookie）', () => {
    expect(sessionCookiePolicy('').name).toBe(SESSION_COOKIE)
    expect(sessionCookiePolicy(undefined).name).toBe(SESSION_COOKIE)
    expect(sessionCookiePolicy('file:///tmp/x').name).toBe(SESSION_COOKIE)
  })
})

describe('会话 cookie · 从请求推导（与 Auth.js 同源同判）', () => {
  it('AUTH_URL 是 https ⇒ 即使请求本身的 nextUrl 是 http，也按 https 处理', () => {
    const policy = sessionCookieForRequest(
      { url: 'http://127.0.0.1:3000/api/auth/login', nextUrl: { origin: 'http://127.0.0.1:3000' } },
      { AUTH_URL: 'https://app.lokfeel.com' },
    )
    expect(policy.name).toBe(SECURE_SESSION_COOKIE)
    expect(policy.secure).toBe(true)
  })

  it('没有任何配置 + http 请求 ⇒ 非安全名（这就是 CI 的环境）', () => {
    const policy = sessionCookieForRequest(
      { url: 'http://127.0.0.1:3000/api/auth/login', nextUrl: { origin: 'http://127.0.0.1:3000' } },
      {},
    )
    expect(policy.name).toBe(SESSION_COOKIE)
    expect(policy.secure).toBe(false)
  })

  it('NODE_ENV=production 不改变结论（旧实现正是栽在这一条）', () => {
    // 用一次别名改写而不是 @ts-expect-error：后者会进 lint 棘轮基线，
    // 且"这里确实需要一个可写视图"是可以在类型上表达清楚的事。
    const env = process.env as Record<string, string | undefined>
    const prev = env.NODE_ENV
    try {
      env.NODE_ENV = 'production'
      const policy = sessionCookieForRequest(
        { url: 'http://127.0.0.1:3000/login', nextUrl: { origin: 'http://127.0.0.1:3000' } },
        {},
      )
      expect(policy.name).toBe(SESSION_COOKIE)
      expect(policy.secure).toBe(false)
    } finally {
      env.NODE_ENV = prev
    }
  })

  it('NEXT_PUBLIC_APP_URL 的优先级高于 AUTH_URL（两个都配了也不打架）', () => {
    const policy = sessionCookieForRequest(
      { url: 'http://127.0.0.1:3000/' },
      { NEXT_PUBLIC_APP_URL: 'https://app.lokfeel.com', AUTH_URL: 'http://127.0.0.1:3000' },
    )
    expect(policy.name).toBe(SECURE_SESSION_COOKIE)
  })
})
