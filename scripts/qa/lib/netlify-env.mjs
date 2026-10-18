/**
 * 读取 Netlify 生产环境变量的**真实值**（只给需要真凭据的探针用）
 *
 * WHY 不能直接读 `GET /sites/{id}/env`：
 *   列表端点把 secret 值**掩码**成 `****`（长度也是假的），拿它做判断会得出
 *   「变量有值」的错觉。单键端点 `GET /accounts/{acc}/env/{key}?site_id=…`
 *   才会返回真实值。
 *
 * 安全：本模块**不打印**值，只回传；调用方负责不落盘、不回显。
 */
import { loadEnv } from './turso-http.mjs'

export const DEFAULT_SITE_ID = 'c46478e9-7ac8-4bcf-9052-7638b04fef83'

export async function readNetlifyEnv(key, opts = {}) {
  const env = opts.env || loadEnv()
  const token = opts.token || env.NETLIFY_AUTH_TOKEN
  const siteId = opts.siteId || env.NETLIFY_SITE_ID || DEFAULT_SITE_ID
  if (!token) throw new Error('缺少 NETLIFY_AUTH_TOKEN（无法读取生产环境变量）')

  const api = 'https://api.netlify.com/api/v1'
  const auth = { Authorization: `Bearer ${token}` }

  const siteRes = await fetch(`${api}/sites/${siteId}`, { headers: auth, signal: AbortSignal.timeout(20_000) })
  if (!siteRes.ok) throw new Error(`Netlify 站点查询失败 HTTP ${siteRes.status}`)
  const site = await siteRes.json()
  const accountId = site?.account_id
  if (!accountId) throw new Error('Netlify 站点未返回 account_id')

  const res = await fetch(
    `${api}/accounts/${accountId}/env/${encodeURIComponent(key)}?site_id=${siteId}`,
    { headers: auth, signal: AbortSignal.timeout(20_000) },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Netlify 变量查询失败 HTTP ${res.status}`)
  const json = await res.json().catch(() => null)
  const prod = (json?.values || []).find((v) => (v.context || 'all') === 'production') || json?.values?.[0]
  const value = prod?.value ?? null
  return value ? String(value) : null
}
