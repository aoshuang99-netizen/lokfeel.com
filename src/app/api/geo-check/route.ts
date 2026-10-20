import { NextRequest, NextResponse } from 'next/server'
import {
  evaluateRegion,
  getCountryFromHeaders,
  isRegionBlockEnabled,
  resolveRegionPolicy,
} from '@/config/region-policy'

/**
 * GET /api/geo-check
 *
 * 返回**本请求实际会被怎么判**（而不是某份写死的假设）。
 *
 * 为什么改：本端点此前把 `blockedCountries` 硬编码成 `['CN']`，与
 * `GEO_BLOCKED_COUNTRIES` 的真实配置**没有关系**。后果是双向的误导：
 *   - 策略关闭时，它仍报 `blocked: true` ⇒ 误以为「CN 已被封」；
 *   - 配了封禁别的国家时，它仍报 CN ⇒ 排查方向直接错。
 * 自托管后 country 来自 `CF-IPCountry`（Tunnel 也会带），这个端点会变成
 * 迁移验收的主要观测点；观测点说谎比没有观测点更糟。
 *
 * 现在它复用 `region-policy.ts` 的纯函数：策略、判定、理由同源，
 * 中间件改了判定顺序这里不会漂移。
 *
 * 已加入 allowedPaths，被封地区也可访问（否则无法自证被封）。
 */

function clientIpOf(request: NextRequest): string {
  // 与 proxy.ts 同序：CF 头优先，XFF 兜底（见 proxy.ts 的注释）
  return (
    request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    ''
  )
}

export async function GET(request: NextRequest) {
  const policy = resolveRegionPolicy(process.env)
  const vercelCountry = request.headers.get('x-vercel-ip-country')
  const cfCountry = request.headers.get('cf-ipcountry')
  const country = getCountryFromHeaders(request.headers) || '(unknown)'
  const clientIp = clientIpOf(request)

  const decision = evaluateRegion(
    { country: country === '(unknown)' ? '' : country, clientIp, pathname: request.nextUrl.pathname },
    policy,
  )

  return NextResponse.json({
    country,
    /** 是否被判为阻断（与中间件同一判定，含白名单/允许名单语义） */
    blocked: decision.action !== 'allow',
    /** 命中的判据，便于区分「被国别挡」还是「被允许名单挡」 */
    reason: decision.reason,
    action: decision.action,
    policy: {
      enabled: isRegionBlockEnabled(policy),
      blockedCountries: policy.blockedCountries,
      allowedCountries: policy.allowedCountries,
      unknownCountry: policy.unknownCountry,
      ipWhitelistSize: policy.ipWhitelist.length,
      ipWhitelisted: decision.reason === 'ip-whitelisted',
      apiReturns451: policy.apiReturns451,
    },
    headers: {
      'x-vercel-ip-country': vercelCountry,
      'cf-ipcountry': cfCountry,
      'cf-connecting-ip': request.headers.get('cf-connecting-ip'),
    },
    hint:
      decision.action === 'allow'
        ? `✅ 放行（${decision.reason}）`
        : decision.action === 'json-451'
          ? `🚫 API 返回 451（${decision.reason}）`
          : `🚫 页面跳转 /blocked（${decision.reason}）`,
  })
}
