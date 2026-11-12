#!/usr/bin/env node
/**
 * S-03 · 生产 `/pricing` 页面缺陷探针（只读，不需登录）
 *
 * 背景：hotfix 分支的浏览器冒烟红在 6 例，全部指向 `/pricing`：
 *   ① 定价未获批却仍渲染 `$49.00` 等金额；
 *   ② 「需要采购/发票/年度合同？联系我们」链接高度 20px，违反 WCAG 2.2 AA 2.5.8（触控目标 ≥24px）。
 *
 * 为什么单独探生产：必须回答"这是 hotfix 引入的，还是线上本来就有"。
 * 本脚本对**线上域名**做同一测量，不依赖登录夹具、不改动任何内容。
 *
 * 用法:
 *   PW_CHANNEL=chrome node scripts/qa/s03-pricing-page-probe.mjs --base=https://app.lokfeel.com --out=evidence.json
 */

import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const arg = (name, fallback) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

/** 判定层（纯函数）：给定观测值，返回缺陷清单。 */
export function judgePricingProbe(obs) {
  const defects = []
  if (obs.httpStatus !== 200) defects.push({ code: 'not_200', detail: `status=${obs.httpStatus}` })
  if (/\$\s?\d/.test(obs.bodyText || '')) {
    const m = (obs.bodyText || '').match(/\$\s?\d[\d,.]*/)
    defects.push({ code: 'price_amount_visible', detail: m ? m[0] : 'amount' })
  }
  for (const t of obs.smallTargets || []) {
    defects.push({ code: 'touch_target_under_24px', detail: `${t.label} [${t.w}×${t.h}]` })
  }
  return { verdict: defects.length ? 'DEFECTS_PRESENT' : 'CLEAN', defects }
}

async function main() {
  const base = arg('base', 'https://app.lokfeel.com')
  const out = arg('out', '')
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {})
  const obs = { checkedAt: new Date().toISOString(), base, url: `${base}/pricing` }
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const res = await page.goto(`${base}/pricing`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    obs.httpStatus = res?.status() ?? 0
    obs.finalPath = new URL(page.url()).pathname
    obs.bodyText = (await page.locator('body').innerText()).slice(0, 4000)
    obs.smallTargets = await page.evaluate(() => {
      const out = []
      for (const a of document.querySelectorAll('a')) {
        const r = a.getBoundingClientRect()
        if (r.width > 0 && r.height > 0 && r.height < 24) {
          out.push({ label: (a.textContent || '').trim().slice(0, 60), w: Math.round(r.width), h: Math.round(r.height) })
        }
      }
      return out
    })
    Object.assign(obs, judgePricingProbe(obs))
  } catch (e) {
    obs.verdict = 'ERROR'
    obs.error = String(e?.message ?? e)
  } finally {
    await browser.close()
  }
  const printed = JSON.stringify(obs, null, 2)
  process.stdout.write(`${printed}\n`)
  if (out) writeFileSync(out, `${printed}\n`, 'utf8')
  process.exitCode = obs.verdict === 'CLEAN' ? 0 : obs.verdict === 'DEFECTS_PRESENT' ? 2 : 1
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main()
