#!/usr/bin/env node
/**
 * S-02 门禁 · Hotfix **改动白名单**（防夹带）
 *
 * 任务书原文：「只移植商业审批门禁、R-15 修复及必需依赖，
 * **不夹带未经法律审核的页面和新功能**」。
 *
 * 为什么需要机械化：一个"最小 hotfix"在评审时看不出边界，
 * 只有把 base..HEAD 的文件清单逐条比对白名单，才能证明它没有顺手带上
 * 新公开页、视觉改版或法律文案。人在 diff 里漏看一个 `+page.tsx` 是常态。
 *
 * 判据分三层（由严到宽）：
 *   1. **路径白名单**：每个改动文件必须匹配 ALLOW 里的某条规则；
 *   2. **禁止区**：明确拒绝 `src/app/(public)/**`、`src/app/(landing)/**`、
 *      任何新增 `page.tsx`/`layout.tsx` —— 这三类是"新页面/改版"的载体；
 *   3. **禁止新增依赖**：`package.json` 的 dependencies 变化不允许出现在 hotfix 里
 *      （依赖变更需要独立评审与供应链扫描）。
 *
 * 用法:
 *   node scripts/qa/hotfix-diff-whitelist.mjs --base=5a161c4 --head=HEAD
 */

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

export const ALLOWED = [
  /^src\/lib\/payments\/commercial-gate\.ts$/,
  /^src\/lib\/payments\/dodo\/events\.ts$/,
  /^src\/config\/products\.ts$/,
  /^src\/app\/api\/payments\/dodo\/(plans|checkout)\/route\.ts$/,
  /^tests\/billing\/[A-Za-z0-9._-]+\.test\.ts$/,
  // 唯一被放行的非 billing 测试：它断言的是 `products.ts` 定价状态本身。
  // 改目录而不改断言 ⇒ CI 必红（该断言原写死"已获批 + From $49/mo + 可购买"，
  // 正是 G12 明令禁止的实现者自批状态）。它不是"顺手改的测试"，而是同一改动的另一半。
  /^tests\/commercial\/products\.test\.ts$/,
  /^docs\/release\/lokfeel-final-20261110\/.*$/,
  /^scripts\/qa\/hotfix-diff-whitelist(\.test)?\.mjs$/,
  // CI 门禁脚本本身：`verify-payment-off.mjs` 里 `channels === 5` 是陈旧断言，
  // 与 availability.ts 的 7 通道矛盾 ⇒ 生产基线 5a161c4 与 main 也一直是红的。
  // 不放宽它就没法证明"hotfix 的远端 CI 绿"，而改法是严格化（集合相等），不是放水。
  /^scripts\/qa\/verify-payment-off\.mjs$/,
]

/** 明确禁止：新公开页、落地页改版、任何新增路由页面。 */
export const FORBIDDEN = [
  /^src\/app\/\(public\)\//,
  /^src\/app\/\(landing\)\//,
  /^src\/app\/.*\/(page|layout|template|loading|error)\.tsx?$/,
  /^src\/components\//,
  /^prisma\//,
  /^package(-lock)?\.json$/,
  /^next\.config\./,
  /^netlify\.toml$/,
]

export function classify(file) {
  if (FORBIDDEN.some((re) => re.test(file))) return 'forbidden'
  if (ALLOWED.some((re) => re.test(file))) return 'allowed'
  return 'unlisted'
}

export function evaluateDiff(files) {
  const rows = files.map((f) => ({ file: f, verdict: classify(f) }))
  const violations = rows.filter((r) => r.verdict !== 'allowed')
  return {
    verdict: violations.length ? 'FAIL' : files.length ? 'PASS' : 'EMPTY_DIFF',
    totalFiles: files.length,
    violations,
    rows,
  }
}

function arg(name, fallback) {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

function main() {
  const base = arg('base', '5a161c4')
  const head = arg('head', 'HEAD')
  const out = arg('out', '')
  const raw = execFileSync('git', ['diff', '--name-only', `${base}..${head}`], { encoding: 'utf8' })
  const files = raw.split('\n').map((s) => s.trim()).filter(Boolean)
  const result = {
    checkedAt: new Date().toISOString(),
    base,
    head: execFileSync('git', ['rev-parse', head], { encoding: 'utf8' }).trim(),
    ...evaluateDiff(files),
  }
  const printed = JSON.stringify(result, null, 2)
  process.stdout.write(`${printed}\n`)
  if (out) writeFileSync(out, `${printed}\n`, 'utf8')
  process.exitCode = result.verdict === 'PASS' ? 0 : result.verdict === 'EMPTY_DIFF' ? 1 : 2
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main()
