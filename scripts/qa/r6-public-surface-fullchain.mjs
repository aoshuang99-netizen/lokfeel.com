#!/usr/bin/env node
/**
 * V20.7 GA · R6-T2 —— 公开面"全链路"封存审计（HTML / RSC / metadata / sitemap / cache）
 *
 * ── 它回答什么 ────────────────────────────────────────────────────────
 *   上一轮的 T2 只看了 **HTML 可见文本**，判定 PASS。那只覆盖了一条通道：
 *     · 客户端路由预取走的是 **RSC flight payload**（`?_rsc=` / `RSC: 1`），
 *       它和 HTML 是两份序列化结果，冻结写在渲染层时通常一致，但
 *       metadata 是另一套（`generateMetadata` 不经过组件树），必须单独查；
 *     · `sitemap.xml` 会把冻结页继续"推荐"给搜索引擎 —— 页面 noindex 而 sitemap
 *       仍列出，是自相矛盾的信号；
 *     · 缓存头决定这份"冻结"能存多久、会不会被 CDN 继续发旧内容。
 *   所以本脚本对**同一份策略**查五条通道，任一条漏就 FAIL。
 *
 * ── 为什么必须有负向对照 ───────────────────────────────────────────────
 *   "0 命中"有两种可能：真干净，或检测器坏了。所以脚本先把已知脏样本喂给
 *   检测器，必须命中（`--selftest` 与主流程都会跑），否则整份报告作废。
 *
 * 用法：
 *   node scripts/qa/r6-public-surface-fullchain.mjs --base=http://127.0.0.1:3116 --out=x.json
 */
import fs from 'node:fs'
import path from 'node:path'

const args = {}
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue
  const i = a.indexOf('=')
  if (i === -1) args[a.slice(2)] = 'true'
  else args[a.slice(2, i)] = a.slice(i + 1)
}
const BASE = (args.base || 'http://127.0.0.1:3116').replace(/\/$/, '')

const HOLD_ROUTES = ['/product', '/solutions', '/stories', '/how-it-works', '/help']
const ALL_ROUTES = ['/', '/pricing', ...HOLD_ROUTES, '/about', '/terms', '/privacy', '/refunds', '/contact']
const HOLD_MARKER = '该页面正在最终审核'

/** 未批准金额：$ 后面跟数字。$2 这类 RSC 引用会被 stripScripts 先去掉。 */
export const PRICE_PATTERN = /US\$\s?\d|\$\s?\d{1,4}(?:[.,]\d{2})?(?:\s?\/\s?(?:mo|month|year|yr))?/i
/** 未核实法人：Inc./LLC/Ltd/GmbH/Delaware/Wilmington 与品牌同现，或裸 Delaware。 */
export const LEGAL_PATTERN = /\b(LokFeel|Lokfeel|LOKFEEL)\s+(Inc\.?|LLC|Ltd\.?|Limited|GmbH|Pte\.?\s*Ltd\.?)\b|\bDelaware\b|\bWilmington\b/

/**
 * 只留"人眼可见"的部分：剥掉 script/style/注释与标签。
 * 理由（上一轮踩过）：RSC flight 在 `<script>` 里含 `$2`、`$L4` 之类引用，
 * 直接跑金额正则会给每页报 6–10 个假命中，最后这条门禁会被当成噪声关掉。
 */
export function stripToVisibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
}

export function scan(text) {
  const hits = []
  const price = text.match(PRICE_PATTERN)
  if (price) hits.push({ kind: 'UNAPPROVED_PRICE', sample: price[0] })
  const legal = text.match(LEGAL_PATTERN)
  if (legal) hits.push({ kind: 'UNVERIFIED_LEGAL_ENTITY', sample: legal[0] })
  return hits
}

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i')
  const m = html.match(re)
  if (m) return m[1]
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i')
  return (html.match(re2) || [])[1] || null
}

async function get(url, headers = {}) {
  const r = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) })
  const text = await r.text()
  return { status: r.status, headers: Object.fromEntries(r.headers), text }
}

function selftest() {
  const dirty = 'Starter plan US$ 49 / month. LokFeel Inc. Wilmington, Delaware.'
  const hits = scan(dirty)
  const clean = scan('该页面正在最终审核 我们正在核对定价与法律信息')
  const okDirty = hits.length === 2
  const okClean = clean.length === 0
  console.log(`${okDirty ? 'PASS' : 'FAIL'}  负向对照：脏样本被识别（${hits.map((h) => h.kind).join('+') || '无命中'}）`)
  console.log(`${okClean ? 'PASS' : 'FAIL'}  正向对照：干净样本不误报`)
  if (!okDirty || !okClean) process.exit(1)
}

async function main() {
  const selftestResult = (() => {
    const hits = scan('Starter US$ 49 / month, LokFeel Inc., Delaware')
    return hits.length === 2
  })()
  if (!selftestResult) {
    console.error('检测器自检失败：不允许产出报告')
    process.exit(2)
  }

  const report = { checkedAt: new Date().toISOString(), base: BASE, readOnly: true, routes: {}, findings: [] }

  for (const route of ALL_ROUTES) {
    const entry = { route, html: null, rsc: null, metadata: null, cache: null, issues: [] }

    // ① HTML（可见文本）
    const html = await get(BASE + route)
    const visible = stripToVisibleText(html.text)
    entry.html = { status: html.status, visibleBytes: visible.length, hits: scan(visible) }
    entry.cache = {
      'cache-control': html.headers['cache-control'] || null,
      'x-robots-tag': html.headers['x-robots-tag'] || null,
      age: html.headers['age'] || null,
      etag: html.headers['etag'] || null,
    }

    // ② RSC flight（客户端路由预取的真实载荷）
    const rsc = await get(BASE + route, { RSC: '1' })
    const rscHits = scan(rsc.text)
    entry.rsc = { status: rsc.status, bytes: rsc.text.length, hits: rscHits }

    // ③ metadata（不经过组件树）
    entry.metadata = {
      title: (html.text.match(/<title>([^<]*)<\/title>/i) || [])[1] || null,
      robots: meta(html.text, 'robots'),
      description: meta(html.text, 'description'),
      canonical: (html.text.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)/i) || [])[1] || null,
      hits: scan([meta(html.text, 'description') || '', (html.text.match(/<title>([^<]*)<\/title>/i) || [])[1] || ''].join(' ')),
    }

    // 判定
    if (html.status !== 200) entry.issues.push(`HTML ${html.status}`)
    if (visible.trim().length < 40) entry.issues.push('可见正文过短（疑似空壳）')
    if (entry.html.hits.length) entry.issues.push(`HTML 含未批准内容：${entry.html.hits.map((h) => h.kind).join(',')}`)
    if (entry.rsc.hits.length) entry.issues.push(`RSC 含未批准内容：${entry.rsc.hits.map((h) => h.kind).join(',')}`)
    if (entry.metadata.hits.length) entry.issues.push(`metadata 含未批准内容：${entry.metadata.hits.map((h) => h.kind).join(',')}`)

    if (HOLD_ROUTES.includes(route)) {
      if (!visible.includes(HOLD_MARKER)) entry.issues.push('冻结页未输出占位正文')
      const robots = `${entry.metadata.robots || ''} ${entry.cache['x-robots-tag'] || ''}`.toLowerCase()
      if (!/noindex/.test(robots)) entry.issues.push('冻结页缺少 noindex（metadata 与响应头都没有）')
      const cc = (entry.cache['cache-control'] || '').toLowerCase()
      if (!/no-store|private|max-age=0/.test(cc)) entry.issues.push(`冻结页缓存策略不足：${cc || '(无)'}`)
    }

    if (entry.issues.length) report.findings.push({ route, issues: entry.issues })
    report.routes[route] = entry
  }

  // ④ sitemap 不得推荐冻结页
  const sm = await get(`${BASE}/sitemap.xml`)
  const smUrls = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  const leaked = smUrls.filter((u) => HOLD_ROUTES.some((h) => u.endsWith(h)))
  report.sitemap = { status: sm.status, count: smUrls.length, frozenListed: leaked }
  if (leaked.length) report.findings.push({ route: '/sitemap.xml', issues: [`仍列出冻结页：${leaked.join(', ')}`] })

  report.verdict = report.findings.length === 0 ? 'PASS' : 'FAIL'
  console.log(`\n结果：${report.verdict} · 路由 ${ALL_ROUTES.length} · sitemap ${smUrls.length} 条（冻结页 ${leaked.length}）`)
  for (const f of report.findings) console.log(`  FAIL ${f.route} — ${f.issues.join(' / ')}`)

  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true })
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n')
    console.log(`写出 ${args.out}`)
  }
  process.exit(report.verdict === 'PASS' ? 0 : 1)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(3)
})
