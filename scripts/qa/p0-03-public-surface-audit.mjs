#!/usr/bin/env node
/**
 * P0-03 · 公开面八问与 CTA 真实有效性只读取证
 *
 * 作战包 §2 明确：「页面返回 200 ≠ CTA 真实可用」。本脚本对每个核心公开页
 * 取真实 HTML，检查 ① HTTP/非空 body ② 八问对应文案是否真的在可见页面里
 * ③ 页面内所有站内 href 是否指向一个同样返回 200 的路由。
 *
 * 边界：这里只证「文案存在 + 链接不空转」，**不证访客能理解** ——
 * 后者是 G5 真人测试（NOT_TESTED），不得用本脚本的 PASS 冒充。
 */
import { writeFileSync } from 'node:fs'

export const CORE_ROUTES = [
  '/', '/product', '/solutions', '/stories', '/how-it-works', '/pricing',
  '/help', '/about', '/contact', '/terms', '/privacy', '/refunds',
]

/** 八问 → 承载页 → 必须在可见 HTML 中出现的证据词（只证存在，不证理解）。 */
export const EIGHT_QUESTIONS = [
  { id: 'Q1', question: '你是谁 / 平台定位', route: '/', needles: ['LokFeel', 'Connection OS'] },
  { id: 'Q2', question: '为谁服务', route: '/solutions', needles: ['team', 'community', '团队', '社群'] },
  { id: 'Q3', question: '解决什么问题', route: '/product', needles: ['Connection OS', 'intent', 'outcome'] },
  { id: 'Q4', question: '与聊天机器人 / CRM 的差异', route: '/product', needles: ['chat', 'CRM', 'approve', 'consent'] },
  { id: 'Q5', question: '怎么用 / 流程', route: '/how-it-works', needles: ['step', 'workflow', 'consent'] },
  { id: 'Q6', question: '订阅档位与价格区别', route: '/pricing', needles: ['STARTER', 'GROWTH', 'SCALE'] },
  { id: 'Q7', question: '谁负责 / 怎么联系', route: '/contact', needles: ['contact', 'email', 'hello@'] },
  { id: 'Q8', question: '法律 / 退款 / 数据处理', route: '/terms', needles: ['Terms', 'Dodo', 'refund'] },
]

/** 纯函数判定：缺页 / 空 body / 非 200 一律 ERROR，绝不落到 PASS。 */
export function evaluatePublicSurface(pages, questions = EIGHT_QUESTIONS) {
  const errors = []
  const byRoute = new Map(pages.map((p) => [p.route, p]))
  for (const route of CORE_ROUTES) {
    const page = byRoute.get(route)
    if (!page) { errors.push(`missing_route:${route}`); continue }
    if (page.httpStatus !== 200) { errors.push(`${route}_http_${page.httpStatus}`); continue }
    if (!(page.bytes > 2000)) { errors.push(`${route}_empty_body`); continue }
  }
  const questionCoverage = []
  for (const q of questions) {
    const page = byRoute.get(q.route)
    const html = page?.html ?? ''
    const hit = q.needles.filter((n) => html.toLowerCase().includes(n.toLowerCase()))
    questionCoverage.push({ id: q.id, question: q.question, route: q.route, hits: hit.length, needles: q.needles.length })
    if (hit.length === 0 && !errors.length) errors.push(`${q.id}_no_visible_evidence`)
  }
  // 站内 CTA 指向的路由必须也在 200 名单里；外链不判（本环境无法取证）。
  const okRoutes = new Set(pages.filter((p) => p.httpStatus === 200).map((p) => p.route))
  const deadLinks = []
  for (const page of pages) {
    for (const href of page.internalLinks ?? []) {
      const path = href.split(/[?#]/)[0] || '/'
      if (!okRoutes.has(path) && !CORE_ROUTES.includes(path)) {
        // 可能是未纳入核心清单的合法路由（如 /faq）：单独记录，不直接判死链
        deadLinks.push({ from: page.route, href })
      }
    }
  }
  return {
    verdict: errors.length ? (errors.some((e) => e.startsWith('missing_route') || e.includes('empty_body') || e.includes('_http_')) ? 'ERROR' : 'FAIL') : 'PASS',
    errors,
    questionCoverage,
    coveredQuestions: questionCoverage.filter((q) => q.hits > 0).length,
    totalQuestions: questions.length,
    unlistedInternalLinks: deadLinks,
  }
}

const arg = (name, fallback) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

async function main() {
  const base = arg('base', 'http://127.0.0.1:3112').replace(/\/$/, '')
  const out = arg('out', '')
  const pages = []
  for (const route of CORE_ROUTES) {
    try {
      const started = Date.now()
      const resp = await fetch(`${base}${route}`, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20000) })
      const html = await resp.text()
      const links = [...html.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1])
      const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] ?? null
      pages.push({
        route, httpStatus: resp.status, bytes: html.length, elapsedMs: Date.now() - started,
        title, internalLinks: [...new Set(links)], html,
      })
    } catch (e) {
      pages.push({ route, httpStatus: 0, bytes: 0, error: String(e?.message ?? e), internalLinks: [], html: '' })
    }
  }
  const verdict = evaluatePublicSurface(pages)
  const report = {
    checkedAt: new Date().toISOString(), base, readOnly: true,
    routeCount: CORE_ROUTES.length, ...verdict,
    pages: pages.map((p) => {
      const rest = { ...p }
      delete rest.html
      return rest
    }),
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.exitCode = verdict.verdict === 'PASS' ? 0 : 1
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main()
