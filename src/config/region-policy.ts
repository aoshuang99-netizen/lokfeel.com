/**
 * 地域 / CORS / 缓存策略 —— **单一配置源**（P0-6）
 *
 * 为什么要有这个文件：
 *   `proxy.ts` 原先把地域规则**硬编码**在中间件里 —— 一个空的
 *   `BLOCKED_COUNTRIES` 数组、一个**从未被读取**的 `IP_WHITELIST`（死代码）、
 *   一份写死的 origin 白名单。开源（open-core）之后，"哪些地区可访问"
 *   是**部署方的决定**，不该是源码里的常量 —— 否则每个部署方都要 fork 中间件。
 *
 * 设计约束：
 *   1. **边界安全**：本模块被 Edge 中间件导入，禁止使用任何 Node.js API。
 *   2. **默认值 = 旧行为**：不设任何 env 时，行为与改造前**逐条等价**
 *      （不封禁任何地区、origin 白名单同旧值）。配置驱动的改造不该顺带改变线上行为。
 *   3. **可测试**：决策逻辑是纯函数（`evaluateRegion` 等），env 解析单独一层
 *      （`resolveRegionPolicy`），因此 `scripts/verify-region-policy.ts`
 *      可以构造任意策略做矩阵验证，不依赖真实环境变量。
 *
 * ⚠️ 关于"重新启用地域封禁"的一处**真实修复**：
 *   旧代码的注释写着「Re-enable with ['CN'] ONLY after wiring IP_WHITELIST
 *   into the check below (it is currently dead code)」—— 也就是说旧实现里
 *   白名单**根本没有参与判定**。若有人照着注释把 `['CN']` 填回去，
 *   白名单里的人（包括站长本人）会被一起挡在门外。
 *   本模块把白名单接进判定链，并按"IP 优先于国家"的顺序短路。
 */

// ─────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────

export type UnknownCountryPolicy = 'allow' | 'block'

export interface RegionPolicy {
  /** 被封禁的国家码（ISO-3166 alpha-2，大写）。空数组 = 不启用地域封禁 */
  blockedCountries: string[]
  /** 允许的国家码（白名单模式）。非空时**优先于** blockedCountries */
  allowedCountries: string[]
  /** 免检 IP（精确匹配，或以 `*` 结尾做前缀匹配，如 `203.0.113.*`） */
  ipWhitelist: string[]
  /** 地域封禁时，API 路由返回 451 JSON 而非 302 跳转（旧行为 = true） */
  apiReturns451: boolean
  /** 取不到国家码时（如自托管无 geo 头）如何处理 */
  unknownCountry: UnknownCountryPolicy
  /** 非封禁地区也始终放行的路径（含子路径） */
  allowedPaths: string[]
  /** 调试/诊断端点（要求 DEBUG_SECRET，且拒绝浏览器 UA） */
  debugPaths: string[]
  /** CORS 允许的 origin（精确匹配） */
  corsAllowedOrigins: string[]
  /** 是否额外放行 localhost / 127.0.0.1 */
  corsAllowLocalhost: boolean
  /** 预览环境 origin 的正则（字符串形式；空字符串 = 关闭） */
  corsPreviewOriginPattern: string
}

export interface RegionDecision {
  /** allow = 放行；redirect-blocked = 跳 /blocked；json-451 = API 返回 451 */
  action: 'allow' | 'redirect-blocked' | 'json-451'
  /** 便于排障与断言：命中的判据 */
  reason:
    | 'region-policy-off'
    | 'api-route'
    | 'allowed-path'
    | 'ip-whitelisted'
    | 'country-not-blocked'
    | 'unknown-country-allowed'
    | 'unknown-country-blocked'
    | 'blocked'
    | 'not-in-allowlist'
}

export interface RegionDecisionInput {
  country: string
  clientIp: string
  pathname: string
}

// ─────────────────────────────────────────────────────────────
// 默认值（= 改造前的线上行为）
// ─────────────────────────────────────────────────────────────

/**
 * 旧 `proxy.ts` 的 `ALLOWED_PATHS`。
 * `/blocked` 需**精确匹配**（否则 `/blocked-foo` 也会被放行），故单独处理。
 */
export const DEFAULT_ALLOWED_PATHS = [
  '/blocked',
  '/api/geo-check',
  '/api/health',
  '/_next/',
  '/favicon',
]

export const DEFAULT_DEBUG_PATHS = [
  '/api/debug-auth',
  '/api/db-check',
  '/api/diagnostic/',
]

export const DEFAULT_CORS_ORIGINS = [
  'https://app.lokfeel.com',
  'https://lokfeel.com',
  'https://admin.lokfeel.com',
]

export const DEFAULT_PREVIEW_ORIGIN_PATTERN = '^https://nexus-app-.*\\.vercel\\.app$'

/** 安全响应头（所有响应都带）。抽出来是为了白标/多租户可覆盖。 */
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
}

// ─────────────────────────────────────────────────────────────
// env 解析
// ─────────────────────────────────────────────────────────────

type EnvLike = Record<string, string | undefined>

function parseList(raw: string | undefined, fallback: string[] = []): string[] {
  if (raw === undefined) return fallback
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return items
}

function parseCountries(raw: string | undefined): string[] {
  return parseList(raw).map((c) => c.toUpperCase())
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback
  return !/^(0|false|no|off)$/i.test(raw.trim())
}

/**
 * 把环境变量解析成策略对象。**不读全局**，`env` 由调用方传入 —— 便于测试。
 */
export function resolveRegionPolicy(env: EnvLike): RegionPolicy {
  return {
    blockedCountries: parseCountries(env.GEO_BLOCKED_COUNTRIES),
    allowedCountries: parseCountries(env.GEO_ALLOWED_COUNTRIES),
    ipWhitelist: parseList(env.GEO_IP_WHITELIST),
    apiReturns451: parseBool(env.GEO_API_RETURNS_451, true),
    unknownCountry: env.GEO_UNKNOWN_COUNTRY === 'block' ? 'block' : 'allow',
    allowedPaths: parseList(env.GEO_ALLOWED_PATHS, DEFAULT_ALLOWED_PATHS),
    debugPaths: DEFAULT_DEBUG_PATHS,
    corsAllowedOrigins: parseList(env.CORS_ALLOWED_ORIGINS, DEFAULT_CORS_ORIGINS),
    corsAllowLocalhost: parseBool(env.CORS_ALLOW_LOCALHOST, true),
    corsPreviewOriginPattern:
      env.CORS_PREVIEW_ORIGIN_PATTERN === undefined
        ? DEFAULT_PREVIEW_ORIGIN_PATTERN
        : env.CORS_PREVIEW_ORIGIN_PATTERN,
  }
}

/**
 * 模块级默认策略。Edge 中间件用这一个。
 * 注意：Next.js 会在构建期把 `process.env.X` 内联到 edge bundle，
 * 因此这里按模块加载求值是安全的。
 */
export const REGION_POLICY: RegionPolicy = resolveRegionPolicy(process.env)

// ─────────────────────────────────────────────────────────────
// 判定（纯函数）
// ─────────────────────────────────────────────────────────────

/** 地域封禁是否启用 */
export function isRegionBlockEnabled(policy: RegionPolicy): boolean {
  return policy.blockedCountries.length > 0 || policy.allowedCountries.length > 0
}

/**
 * 路径是否**始终放行**（连被封禁地区也可访问）。
 * `/blocked` 精确匹配；其余按前缀匹配。
 */
export function isAllowedPath(pathname: string, policy: RegionPolicy = REGION_POLICY): boolean {
  for (const p of policy.allowedPaths) {
    if (p === '/blocked') {
      if (pathname === '/blocked') return true
      continue
    }
    if (pathname.startsWith(p)) return true
  }
  return false
}

/** 调试端点判定 */
export function isDebugPath(pathname: string, policy: RegionPolicy = REGION_POLICY): boolean {
  return policy.debugPaths.some((p) => pathname.startsWith(p))
}

/**
 * IP 是否在白名单内。支持精确匹配与 `前缀*`（如 `203.0.113.*`）。
 * 空 IP（取不到）永不视为命中 —— 否则"取不到 IP"会变成免检后门。
 */
export function isIpWhitelisted(ip: string, policy: RegionPolicy = REGION_POLICY): boolean {
  if (!ip) return false
  return policy.ipWhitelist.some((entry) => {
    if (!entry) return false
    if (entry.endsWith('*')) return ip.startsWith(entry.slice(0, -1))
    return ip === entry
  })
}

/**
 * 地域判定 —— 本模块的核心。
 *
 * 判定顺序（短路）：策略未启用 → API 路由 → 始终放行路径 → IP 白名单
 *                  → 允许名单 → 封禁名单 → 未知国家
 *
 * 为什么 IP 白名单要排在**国家判定之前**：
 *   封禁是按地区生效的粗粒度规则，白名单是运营者的自救通道。
 *   如果排在后面，被封地区的运营者连自己的后台都进不去（只能删配置重部署）。
 */
export function evaluateRegion(
  input: RegionDecisionInput,
  policy: RegionPolicy = REGION_POLICY,
): RegionDecision {
  const { country, clientIp, pathname } = input
  const isApiRoute = pathname.startsWith('/api')

  if (!isRegionBlockEnabled(policy)) {
    return { action: 'allow', reason: 'region-policy-off' }
  }
  if (isAllowedPath(pathname, policy)) {
    return { action: 'allow', reason: 'allowed-path' }
  }
  if (isIpWhitelisted(clientIp, policy)) {
    return { action: 'allow', reason: 'ip-whitelisted' }
  }

  const normalized = (country || '').toUpperCase()

  // 允许名单模式优先于封禁名单（同时配置时以更严格的为准，并会由 warnings 提示）
  if (policy.allowedCountries.length > 0) {
    if (!normalized) {
      return policy.unknownCountry === 'block'
        ? {
            action: isApiRoute && policy.apiReturns451 ? 'json-451' : 'redirect-blocked',
            reason: 'unknown-country-blocked',
          }
        : { action: 'allow', reason: 'unknown-country-allowed' }
    }
    return policy.allowedCountries.includes(normalized)
      ? { action: 'allow', reason: 'country-not-blocked' }
      : { action: isApiRoute && policy.apiReturns451 ? 'json-451' : 'redirect-blocked', reason: 'not-in-allowlist' }
  }

  if (!normalized) {
    // 取不到国家码：默认放行（自托管环境常常没有 geo 头），可用 GEO_UNKNOWN_COUNTRY=block 改成拒绝
    return policy.unknownCountry === 'block'
      ? {
          action: isApiRoute && policy.apiReturns451 ? 'json-451' : 'redirect-blocked',
          reason: 'unknown-country-blocked',
        }
      : { action: 'allow', reason: 'unknown-country-allowed' }
  }

  const blocked = policy.blockedCountries.includes(normalized)
  if (!blocked) return { action: 'allow', reason: 'country-not-blocked' }

  // 封禁命中：API 返回 451 JSON（旧行为），页面跳 /blocked
  if (isApiRoute && policy.apiReturns451) return { action: 'json-451', reason: 'blocked' }
  return { action: 'redirect-blocked', reason: 'blocked' }
}

/** 从请求头取国家码（与旧实现一致：Vercel → Cloudflare → 放弃） */
export function getCountryFromHeaders(headers: {
  get(name: string): string | null
}): string {
  const vercelCountry = headers.get('x-vercel-ip-country')
  if (vercelCountry && vercelCountry !== 'unknown') return vercelCountry

  const cfCountry = headers.get('cf-ipcountry')
  if (cfCountry && cfCountry !== 'XX') return cfCountry

  return ''
}

// ─────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────

export function isLocalhostOrigin(origin: string): boolean {
  return /^https?:\/\/localhost(:\d+)?$/.test(origin) || origin.startsWith('http://127.0.0.1')
}

export function isPreviewOrigin(origin: string, policy: RegionPolicy = REGION_POLICY): boolean {
  if (!policy.corsPreviewOriginPattern) return false
  try {
    return new RegExp(policy.corsPreviewOriginPattern).test(origin)
  } catch {
    // 正则写错不应让整站 403 —— 视为不匹配，并由 describeRegionPolicy 输出告警
    return false
  }
}

/** origin 是否被允许（同源 / 精确白名单 / localhost / 预览环境） */
export function isCorsAllowed(
  origin: string | null,
  requestHost: string,
  policy: RegionPolicy = REGION_POLICY,
): boolean {
  if (!origin) return true // 无 Origin 头（同源导航、服务端调用）
  if (policy.corsAllowedOrigins.includes(origin)) return true
  if (requestHost) {
    try {
      if (new URL(origin).host === requestHost) return true
    } catch {
      return false
    }
  }
  if (policy.corsAllowLocalhost && isLocalhostOrigin(origin)) return true
  if (isPreviewOrigin(origin, policy)) return true
  return false
}

// ─────────────────────────────────────────────────────────────
// 缓存策略
// ─────────────────────────────────────────────────────────────

const CACHE_LONG = 'public, s-maxage=7200, stale-while-revalidate=86400'
const CACHE_SHORT = 'public, s-maxage=300, stale-while-revalidate=86400'
const CACHE_HOURLY = 'public, s-maxage=3600, stale-while-revalidate=86400'

/** 公开页面的 CDN 缓存头（旧实现里逐条写死在 proxy.ts 中） */
export function getCacheControl(pathname: string): string | null {
  if (pathname === '/' || pathname === '/login' || pathname === '/register') return CACHE_SHORT
  if (pathname === '/sitemap.xml' || pathname === '/robots.txt') return CACHE_HOURLY
  const staticLegal = [
    '/terms',
    '/privacy',
    '/about',
    '/faq',
    '/contact',
    '/community-guidelines',
    '/safety-tips',
    '/cookies',
    '/dmca',
    '/18-usc-2257',
    '/cancellations-policy',
    '/refunds',
    '/press',
    '/careers',
    '/support',
  ]
  if (staticLegal.includes(pathname)) return CACHE_LONG
  return null
}

// ─────────────────────────────────────────────────────────────
// 可观测性
// ─────────────────────────────────────────────────────────────

/**
 * 人类可读的策略摘要 + 配置告警。
 * 由 `scripts/verify-region-policy.ts` 与运维排障使用。
 */
export function describeRegionPolicy(policy: RegionPolicy = REGION_POLICY): {
  summary: Record<string, unknown>
  warnings: string[]
} {
  const warnings: string[] = []

  if (policy.blockedCountries.length > 0 && policy.allowedCountries.length > 0) {
    warnings.push(
      '同时配置了 GEO_BLOCKED_COUNTRIES 与 GEO_ALLOWED_COUNTRIES：已按更严格的"允许名单"生效，封禁名单被忽略。',
    )
  }
  if (isRegionBlockEnabled(policy) && policy.ipWhitelist.length === 0) {
    warnings.push(
      '已启用地域封禁但 GEO_IP_WHITELIST 为空：若运营者本人位于被封地区，将无法进入后台（只能改配置重部署）。',
    )
  }
  if (isRegionBlockEnabled(policy) && policy.blockedCountries.length > 0) {
    warnings.push(
      '全域国家封禁属于**合规决策**，上线前需做法务复核（旧 proxy.ts 的注释即为此提醒）。',
    )
  }
  if (policy.corsPreviewOriginPattern && !safeRegExp(policy.corsPreviewOriginPattern)) {
    warnings.push('CORS_PREVIEW_ORIGIN_PATTERN 不是合法正则，预览环境将一律不放行。')
  }
  if (policy.corsAllowedOrigins.length === 0 && !policy.corsAllowLocalhost) {
    warnings.push('CORS 白名单为空且未放行 localhost：跨域调用会被全部拒绝（仅同源可用）。')
  }

  return {
    summary: {
      regionBlockEnabled: isRegionBlockEnabled(policy),
      mode:
        policy.allowedCountries.length > 0
          ? 'allowlist'
          : policy.blockedCountries.length > 0
            ? 'blocklist'
            : 'off',
      blockedCountries: policy.blockedCountries,
      allowedCountries: policy.allowedCountries,
      ipWhitelist: policy.ipWhitelist,
      unknownCountry: policy.unknownCountry,
      apiReturns451: policy.apiReturns451,
      corsAllowedOrigins: policy.corsAllowedOrigins,
      corsAllowLocalhost: policy.corsAllowLocalhost,
      corsPreviewOriginPattern: policy.corsPreviewOriginPattern,
      allowedPaths: policy.allowedPaths,
    },
    warnings,
  }
}

function safeRegExp(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}
