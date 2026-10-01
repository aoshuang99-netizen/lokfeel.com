/**
 * 请求的「公开 origin」解析器
 *
 * ⚠️ WHY THIS FILE EXISTS（实测结论，勿删）
 *
 * 在托管平台上，route handler 里的 `request.url` / `request.nextUrl` **不保证**是
 * 访客使用的公开地址。2026-10-01 在生产（Netlify）实测到一段**刚发布后的窗口期**：
 *
 *   14:14:08  部署 6abe6a55 发布
 *   14:15     POST /api/auth/login（Origin: https://app.lokfeel.com）→ 403 全部被拒
 *   14:18     GET  /api/auth/oauth/google/callback
 *               → Location: https://6abe6a55…--lokfeel.netlify.app/login?error=…   ← 泄漏
 *   14:35     同两个请求
 *               → Location: https://app.lokfeel.com/login?error=…                    ← 恢复正常
 *
 * 即：边缘域名别名完成传播之前，`request.url`（连 `nextUrl`）会解析到**部署专用域名**
 * `<deploy-id>--<site>.netlify.app`。代价有两个，且都是用户可见的：
 *   1. `new URL(dest, request.url)` 把用户重定向到内部域名 —— 会话 cookie 是 host-only、
 *      存在公开域名下，跳过去浏览器不带 cookie → 用户「刚登录成功又变回未登录」，
 *      同时内部部署地址被泄漏。
 *   2. 任何拿 `nextUrl.host` 与 `Origin` 做同源比较的守卫（如 /api/auth/login 的 CSRF 检查）
 *      会在这段时间里**拒绝所有真实登录**。
 *
 * 因此：**所有对外绝对跳转**都必须经 `publicOriginOf()` 构造，**同源判定**则用
 * `resolveSiteHosts()`（见下方），两者都不再依赖 `request.url` 的 host。
 *
 * 注意：OAuth 的 `redirect_uri` 本来就用 `request.nextUrl.origin`，实测正常时是正确的，
 * 但同样走本函数以免依赖平台差异。
 *
 * 解析优先级（先到先用，第一个能解析成合法 http(s) origin 的胜出）：
 *   1. NEXT_PUBLIC_APP_URL   —— 部署方显式配置的规范地址
 *   2. AUTH_URL              —— NextAuth v5 约定
 *   3. NEXTAUTH_URL          —— NextAuth v4 约定
 *   4. request.nextUrl.origin —— 框架归一化后的 origin（实测最可靠）
 *   5. request.url 的 origin  —— 最后兜底
 *
 * 刻意**不读** X-Forwarded-Host 等请求头：这些头可被请求方伪造，
 * 用来构造跳转目标等于开一个开放重定向口子。配置与环境已足够覆盖自托管场景。
 */

/** 只要 http/https；返回 `scheme://host[:port]`，失败返回空串 */
export function normalizeOrigin(value?: string | null): string {
  if (!value) return ''
  try {
    const url = new URL(String(value).trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    if (!url.host) return ''
    return `${url.protocol}//${url.host}`
  } catch {
    return ''
  }
}

export interface ResolvePublicOriginInput {
  /** 环境变量快照（便于测试注入） */
  env?: Record<string, string | undefined>
  /** `request.nextUrl?.origin` */
  nextUrlOrigin?: string | null
  /** `request.url`（平台内部地址，仅作兜底） */
  requestUrl?: string | null
}

const CONFIGURED_ORIGIN_KEYS = ['NEXT_PUBLIC_APP_URL', 'AUTH_URL', 'NEXTAUTH_URL'] as const
const CONFIGURED_ORIGIN_ENV_KEYS = CONFIGURED_ORIGIN_KEYS as readonly string[]

export function resolvePublicOrigin(input: ResolvePublicOriginInput = {}): string {
  const env = input.env ?? (process.env as Record<string, string | undefined>)

  for (const key of CONFIGURED_ORIGIN_ENV_KEYS) {
    const origin = normalizeOrigin(env[key])
    if (origin) return origin
  }

  const fromNextUrl = normalizeOrigin(input.nextUrlOrigin)
  if (fromNextUrl) return fromNextUrl

  return normalizeOrigin(input.requestUrl)
}

/**
 * 同源判定用的「可接受站点 host」集合。
 *
 * 与 `publicOriginOf` 的职责刻意分开：本函数只产出**用于比较**的 host 列表，
 * 绝不用于构造跳转目标，因此可以纳入请求头来源的 host（Host / X-Forwarded-Host）。
 * 反过来 `publicOriginOf` 只认配置与框架值，不读请求头，避免被伪造头牵引跳转。
 *
 * 为什么要纳入多个来源：发布窗口期内 `nextUrl.host` 会是部署专用域名，
 * 只拿它比对会让真实登录全部 403。只要任一来来源命中真实域名即视为同源。
 *
 * 安全性：浏览器无法在跨站请求里设置 Host / X-Forwarded-Host（二者属禁止头），
 * 且正常代理会覆写它们；因此这里纳入它们不会给浏览器侧 CSRF 提供绕道。
 */
export function resolveSiteHosts(
  input: {
    host?: string | null
    forwardedHost?: string | null
    nextUrlOrigin?: string | null
    configuredOrigins?: (string | null | undefined)[]
  },
  env?: Record<string, string | undefined>,
): string[] {
  const envVars = env ?? (process.env as Record<string, string | undefined>)
  const configured = input.configuredOrigins ?? CONFIGURED_ORIGIN_ENV_KEYS.map((k) => envVars[k])

  const hosts = [input.host, input.forwardedHost, input.nextUrlOrigin, ...configured]
    .flatMap((candidate) => String(candidate ?? '').split(','))
    .map((candidate) => hostOf(candidate))
    .filter(Boolean)

  return [...new Set(hosts)]
}

/** 取 `Origin` / `Referer` 的 host（小写）。无法解析时返回空串。 */
export function claimedHost(value?: string | null): string {
  // Origin: "null"（沙箱 iframe、部分重定向）必须判为不匹配
  if (!value || String(value).trim().toLowerCase() === 'null') return ''
  return hostOf(String(value).trim())
}

/** 请求声明的来源是否命中允许的站点 host */
export function isSameSiteRequest(
  claimedOriginOrReferer: string | null | undefined,
  allowedHosts: readonly string[],
): boolean {
  const claimed = claimedHost(claimedOriginOrReferer)
  if (!claimed) return false
  return allowedHosts.includes(claimed)
}

/**
 * 从「完整 URL」或「裸 host[:port]」里取出小写 host。
 * 必须同时支持两种形态：Host / X-Forwarded-Host 是裸 host，
 * Origin / Referer / 配置项是完整 URL。
 */
function hostOf(value?: string | null): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).host.toLowerCase()
    } catch {
      return ''
    }
  }
  // 裸 host：仅允许 host 字符与可选端口，避免 "not a url" / "evil.com/path" 蒙混过关
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(raw)) return ''
  // 去掉默认端口：浏览器发的 Origin 不带 :443，而 Host 头可能带 —— 不去掉会判为不同源
  return raw.toLowerCase().replace(/:(443|80)$/, '')
}

/** 直接吃一个 NextRequest（或任何有 url / nextUrl 的对象） */
export function publicOriginOf(
  request: { url?: string | null; nextUrl?: { origin?: string | null } | null },
  env?: Record<string, string | undefined>,
): string {
  return resolvePublicOrigin({
    env,
    nextUrlOrigin: request.nextUrl?.origin ?? null,
    requestUrl: request.url ?? null,
  })
}

/**
 * 把相对目标拼到公开 origin 上；已经是绝对 URL 的目标原样返回。
 * 传入空 origin 时退化为相对路径（浏览器会按当前域名解析，仍是安全的）。
 */
export function absoluteUrlFor(origin: string, target: string): string {
  if (!origin) return target
  try {
    return new URL(target, origin).toString()
  } catch {
    return target
  }
}
