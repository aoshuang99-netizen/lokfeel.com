/**
 * P0-6 校验：地域 / CORS / 缓存策略配置化
 *
 * 为什么需要它：
 *   把硬编码改成配置驱动，最容易犯的错是"默认值变了"或"某个分支判反了"——
 *   而这类错误在线上表现为"某些地区整站打不开"，且只在特定 header 组合下出现。
 *   所以这里用**矩阵断言**覆盖：封禁/允许名单/未知国家/IP 白名单/API 与页面、
 *   CORS 四种来源、缓存三档，再加一条**反回归守卫**（proxy.ts 里不得再出现硬编码）。
 *
 * 无框架依赖（与 scripts/verify-plans.ts 同一模式），可随时运行：
 *   npx tsx scripts/verify-region-policy.ts
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_CORS_ORIGINS,
  describeRegionPolicy,
  evaluateRegion,
  getCacheControl,
  getCountryFromHeaders,
  isAllowedPath,
  isCorsAllowed,
  isDebugPath,
  isIpWhitelisted,
  isRegionBlockEnabled,
  resolveRegionPolicy,
  type RegionPolicy,
} from '../src/config/region-policy'

const REPO_ROOT = path.resolve(__dirname, '..')

let passed = 0
const failures: string[] = []

function ok(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(`${name}${detail ? ` —— ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

function section(title: string): void {
  console.log(`\n${title}`)
}

/** 造一个策略：默认值 + 覆盖项 */
function policy(env: Record<string, string | undefined> = {}): RegionPolicy {
  return resolveRegionPolicy(env)
}

// ═══════════════════════════════════════════════════════════
section('1. 默认值必须等于改造前的线上行为')
// ═══════════════════════════════════════════════════════════

const dflt = policy({})
ok('默认不启用地域封禁（旧 BLOCKED_COUNTRIES = []）', !isRegionBlockEnabled(dflt))
ok(
  '默认下 CN 页面放行',
  evaluateRegion({ country: 'CN', clientIp: '1.2.3.4', pathname: '/' }, dflt).action === 'allow',
)
ok(
  '默认下 CN 的 API 放行',
  evaluateRegion({ country: 'CN', clientIp: '1.2.3.4', pathname: '/api/health' }, dflt).action ===
    'allow',
)
ok(
  '默认 CORS 白名单 = 三个正式域名',
  dflt.corsAllowedOrigins.join(',') === DEFAULT_CORS_ORIGINS.join(','),
  dflt.corsAllowedOrigins.join(','),
)
ok('默认可返回 451 的开关为 true', dflt.apiReturns451 === true)
ok('默认放行路径含 /blocked 与 /_next/', isAllowedPath('/_next/static/x.js', dflt))
ok('默认 /blocked 精确匹配（/blocked-foo 不放行）', isAllowedPath('/blocked', dflt) && !isAllowedPath('/blocked-foo', dflt))

const dfltDesc = describeRegionPolicy(dflt)
ok('默认策略无告警', dfltDesc.warnings.length === 0, dfltDesc.warnings.join(' | '))
ok('默认模式为 off', dfltDesc.summary.mode === 'off', String(dfltDesc.summary.mode))

// ═══════════════════════════════════════════════════════════
section('2. 封禁名单模式（GEO_BLOCKED_COUNTRIES）')
// ═══════════════════════════════════════════════════════════

const blk = policy({ GEO_BLOCKED_COUNTRIES: 'CN, ru ' })
ok('国家码被大写并去空白', blk.blockedCountries.join(',') === 'CN,RU', blk.blockedCountries.join(','))
ok('封禁地区页面 → 跳 /blocked', evaluateRegion({ country: 'CN', clientIp: '1.2.3.4', pathname: '/dashboard' }, blk).action === 'redirect-blocked')
ok('封禁地区 API → 451 JSON（不跳 HTML）', evaluateRegion({ country: 'CN', clientIp: '1.2.3.4', pathname: '/api/im/send' }, blk).action === 'json-451')
ok('未封禁地区正常放行', evaluateRegion({ country: 'US', clientIp: '1.2.3.4', pathname: '/dashboard' }, blk).action === 'allow')
ok('封禁地区仍可访问 /blocked 页面（避免重定向环）', evaluateRegion({ country: 'CN', clientIp: '1.2.3.4', pathname: '/blocked' }, blk).action === 'allow')
ok('封禁地区仍可访问 /api/health', evaluateRegion({ country: 'CN', clientIp: '1.2.3.4', pathname: '/api/health' }, blk).action === 'allow')
ok('小写 country 头也能命中（大小写不敏感）', evaluateRegion({ country: 'cn', clientIp: '1.2.3.4', pathname: '/dashboard' }, blk).action === 'redirect-blocked')

// ═══════════════════════════════════════════════════════════
section('3. IP 白名单（本次修复的核心：旧实现里它是死代码）')
// ═══════════════════════════════════════════════════════════

const wl = policy({ GEO_BLOCKED_COUNTRIES: 'CN', GEO_IP_WHITELIST: '203.0.113.7,198.51.100.*' })
ok('精确匹配命中', isIpWhitelisted('203.0.113.7', wl))
ok('前缀通配命中', isIpWhitelisted('198.51.100.42', wl))
ok('不在名单不命中', !isIpWhitelisted('203.0.113.8', wl))
ok('空 IP **不**视为命中（否则成免检后门）', !isIpWhitelisted('', wl))
ok(
  '被封地区 + 白名单 IP → 放行（旧实现会被一起挡在门外）',
  evaluateRegion({ country: 'CN', clientIp: '203.0.113.7', pathname: '/dashboard' }, wl).action === 'allow',
)
ok(
  '白名单命中理由可诊断',
  evaluateRegion({ country: 'CN', clientIp: '203.0.113.7', pathname: '/dashboard' }, wl).reason ===
    'ip-whitelisted',
)
ok('IP 白名单优先于国家封禁（顺序正确）', evaluateRegion({ country: 'CN', clientIp: '198.51.100.9', pathname: '/api/im/send' }, wl).action === 'allow')
ok('非白名单 IP 仍被封禁', evaluateRegion({ country: 'CN', clientIp: '203.0.113.8', pathname: '/api/im/send' }, wl).action === 'json-451')

// ═══════════════════════════════════════════════════════════
section('4. 允许名单模式（GEO_ALLOWED_COUNTRIES）与未知国家')
// ═══════════════════════════════════════════════════════════

const al = policy({ GEO_ALLOWED_COUNTRIES: 'US,DE' })
ok('allowlist 模式生效', describeRegionPolicy(al).summary.mode === 'allowlist')
ok('在名单内放行', evaluateRegion({ country: 'DE', clientIp: '1.1.1.1', pathname: '/' }, al).action === 'allow')
ok('不在名单内 → 页面跳转', evaluateRegion({ country: 'CN', clientIp: '1.1.1.1', pathname: '/' }, al).action === 'redirect-blocked')
ok('不在名单内 → API 451', evaluateRegion({ country: 'CN', clientIp: '1.1.1.1', pathname: '/api/x' }, al).action === 'json-451')
ok('未知国家默认放行（自托管常无 geo 头）', evaluateRegion({ country: '', clientIp: '1.1.1.1', pathname: '/' }, al).action === 'allow')

const alStrict = policy({ GEO_ALLOWED_COUNTRIES: 'US', GEO_UNKNOWN_COUNTRY: 'block' })
ok('GEO_UNKNOWN_COUNTRY=block 时未知国家被拒', evaluateRegion({ country: '', clientIp: '1.1.1.1', pathname: '/' }, alStrict).action === 'redirect-blocked')

const both = policy({ GEO_BLOCKED_COUNTRIES: 'CN', GEO_ALLOWED_COUNTRIES: 'US' })
ok('两名单同时配置 → 允许名单优先（更严格）', evaluateRegion({ country: 'CN', clientIp: '1.1.1.1', pathname: '/' }, both).action === 'redirect-blocked')
ok(
  '两名单同时配置会给出告警',
  describeRegionPolicy(both).warnings.some((w) => w.includes('允许名单')),
)
ok(
  '启用封禁但白名单为空时给出告警',
  describeRegionPolicy(blk).warnings.some((w) => w.includes('GEO_IP_WHITELIST')),
)

// ═══════════════════════════════════════════════════════════
section('5. CORS')
// ═══════════════════════════════════════════════════════════

const corsPolicy = policy({})
ok('无 Origin 头（同源/服务端）放行', isCorsAllowed(null, 'app.lokfeel.com', corsPolicy))
ok('白名单 origin 放行', isCorsAllowed('https://app.lokfeel.com', 'app.lokfeel.com', corsPolicy))
ok('同源（Origin.host === requestHost）放行', isCorsAllowed('https://whatever.example', 'whatever.example', corsPolicy))
ok('陌生 origin 拒绝', !isCorsAllowed('https://evil.example', 'app.lokfeel.com', corsPolicy))
ok('畸形 origin 拒绝', !isCorsAllowed('not-a-url', 'app.lokfeel.com', corsPolicy))
ok('localhost 默认放行', isCorsAllowed('http://localhost:3000', 'app.lokfeel.com', corsPolicy))
ok('127.0.0.1 默认放行', isCorsAllowed('http://127.0.0.1:3000', '', corsPolicy))
ok('预览域名按默认正则放行', isCorsAllowed('https://nexus-app-git-x.vercel.app', '', corsPolicy))
ok('后缀伪装不能通过（BUG-636 回归）', !isCorsAllowed('https://evil-app.lokfeel.com', 'lokfeel.com', corsPolicy))

const corsOff = policy({ CORS_ALLOW_LOCALHOST: '0', CORS_PREVIEW_ORIGIN_PATTERN: '' })
ok('可关掉 localhost 放行', !isCorsAllowed('http://localhost:3000', 'app.lokfeel.com', corsOff))
ok('可关掉预览放行', !isCorsAllowed('https://nexus-app-x.vercel.app', '', corsOff))

const corsCustom = policy({ CORS_ALLOWED_ORIGINS: 'https://a.example, https://b.example' })
ok('可自定义 origin 白名单', isCorsAllowed('https://b.example', '', corsCustom) && !isCorsAllowed('https://app.lokfeel.com', '', corsCustom))
ok(
  '非法正则不会让整站 403，但会给出告警',
  !isCorsAllowed('https://nexus-app-x.vercel.app', '', policy({ CORS_PREVIEW_ORIGIN_PATTERN: '([' })) &&
    describeRegionPolicy(policy({ CORS_PREVIEW_ORIGIN_PATTERN: '([' })).warnings.some((w) => w.includes('合法正则')),
)

// ═══════════════════════════════════════════════════════════
section('6. 缓存策略与请求头解析')
// ═══════════════════════════════════════════════════════════

ok('首页 5 分钟缓存', (getCacheControl('/') || '').includes('s-maxage=300'))
ok('登录页 5 分钟缓存', (getCacheControl('/login') || '').includes('s-maxage=300'))
ok('注册页 5 分钟缓存', (getCacheControl('/register') || '').includes('s-maxage=300'))
ok('法务静态页 2 小时缓存', (getCacheControl('/terms') || '').includes('s-maxage=7200'))
ok('sitemap 1 小时缓存', (getCacheControl('/sitemap.xml') || '').includes('s-maxage=3600'))
ok('robots 1 小时缓存', (getCacheControl('/robots.txt') || '').includes('s-maxage=3600'))
ok('控制台页面不设公开缓存', getCacheControl('/dashboard') === null)
ok('私有 API 不设公开缓存', getCacheControl('/api/im/send') === null)

const h = (map: Record<string, string>) => ({ get: (k: string) => map[k] ?? null })
ok('优先用 Vercel 国家头', getCountryFromHeaders(h({ 'x-vercel-ip-country': 'JP', 'cf-ipcountry': 'US' })) === 'JP')
ok("Vercel 头为 unknown 时回落到 Cloudflare", getCountryFromHeaders(h({ 'x-vercel-ip-country': 'unknown', 'cf-ipcountry': 'US' })) === 'US')
ok("Cloudflare 头为 XX 时视为取不到", getCountryFromHeaders(h({ 'cf-ipcountry': 'XX' })) === '')
ok('两个头都没有时返回空串', getCountryFromHeaders(h({})) === '')

ok('调试端点判定覆盖三个前缀', isDebugPath('/api/debug-auth') && isDebugPath('/api/db-check') && isDebugPath('/api/diagnostic/x'))
ok('普通 API 不是调试端点', !isDebugPath('/api/im/send'))

// ═══════════════════════════════════════════════════════════
section('7. 反回归守卫：proxy.ts 里不得再出现硬编码')
// ═══════════════════════════════════════════════════════════

const proxySrc = readFileSync(path.join(REPO_ROOT, 'proxy.ts'), 'utf8')
ok('proxy.ts 已从 region-policy 取值', /from '\.\/src\/config\/region-policy'/.test(proxySrc))
ok('proxy.ts 不再定义 BLOCKED_COUNTRIES 常量', !/const\s+BLOCKED_COUNTRIES/.test(proxySrc))
ok('proxy.ts 不再定义 IP_WHITELIST 常量', !/const\s+IP_WHITELIST/.test(proxySrc))
ok('proxy.ts 不再硬编码 lokfeel 域名白名单', !/lokfeel\.com/.test(proxySrc))
ok('proxy.ts 不再硬编码 vercel 预览域名', !/vercel\.app/.test(proxySrc))
ok('proxy.ts 的 matcher 仍为静态列表（Next.js 要求）', /export const config = \{[\s\S]*matcher: \[/.test(proxySrc))

// 判定顺序：白名单必须在封禁判定之前短路（否则被封地区的运营者也进不来）
const policySrc = readFileSync(path.join(REPO_ROOT, 'src/config/region-policy.ts'), 'utf8')
const bodyStart = policySrc.indexOf('export function evaluateRegion')
const whitelistAt = policySrc.indexOf('isIpWhitelisted(clientIp', bodyStart)
const countryCheckAt = policySrc.indexOf('policy.blockedCountries.includes', bodyStart)
ok(
  '判定顺序：IP 白名单在封禁之前短路',
  bodyStart > -1 && whitelistAt > -1 && countryCheckAt > -1 && whitelistAt < countryCheckAt,
  `whitelist@${whitelistAt} countryCheck@${countryCheckAt}`,
)

// ═══════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(70))
if (failures.length === 0) {
  console.log(`✅ 通过 ${passed} 项 —— 地域/CORS/缓存策略已完全配置驱动，且默认行为与改造前一致。`)
} else {
  console.log(`🔴 失败 ${failures.length} 项 / 共 ${passed + failures.length} 项：`)
  for (const f of failures) console.log(`   · ${f}`)
}
console.log('─'.repeat(70))
process.exit(failures.length === 0 ? 0 : 1)
