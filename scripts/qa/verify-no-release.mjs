#!/usr/bin/env node
/**
 * 只读 QA：确认某次推送**没有**触发 Netlify 构建（即 `[skip netlify]` 生效）
 *
 * 为什么需要它：本项目采用「可发版但未发版」策略 —— 大部分提交带 `[skip netlify]`，
 * 只有真正的发布提交才触发构建。**"我以为它跳过了"不是证据**：必须能查到
 * 站点部署列表里**没有**那个 commit 的记录。
 *
 * 🔴 凭据**只从环境变量读**，绝不写进文件（本仓库是 public）：
 *     NETLIFY_AUTH_TOKEN=<token> NETLIFY_SITE_ID=<site uuid> node scripts/qa/verify-no-release.mjs
 *
 * ⚠️ 网络通道（本机实测，踩了两次才定下来）：
 *   - Node 内置 `fetch`（undici）**默认不读** `HTTP(S)_PROXY`；即便显式装 `ProxyAgent`，
 *     在本沙箱里仍 `UND_ERR_CONNECT_TIMEOUT`（实测 3/3 失败）。
 *   - `curl -x http://127.0.0.1:10808` 可以通，但**时通时断**（同一命令：一次 30s 超时、一次秒回）。
 *   ⇒ 本脚本用 **curl**（与 `scripts/push-main.sh` 同一取向），并按
 *     「显式 --proxy → LOKFEEL_PROXY_URL → 127.0.0.1:LOKFEEL_PROXY_PORT(默认 10808) → 直连」
 *     逐通道、每通道重试，直到拿到合法 JSON。
 *
 * 可选参数：
 *   --commit=<sha>   要确认"未部署"的提交（缺省 = 当前 HEAD）
 *   --site=<uuid>    站点 id（缺省 = 环境变量 NETLIFY_SITE_ID）
 *   --expect=<sha>   期望的"最新部署提交"前缀（缺省只打印，不断言）
 *   --proxy=<url>    显式代理地址
 *
 * 退出码：0 = 未见该提交的部署（skip 生效）· 1 = 出现了该提交的部署（⚠️ 误发版）· 2 = 用法/凭据/网络问题
 */

import { execFileSync, execSync } from 'node:child_process'

function argOf(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const token = process.env.NETLIFY_AUTH_TOKEN?.trim()
const site = (argOf('site') ?? process.env.NETLIFY_SITE_ID ?? '').trim()

if (!token || !site) {
  console.error(
    '用法：NETLIFY_AUTH_TOKEN=… NETLIFY_SITE_ID=… node scripts/qa/verify-no-release.mjs [--commit=<sha>] [--expect=<sha>]',
  )
  console.error('（凭据只从环境变量读 —— 本仓库是 public，不得把 token 写进文件）')
  process.exit(2)
}

function currentHead() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

/** 依次尝试的通道：显式代理 → 本机代理 → 直连。 */
function channels() {
  const explicit = argOf('proxy') ?? process.env.LOKFEEL_PROXY_URL
  const port = process.env.LOKFEEL_PROXY_PORT ?? '10808'
  const list = [explicit, `http://127.0.0.1:${port}`, null]
  return list.filter((v, i) => v !== undefined && list.indexOf(v) === i)
}

const commit = (argOf('commit') ?? currentHead()).trim().slice(0, 9)
if (!commit) {
  console.error('无法确定要核查的 commit —— 请显式传 --commit=<sha>')
  process.exit(2)
}
const expect = argOf('expect')
const url = `https://api.netlify.com/api/v1/sites/${site}/deploys?per_page=10`
const ATTEMPTS = 3

let raw = null
let probe = null
outer: for (const proxy of channels()) {
  console.log(`（通道：${proxy ?? '直连'}）`)
  for (let i = 1; i <= ATTEMPTS; i++) {
    const args = ['-sS', '--max-time', '20', '-H', `Authorization: Bearer ${token}`, url]
    if (proxy) args.unshift('-x', proxy)
    else args.unshift('--noproxy', '*')
    try {
      const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
      if (out.trimStart().startsWith('[')) {
        raw = out
        break outer
      }
      probe = out.slice(0, 200) || '(空响应)'
      console.log(`  第 ${i}/${ATTEMPTS} 次：响应不是 JSON —— ${probe}`)
    } catch (err) {
      probe = (err.stderr ?? err.message ?? '').toString().trim().slice(0, 160)
      console.log(`  第 ${i}/${ATTEMPTS} 次失败：${probe}`)
    }
  }
}

if (!raw) {
  console.error(`\n🔴 所有通道均无法访问 api.netlify.com（最后错误：${probe ?? '未知'}）`)
  console.error('   排查：本机代理是否在跑（v2rayN / Clash）；或传 --proxy=<url>。')
  process.exit(2)
}

const deploys = JSON.parse(raw)
console.log(`\n核查 commit=${commit}（站点 ${site}）\n`)
for (const d of deploys) {
  const when = d.created_at ? new Date(d.created_at).toISOString() : '-'
  console.log(
    `  ${when}  state=${String(d.state).padEnd(9)} commit=${String(d.commit_ref ?? '-').slice(0, 9).padEnd(9)} ` +
      `title=${String(d.title ?? '').split('\n')[0].slice(0, 50)}`,
  )
}

const hit = deploys.find((d) => String(d.commit_ref ?? '').startsWith(commit))
const head = deploys[0]
console.log()
if (head) console.log(`最新部署：commit=${String(head.commit_ref ?? '-').slice(0, 9)} state=${head.state}`)
if (expect && head && !String(head.commit_ref ?? '').startsWith(expect)) {
  console.log(`⚠️ 最新部署不是期望的 ${expect} —— 可能被后续推送覆盖了`)
}

if (hit) {
  console.log(`🔴 出现了 commit ${commit} 的部署（state=${hit.state}）⇒ 该提交**触发了构建**，skip 未生效。`)
  process.exit(1)
}
console.log(`✅ 未见 commit ${commit} 的部署记录 ⇒ [skip netlify] 生效，生产未被触发（保持"可发版未发版"）。`)
