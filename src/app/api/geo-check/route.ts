import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/geo-check
 * 
 * 返回当前请求的 Geo 识别结果（JSON）
 * 用于验证 Vercel x-vercel-ip-country 头是否正确传递
 * 
 * 已加入 proxy.ts ALLOWED_PATHS，中国 IP 也可访问
 */
export async function GET(request: NextRequest) {
  const vercelCountry = request.headers.get('x-vercel-ip-country') || null
  const cfCountry = request.headers.get('cf-ipcountry') || null
  
  // 与 proxy.ts 中 getCountry() 相同逻辑
  let detectedCountry = '(unknown)'
  if (vercelCountry && vercelCountry !== 'unknown') {
    detectedCountry = vercelCountry
  } else if (cfCountry && cfCountry !== 'XX') {
    detectedCountry = cfCountry
  }

  const blockedCountries = ['CN']
  const isBlocked = blockedCountries.includes(detectedCountry)

  return NextResponse.json({
    country: detectedCountry,
    blocked: isBlocked,
    blockedCountries,
    headers: {
      'x-vercel-ip-country': vercelCountry,
      'cf-ipcountry': cfCountry,
    },
    hint: isBlocked
      ? '🚫 此 IP 应被阻断，访问其他页面应跳转到 /blocked'
      : '✅ 此 IP 不在阻断列表内',
  })
}
