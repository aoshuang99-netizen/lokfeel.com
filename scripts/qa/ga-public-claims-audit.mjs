#!/usr/bin/env node
/**
 * GA T2/T0 · 公开面商业与法律声明审计（只读）
 *
 * 目的不是"扫一遍源码"，而是回答一个可判定问题：
 *   **公众能拿到的 HTML 里，还有没有未经批准的金额与未核实的法律主体？**
 *
 * 因此它打的是**构建产物**（`next start`）而不是源码 —— 源码里没有 `$49`
 * 不代表页面不渲染 `$49`（本轮的真实教训：金额来自 `PLAN_CATALOG`）。
 *
 * 判定：
 *   · 12 个公开目标页全部 200 且非空；
 *   · 未批准的金额（`$` + 数字）在 **所有** 公开路径 0 命中；
 *   · 未核实的法律主体（Inc. / Delaware / LLC 等）0 命中；
 *   · 冻结中的五个页面必须命中占位文案（"该页面正在最终审核"）。
 *
 * 用法：
 *   env -u NODE_OPTIONS node scripts/qa/ga-public-claims-audit.mjs \
 *     --base=http://127.0.0.1:3113 \
 *     --write=docs/release/lokfeel-v20.7-ga/evidence/t2-public-claims.json
 */
import { writeFileSync } from 'node:fs'

export const AUDIT_ROUTES = [
  '/',
  '/pricing',
  '/product',
  '/solutions',
  '/stories',
  '/how-it-works',
  '/help',
  '/about',
  '/terms',
  '/privacy',
  '/refunds',
  '/contact',
]

export const FROZEN_ROUTES = ['/product', '/solutions', '/stories', '/how-it-works', '/help']

/** 未批准金额：`$49` / `$ 49` / `$49.00` —— 但不把 `$0`（"免费"）当作报价。 */
export const AMOUNT_PATTERN = /\$\s?([1-9]\d*)([.,]\d+)?/g

/** 未核实法律主体：具体法人名/注册地。这些只能来自 D8 的真实输入。 */
export const LEGAL_ENTITY_PATTERN =
  /\b(LokFeel|Lokfeel|LOKFEEL)\s+(Inc\.?|LLC|Ltd\.?|Limited|GmbH|Pte\.?\s*Ltd\.?)\b|\bDelaware\b/g

export const HOLD_MARKER = '该页面正在最终审核'

/**
 * 只取**可见文本**。
 *
 * 为什么必须这么做：Next 的 RSC flight payload 会出现在 HTML 的 `<script>` 里，
 * 里面充满形如 `$2` `$L4` 的 chunk 引用 —— 直接正则会把它当成"金额"，
 * 于是审计对每个页面都报 6~10 个假金额。**假阳性会让人开始不信这个门禁**，
 * 最后它就被关掉了。所以先剥离 script/style 与标签，再做断言。
 */
export function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
}

const arg = (name, fallback) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

/**
 * 判定层（纯函数，便于负控）。
 * `pages` 形如 `{ '/pricing': { status: 200, text: '...' } }`。
 */
export function auditPublicClaims(pages, { frozenRoutes = FROZEN_ROUTES, routes = AUDIT_ROUTES } = {}) {
  const findings = []
  const perRoute = {}

  for (const route of routes) {
    const page = pages[route]
    if (!page) {
      findings.push({ route, kind: 'MISSING_SAMPLE', detail: '未取到该路由的响应' })
      continue
    }
    if (page.status !== 200) {
      findings.push({ route, kind: 'NOT_200', detail: String(page.status) })
      continue
    }
    const text = visibleText(page.html ?? page.text ?? '')
    if (text.trim().length === 0) {
      findings.push({ route, kind: 'EMPTY_BODY', detail: '200 但正文为空，不能判通过' })
      continue
    }

    const amounts = [...text.matchAll(AMOUNT_PATTERN)].map((m) => m[0])
    const legal = [...text.matchAll(LEGAL_ENTITY_PATTERN)].map((m) => m[0])
    const frozen = frozenRoutes.includes(route)
    const hasHold = text.includes(HOLD_MARKER)

    if (amounts.length) findings.push({ route, kind: 'UNAPPROVED_AMOUNT', detail: [...new Set(amounts)].join(', ') })
    if (legal.length) findings.push({ route, kind: 'UNVERIFIED_LEGAL_ENTITY', detail: [...new Set(legal)].join(', ') })
    if (frozen && !hasHold) findings.push({ route, kind: 'FROZEN_BUT_RENDERS_CONTENT', detail: '未出现占位文案' })

    perRoute[route] = {
      status: page.status,
      bytes: Buffer.byteLength(text),
      frozen,
      hasHold,
      amountHits: [...new Set(amounts)],
      legalEntityHits: [...new Set(legal)],
    }
  }

  // 所有 finding 都是阻断项：金额/主体/空正文/未冻结 —— 没有"警告级"这一类。
  // 尤其 MISSING_SAMPLE 不能因为"没取到"就跳过（空集恒真是本轮反复踩过的假绿）。
  return {
    verdict: findings.length === 0 ? 'PASS' : 'FAIL',
    routes: perRoute,
    findings,
  }
}

async function get(base, pathname) {
  const url = new URL(pathname, base).toString()
  try {
    const res = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25_000) })
    return { url, status: res.status, text: await res.text() }
  } catch (err) {
    return { url, status: 0, text: '', error: String(err?.message || err) }
  }
}

async function main() {
  const base = arg('base', 'http://127.0.0.1:3113')
  const writeTo = arg('write', '')

  const pages = {}
  for (const route of AUDIT_ROUTES) {
    const row = await get(base, route)
    pages[route] = { status: row.status, text: row.text }
  }

  const result = auditPublicClaims(pages)
  const report = {
    checkedAt: new Date().toISOString(),
    base,
    readOnly: true,
    ...result,
  }
  if (writeTo) writeFileSync(writeTo, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(`公开面声明审计 @ ${base}`)
  for (const [route, row] of Object.entries(result.routes)) {
    console.log(
      `  ${route.padEnd(14)} ${row.status}  ${String(row.bytes).padStart(6)}B  frozen=${row.frozen ? 'Y' : 'n'} hold=${row.hasHold ? 'Y' : 'n'} 金额=${row.amountHits.length} 主体=${row.legalEntityHits.length}`,
    )
  }
  for (const f of result.findings) console.log(`  ✗ ${f.route} ${f.kind} ${f.detail}`)
  console.log(`\n判定: ${result.verdict}`)
  if (writeTo) console.log(`证据: ${writeTo}`)
  if (result.verdict !== 'PASS') process.exitCode = 2
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
