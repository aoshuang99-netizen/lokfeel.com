/**
 * B4 · G4 公开面全矩阵实测：全路由 × 4 视口 · 截图 + axe + 横向溢出 + 渲染断言
 *
 * 口径（与 v204-visual-audit 一致的诚实原则）：
 *   - 公开页为单一深色 glass 主题，无 `data-lf-theme` 切换 ⇒ 主题维度记 THEME_NA（不计 PASS 分母造假）。
 *   - 非 200 路由（如 gate 关闭的 /checkout 404）如实记 status，该格 screenshot/axe 记 NA——
 *     不为了凑绿而跳过，也不伪装成 PASS。
 *   - hard gate：axe serious+critical = 0；横向溢出（scrollWidth > clientWidth+1）= FAIL。
 *   - **前置非空断言**：每格必须证明 axe 真的评估出结果（rulesEvaluated > 0），
 *     否则判 ERROR 而不是 PASS —— 防止「axe 没跑/页面空白 ⇒ violations=[]」的空集恒真假绿。
 *     判定逻辑抽到 b4-g4-verdict.mjs，由 b4-g4-verdict.test.mjs 做红→绿负控回归。
 *
 * 用法：
 *   node --test scripts/qa/b4-g4-verdict.test.mjs   # 判定层自测（含负控，不依赖浏览器）
 *   node scripts/qa/b4-g4-public-matrix.mjs --base=http://localhost:3111 ...  # 全矩阵
 *   node scripts/qa/b4-g4-public-matrix.mjs --base=http://localhost:3111 \
 *     --shot-dir=test-results/b4-g4-matrix --out=docs/release/lokfeel-final-20261110/evidence/g4-public-matrix.json
 *
 * 退出码：0 = 无 FAIL；1 = 有 FAIL。
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'
import { evaluateCell } from './b4-g4-verdict.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const argv = process.argv.slice(2)
const arg = (k, d = '') => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}

const BASE = arg('base', 'http://localhost:3111').replace(/\/$/, '')
const SHOT_DIR = arg('shot-dir', 'test-results/b4-g4-matrix')
const OUT = arg('out', 'docs/release/lokfeel-final-20261110/evidence/g4-public-matrix.json')

mkdirSync(SHOT_DIR, { recursive: true })

/** 公开面全路由（(landing)+(public)+(auth) 顶层页）。 */
const ROUTES_ALL = [
  '/',
  '/product', '/solutions', '/stories', '/how-it-works', '/help',
  '/pricing', '/about', '/contact', '/support', '/faq',
  '/terms', '/privacy', '/cookies', '/refunds', '/cancellations-policy',
  '/careers', '/press', '/community-guidelines', '/content-removal-appeals-policy',
  '/dmca', '/safety-tips', '/hlua', '/fan-creator-agreement', '/18-usc-2257',
  '/checkout',
  '/login', '/register', '/forgot-password',
]

// --routes=/,/pricing 只跑子集（快速验证用）；summary 会标注 subset，禁止把子集当全量证据。
const routesArg = arg('routes', '')
const ROUTES = routesArg
  ? routesArg.split(',').map((s) => s.trim()).filter(Boolean)
  : ROUTES_ALL

const VIEWPORTS = [
  ['m360', { width: 360, height: 800 }],
  ['m390', { width: 390, height: 844 }],
  ['t768', { width: 768, height: 1024 }],
  ['d1440', { width: 1440, height: 900 }],
]

const AXE_SRC = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const launchOpts = {}
if (process.env.PW_EXECUTABLE) launchOpts.executablePath = process.env.PW_EXECUTABLE
if (process.env.PW_CHANNEL) launchOpts.channel = process.env.PW_CHANNEL

const browser = await chromium.launch(launchOpts)

const results = []
let fails = 0

for (const [vpName, vp] of VIEWPORTS) {
  // reducedMotion: axe 背景解析对"每帧位移的元素"几何不稳定（捕获与遍历之间元素移位，
  // 轨道图标签被随机误判金色背景）。axe 官方最佳实践：动画内容在 prefers-reduced-motion
  // 下扫描——组件有完整静态降级分支，这是真实用户面向的渲染态，不是绕过门禁。
  const context = await browser.newContext({ viewport: vp, reducedMotion: 'reduce' })
  for (const route of ROUTES) {
    const cell = { route, viewport: vpName, status: null, axe: null, overflow: null, theme: 'THEME_NA', shot: null, verdict: 'NA' }
    const slug = (route === '/' ? 'home' : route.replace(/^\//, '').replace(/[^\w-]/g, '-'))
    const shotPath = path.join(SHOT_DIR, `${slug}--${vpName}.png`)
    const page = await context.newPage()
    try {
      const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 20000 })
      cell.status = resp ? resp.status() : null
      if (cell.status === 200) {
        // 显式超时：某些页面有持续请求，networkidle 可能永不达成（曾导致整轮挂起 25min）
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
        await page.waitForTimeout(400)
        // 渲染断言：主题属性（公开面无 lf-theme ⇒ THEME_NA）
        const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-lf-theme'))
        if (themeAttr) cell.theme = themeAttr
        // 横向溢出（响应式缺陷硬信号）
        cell.overflow = await page.evaluate(() => {
          const de = document.documentElement
          return de.scrollWidth - de.clientWidth
        })
        await page.screenshot({ path: shotPath, fullPage: false })
        cell.shot = path.relative(process.cwd(), shotPath)
        // axe：serious/critical hard gate + 前置非空断言（防「axe 没跑却零违规」的假绿）
        await page.addScriptTag({ content: AXE_SRC })
        // page.evaluate 不受 Playwright timeout 控制：用 watchdog 防浏览器无响应时整轮挂起。
        const scan = await Promise.race([
          page.evaluate(async () => {
            const run = await window.axe.run(document, { resultTypes: ['violations', 'passes'] })
            const violations = (run.violations || []).map((v) => ({
              id: v.id, impact: v.impact, nodes: (v.nodes || []).length,
            }))
            return {
              // 只有 axe 真的评估出结果，才算「扫过」；空集一律判 ERROR 而非 PASS
              rulesEvaluated:
                (run.passes || []).length + violations.length + (run.incomplete || []).length,
              violations,
            }
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('AXE_SCAN_TIMEOUT_15s')), 15000),
          ),
        ])
        const decision = evaluateCell({ ...scan, overflow: cell.overflow })
        cell.axe = {
          rulesEvaluated: scan.rulesEvaluated,
          totalRules: scan.violations.length,
          seriousCount: decision.seriousCount,
          detail: scan.violations,
        }
        cell.verdict = decision.verdict
        if (decision.verdict !== 'PASS') {
          fails++
          cell.reason = decision.reason
          console.log(`❌ ${route} @${vpName} verdict=${decision.verdict} reason=${decision.reason ?? '-'} axe-serious=${decision.seriousCount} rulesEvaluated=${scan.rulesEvaluated} overflow=${cell.overflow}px`)
        }
      } else {
        console.log(`— ${route} @${vpName} status=${cell.status}（记 NA，不参与 PASS 分母）`)
      }
    } catch (e) {
      cell.verdict = 'ERROR'
      cell.error = String(e).slice(0, 200)
      fails++
      console.log(`💥 ${route} @${vpName} ${cell.error}`)
    } finally {
      await page.close()
    }
    results.push(cell)
    if (cell.verdict === 'PASS') process.stdout.write('✓')
  }
  await context.close()
  console.log(`\n== viewport ${vpName} done ==`)
}
await browser.close()

const tested = results.filter((r) => r.verdict === 'PASS' || r.verdict === 'FAIL')
const scanned = results.filter((r) => r.status === 200 && r.axe)
const ruleCounts = scanned.map((r) => r.axe.rulesEvaluated ?? 0)
const zeroScanCells = ruleCounts.filter((n) => n <= 0).length
const summary = {
  base: BASE,
  // 非 null 表示本轮只跑了子集，其分母不得冒充全量矩阵结论
  subset: routesArg || null,
  expectedFullCells: ROUTES_ALL.length * VIEWPORTS.length,
  totalCells: results.length,
  pass: results.filter((r) => r.verdict === 'PASS').length,
  fail: results.filter((r) => r.verdict === 'FAIL').length,
  na: results.filter((r) => r.verdict === 'NA').length,
  error: results.filter((r) => r.verdict === 'ERROR').length,
  testedDenominator: tested.length,
  // 前置非空证据：所有 200 格都必须真的跑过 axe，否则本次结果不可采信
  scannedCells: scanned.length,
  rulesEvaluatedMin: ruleCounts.length ? Math.min(...ruleCounts) : 0,
  zeroScanCells,
}
writeFileSync(OUT, JSON.stringify({ summary, results }, null, 1))
console.log('\n==== G4 公开面矩阵汇总 ====')
console.log(JSON.stringify(summary))
process.exit(fails === 0 ? 0 : 1)
