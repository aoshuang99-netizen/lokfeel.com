#!/usr/bin/env node
/**
 * 定价一致性门禁（WB17-10）
 *
 * ── 它守什么 ──────────────────────────────────────────────────────────
 *   1. **算术**：页面上写的"省 37%""≈ $12.50/月"必须与价格本身算得出来一致。
 *      折扣文案算错是很常见的——而且没人会去核。
 *   2. **单一配置源**：`src/config/plans.ts` 自称唯一权威。任何**对外可见**的价格
 *      要么能在 plans.ts 里找到对应值，要么必须登记在 `KNOWN_PUBLIC_EXTRA` 里
 *      并写明原因。没登记的第四个价格 ⇒ 红。
 *
 * ── 为什么用"登记已知偏差"而不是直接判红 ──────────────────────────────
 *   当前**真的存在**两套彼此无关的价格（见 `docs/implementation/v17/10_*`）：
 *     · 代码 `plans.ts`：$19.99/月 · $149.99/年（省 37%）
 *     · 公开 `pay.html`：$12.99/月 · $99.99/年（省 36%）· $32.99/季（省 15%）
 *   直接把偏差判红，会让 CI 永远红（然后被人 `|| true`）——那是假门禁。
 *   所以：**已知偏差登记 + 新偏差判红**。登记项必须写原因和解除条件，
 *   它是一张欠条，不是豁免。
 *
 * 用法：
 *   node scripts/qa/verify-pricing-consistency.mjs
 *   node scripts/qa/verify-pricing-consistency.mjs --self-test
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

const PLANS_FILE = 'src/config/plans.ts'
const PAY_FILE = 'public/pay.html'

/**
 * 已登记的"对外价格在 plans.ts 里找不到对应值"的条目。
 * 每一条都必须写清：是什么、为什么允许、什么时候必须消掉。
 */
export const KNOWN_PUBLIC_EXTRA = [
  {
    cents: 1299,
    where: 'public/pay.html · Binge',
    reason: '公开付款页走 Gumroad、卖的是另一条产品线（Hlua Pass），价格体系与 plans.ts 无关',
    expiresWhen: '产品身份统一后再评估：要么接入 plans.ts，要么下线该页',
  },
  {
    cents: 9999,
    where: 'public/pay.html · Inner Circle',
    reason: '同上（年付档）',
    expiresWhen: '同上',
  },
  {
    cents: 3299,
    where: 'public/pay.html · Insider',
    reason: '同上（季付档，plans.ts 没有季度概念）',
    expiresWhen: '同上',
  },
]

/* ─────────────────────────── 解析 ─────────────────────────── */

/** 从 plans.ts 取 { id, monthlyCents, yearlyCents, saveClaimPct? } */
export function parsePlans(src) {
  const out = []
  const re = /id:\s*'([A-Z_]+)',[\s\S]{0,600}?priceCents:\s*\{\s*monthly:\s*(\d+),\s*yearly:\s*(\d+)\s*\}/g
  let m
  while ((m = re.exec(src))) {
    // 同一段里找 "save N%"
    const tail = src.slice(m.index, m.index + 900)
    const save = /save\s+(\d+)%/i.exec(tail)
    out.push({
      id: m[1],
      monthlyCents: Number(m[2]),
      yearlyCents: Number(m[3]),
      saveClaimPct: save ? Number(save[1]) : null,
    })
  }
  return out
}

/** 从 pay.html 取每个套餐的展示价、周期、省多少、折算月价 */
export function parsePayPage(html) {
  const out = []
  // 以 <div class="plan ..."> ... </div> 为块（页面结构简单，够用且不依赖 DOM 解析器）
  const blockRe = /<div class="plan[^"]*">([\s\S]*?)<a class="cta/g
  let m
  while ((m = blockRe.exec(html))) {
    const body = m[1]
    const amount = /<span class="amount">\$([\d.]+)<\/span>/.exec(body)
    if (!amount) continue
    const unit = /<span class="unit">([^<]*)<\/span>/.exec(body)
    const save = /Save\s+(\d+)%\s+vs monthly/i.exec(body)
    const equiv = /≈\s*\$([\d.]+)\s*\/\s*month/.exec(body)
    const name = /<h2>([^<]+)<\/h2>/.exec(body)
    out.push({
      name: name ? name[1] : '(未命名)',
      amountCents: Math.round(Number(amount[1]) * 100),
      unit: unit ? unit[1].trim() : '',
      saveClaimPct: save ? Number(save[1]) : null,
      equivMonthly: equiv ? Number(equiv[1]) : null,
    })
  }
  return out
}

/** 周期文本 → 月数（无法识别则 null，交给调用方判红，不默认成 1） */
export function monthsOf(unit) {
  const u = String(unit || '').toLowerCase()
  if (/\/\s*month/.test(u)) return 1
  if (/\/\s*year/.test(u)) return 12
  const q = /\/\s*(\d+)\s*months?/.exec(u)
  if (q) return Number(q[1])
  return null
}

/* ─────────────────────────── 分析 ─────────────────────────── */

export function analyze(plansSrc, payHtml, opts = {}) {
  const known = opts.known || KNOWN_PUBLIC_EXTRA
  const problems = []
  const notes = []

  const plans = parsePlans(plansSrc)
  if (plans.length === 0) problems.push('plans.ts 里一个套餐都没解析到（解析失效 = 没有门禁）')

  // 1) plans.ts 自身：年付折扣声明 vs 实算
  //    ⚠️ 年付档的 `priceCents.monthly` 通常是 0（它只卖年付）⇒ 参照月价必须取自
  //    **那个真正在卖的月付档**，不能拿自己的 0 去除（那样只会跳过，等于没检查）。
  //    本仓恰好只有一个 `monthlyCents > 0` 的档；多于一个时无法自动判定参照，
  //    此时判红要求显式映射 —— 猜一个参照算出来的红/绿都不可信。
  const monthlyPlans = plans.filter((p) => p.monthlyCents > 0)
  const monthlyRef = monthlyPlans.length === 1 ? monthlyPlans[0] : null
  if (plans.length > 0 && monthlyPlans.length > 1) {
    problems.push(
      `plans.ts 有 ${monthlyPlans.length} 个月付档（${monthlyPlans.map((p) => p.id).join('/')}）—— ` +
        `年付折扣无法确定参照月价，请显式映射后再判`,
    )
  }

  for (const p of plans) {
    if (!p.yearlyCents) continue
    if (p.saveClaimPct === null) {
      problems.push(`${p.id}：年付档没有 "save N%" 声明，无法核对折扣文案`)
      continue
    }
    if (!monthlyRef) continue
    const full = monthlyRef.monthlyCents * 12
    const actualPct = Math.round((1 - p.yearlyCents / full) * 100)
    if (Math.abs(actualPct - p.saveClaimPct) > 1) {
      problems.push(
        `${p.id}：文案写省 ${p.saveClaimPct}%，实算 ${actualPct}%` +
          `（年付 ${p.yearlyCents / 100} vs ${monthlyRef.id}×12 = ${full / 100}）`,
      )
    } else {
      notes.push(`${p.id}：年付省 ${actualPct}%（参照 ${monthlyRef.id}）与文案一致`)
    }
  }

  // 2) pay.html：金额 / 单位 / 折算月价 / 省多少
  const pay = parsePayPage(payHtml)
  if (pay.length === 0) problems.push('pay.html 里一个套餐都没解析到（解析失效 = 没有门禁）')

  const monthly = pay.find((x) => monthsOf(x.unit) === 1)
  if (pay.length > 0 && !monthly) {
    problems.push('pay.html 找不到月付档 —— 折扣与折算月价都失去参照')
  }

  for (const item of pay) {
    const months = monthsOf(item.unit)
    if (months === null || !Number.isFinite(months)) {
      problems.push(`pay.html「${item.name}」的计费周期 "${item.unit}" 无法识别，折算不了`)
      continue
    }
    if (item.equivMonthly !== null) {
      const actual = item.amountCents / 100 / months
      if (Math.abs(actual - item.equivMonthly) > 0.01) {
        problems.push(
          `pay.html「${item.name}」写 ≈$${item.equivMonthly.toFixed(2)}/月，` +
            `实算 $${actual.toFixed(2)}/月`,
        )
      }
    }
    if (item.saveClaimPct !== null) {
      if (!monthly) continue
      const full = monthly.amountCents * months
      const actualPct = Math.round((1 - item.amountCents / full) * 100)
      // NaN 会静默通过 `Math.abs(NaN - x) > 1`（NaN 与任何数比较都是 false）——
      // 本门禁第一版就栽在这里：`Number(true[1])` 得到 NaN，Insider 的
      // "省 15%" 被当成"一致"打印出去，而校验实际没做。非有限数必须显式判红。
      if (!Number.isFinite(actualPct)) {
        problems.push(
          `pay.html「${item.name}」折扣无法计算（金额 ${item.amountCents} 分 / 月付参照 ` +
            `${monthly.amountCents} 分 / ${months} 个月）—— 计算得到非有限数，拒绝按通过处理`,
        )
        continue
      }
      if (Math.abs(actualPct - item.saveClaimPct) > 1) {
        problems.push(
          `pay.html「${item.name}」写省 ${item.saveClaimPct}%，实算 ${actualPct}%` +
            `（${item.amountCents / 100} vs 月付×${months} = ${full / 100}）`,
        )
      } else {
        notes.push(`pay.html「${item.name}」省 ${actualPct}% 与文案一致`)
      }
    }
  }

  // 3) 跨面一致性：对外价格必须能溯源到 plans.ts，或已登记
  const planPrices = new Set()
  for (const p of plans) {
    if (p.monthlyCents) planPrices.add(p.monthlyCents)
    if (p.yearlyCents) planPrices.add(p.yearlyCents)
  }
  const knownPrices = new Set(known.map((k) => k.cents))

  for (const item of pay) {
    if (planPrices.has(item.amountCents)) continue
    if (knownPrices.has(item.amountCents)) {
      notes.push(`pay.html「${item.name}」$${item.amountCents / 100} 属已登记偏差`)
      continue
    }
    problems.push(
      `pay.html「${item.name}」$${item.amountCents / 100} 在 plans.ts 里找不到，也未登记 —— ` +
        `对外价格必须可溯源到单一配置源，否则改价时一定漏一处`,
    )
  }

  return { problems, notes, plans, pay }
}

/* ─────────────────────────── 自证 ─────────────────────────── */

const PLANS_FIXTURE = `
export const PLANS = {
  FREE: { id: 'FREE', priceCents: { monthly: 0, yearly: 0 }, notForSale: true },
  PREMIUM_MONTHLY: { id: 'PREMIUM_MONTHLY', priceCents: { monthly: 2000, yearly: 0 } },
  PREMIUM_YEARLY: { id: 'PREMIUM_YEARLY', description: 'yearly billing (save 40%)', priceCents: { monthly: 0, yearly: 14400 } },
}
`

const PAY_FIXTURE = `
<div class="plan">
  <h2>Monthly</h2><span class="amount">$20.00</span><span class="unit">/ month</span>
  <a class="cta ghost" href="#">go</a>
</div>
<div class="plan">
  <h2>Yearly</h2><span class="amount">$144.00</span><span class="unit">/ year</span>
  <div class="equiv">≈ $12.00 / month</div><div class="save">Save 40% vs monthly</div>
  <a class="cta primary" href="#">go</a>
</div>
`

function selfTest() {
  const results = []
  const ok = (name, cond, detail = '') => results.push({ name, pass: !!cond, detail })

  // 正例：算术自洽 + 价格可溯源 ⇒ 通过
  {
    const r = analyze(PLANS_FIXTURE, PAY_FIXTURE, { known: [] })
    ok('正例通过（省 40% / ≈$12.00/月 / 价格可溯源）', r.problems.length === 0, r.problems.join(' / '))
  }

  // 变异①：省多少算错
  {
    const bad = PAY_FIXTURE.replace('Save 40% vs monthly', 'Save 30% vs monthly')
    const r = analyze(PLANS_FIXTURE, bad, { known: [] })
    ok('变异①：折扣文案算错 → 红', r.problems.some((p) => p.includes('30%')))
  }

  // 变异②：折算月价算错
  {
    const bad = PAY_FIXTURE.replace('≈ $12.00 / month', '≈ $10.00 / month')
    const r = analyze(PLANS_FIXTURE, bad, { known: [] })
    ok('变异②：折算月价算错 → 红', r.problems.some((p) => p.includes('≈$10.00')))
  }

  // 变异③：对外价格在配置源里找不到且未登记
  {
    const bad = PAY_FIXTURE.replace('$144.00', '$133.00').replace('≈ $12.00 / month', '≈ $11.08 / month')
    const r = analyze(PLANS_FIXTURE, bad, { known: [] })
    ok('变异③：未登记的新价格 → 红', r.problems.some((p) => p.includes('未登记')))
  }

  // 变异④：登记之后必须放行（证明"登记"这条机制真的有效，不是摆设）
  {
    const bad = PAY_FIXTURE.replace('$144.00', '$133.00').replace('≈ $12.00 / month', '≈ $11.08 / month').replace('Save 40% vs monthly', 'Save 45% vs monthly')
    const r = analyze(PLANS_FIXTURE, bad, { known: [{ cents: 13300, where: 'x', reason: 'y', expiresWhen: 'z' }] })
    ok('变异④：已登记偏差不再报"未登记"', !r.problems.some((p) => p.includes('未登记')), r.problems.join(' / '))
  }

  // 变异⑤：plans.ts 的折扣声明与实算不符
  {
    const bad = PLANS_FIXTURE.replace('save 40%', 'save 25%')
    const r = analyze(bad, PAY_FIXTURE, { known: [] })
    ok('变异⑤：plans.ts 折扣声明算错 → 红', r.problems.some((p) => p.includes('PREMIUM_YEARLY')))
  }

  // 变异⑥：解析失效（空文档）必须红 —— 空集恒真防线
  {
    const r = analyze('', '', { known: [] })
    ok('变异⑥：两份文档都解析出 0 条 → 红', r.problems.length >= 2)
  }

  // 变异⑦：周期无法识别 ⇒ 不猜成 1 个月
  {
    const bad = PAY_FIXTURE.replace('/ year', '/ fortnight')
    const r = analyze(PLANS_FIXTURE, bad, { known: [] })
    ok('变异⑦：周期不可识别 → 红（不默认成月付）', r.problems.some((p) => p.includes('无法识别')))
  }

  // 变异⑧：折扣算出非有限数时必须显式判红。
  //   🔴 这是本门禁第一版真实踩到的坑：`Math.abs(NaN - 15) > 1` 恒为 false
  //   ⇒ "省 15%" 被当成"一致"打印出去，而校验根本没做。用 $0 月付参照构造 -Infinity。
  {
    const bad = PAY_FIXTURE.replace('<span class="amount">$20.00</span>', '<span class="amount">$0.00</span>')
    const r = analyze(PLANS_FIXTURE, bad, { known: [] })
    ok(
      '变异⑧：折扣算出非有限数 → 红（NaN/Infinity 不得静默通过）',
      r.problems.some((p) => p.includes('非有限数')),
      r.problems.join(' / '),
    )
  }

  const failed = results.filter((r) => !r.pass)
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`)
  console.log(`\n自证：${results.length - failed.length}/${results.length} 通过`)
  return failed.length === 0 ? 0 : 1
}

/* ─────────────────────────── main ─────────────────────────── */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (process.argv.includes('--self-test')) process.exit(selfTest())

  const plansAbs = path.join(ROOT, PLANS_FILE)
  const payAbs = path.join(ROOT, PAY_FILE)
  for (const p of [plansAbs, payAbs]) {
    if (!fs.existsSync(p)) {
      console.error(`🔴 缺文件：${path.relative(ROOT, p)}`)
      process.exit(1)
    }
  }

  const { problems, notes, plans, pay } = analyze(
    fs.readFileSync(plansAbs, 'utf8'),
    fs.readFileSync(payAbs, 'utf8'),
  )

  console.log(`plans.ts 套餐 ${plans.length} 个：${plans.map((p) => p.id).join(' / ')}`)
  console.log(`pay.html 套餐 ${pay.length} 个：${pay.map((p) => p.name).join(' / ')}`)
  console.log(`已登记偏差 ${KNOWN_PUBLIC_EXTRA.length} 条`)
  for (const n of notes) console.log(`  · ${n}`)

  if (problems.length) {
    for (const p of problems) console.error(`  🔴 ${p}`)
    console.error(`\n定价一致性不合格：${problems.length} 处`)
    process.exit(1)
  }
  console.log('\n✅ 定价一致性通过：折扣文案算术自洽、对外价格均可溯源或已登记')
}
