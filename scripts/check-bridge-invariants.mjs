#!/usr/bin/env node
/**
 * T10 · Community Bridge 内核不变量门禁
 * -------------------------------------
 * 与 `check-agent-invariants.mjs`（T09）同一结构、同一自证手法。扫描 `src/lib/bridge/**`：
 *
 *   B1  不得 import `@/lib/tenancy`（或其子路径）
 *       —— **授权不属于内核**。能力判定必须在 API 层（`withTenant(capability)`）发生。
 *          跨群共享的判断尤其如此：一旦内核能拿到 capability，
 *          「三方交集」就可能被"用配置喂出来的权限"覆盖。
 *
 *   B2  不得 import `@/lib/db` / `@/lib/prisma` / `@prisma/*`
 *       —— 内核保持**纯净**（无 IO）。🔴 这条同时是 AC-19「**不得直接查询对方私有行**」
 *          的第一道结构性保证：内核里**写不出** `prisma.socialIntent.findMany({
 *          where: { organizationId: partnerOrg } })` 这样的代码。
 *          真正的跨群读取只存在于服务层（`src/lib/bridges/discovery.ts`），
 *          且出口必经 `discloseSubject()` 投影。
 *
 *   B3  不得 `dangerouslySetInnerHTML` / `eval` / `new Function`
 *       —— 与 A3 同一取向（保守取严）：本目录不渲染 HTML、不执行动态代码。
 *
 *   B4  不得 `setTimeout` / `setInterval`
 *       —— 与 A4 同一理由：不得用定时器伪造"授权仍有效"。撤销即刻生效的保证
 *          来自**每次投影实时读 DB**，而不是"定时刷新"。
 *
 *   B5  不得出现任何**网络调用**（`fetch` / `XMLHttpRequest` / `node:http(s)` /
 *       `undici` / `axios` / `node-fetch` / `got`）
 *       —— 与 A5 同一理由：「内核无 IO」必须是**可执行**的性质（跑内核单测
 *          不需要网络、不需要凭据），一旦这里出现 `fetch`，这条保证就退化成口号。
 *          ⚠️ 本规则是**文本级**的（`\bfetch\b` 即命中，含 `typeof fetch`）。
 *
 * 自证：`node scripts/check-bridge-invariants.mjs --self-test`
 *   在扫描目录内写**单条违反**的临时文件 → 断言 exit 1 且命中对应 `[Bn]`；
 *   再写**合法**文件做负向对照（必须仍 exit 0）；`finally` 删除。
 *
 * 退出码：0 = 通过；1 = 有违规或自证失败。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SCOPE = 'src/lib/bridge'
const SCOPE_DIR = path.join(ROOT, SCOPE)

const problems = []
const checked = []

/** 剥离注释（保留换行与偏移），避免注释里的散文被当成真代码命中。 */
function stripComments(code) {
  let out = ''
  let i = 0
  const n = code.length
  let state = 'code'
  while (i < n) {
    const c = code[i]
    const c2 = code[i + 1]
    if (state === 'code') {
      if (c === '/' && c2 === '/') {
        state = 'line'
        out += '  '
        i += 2
        continue
      }
      if (c === '/' && c2 === '*') {
        state = 'block'
        out += '  '
        i += 2
        continue
      }
      if (c === "'") state = 's'
      else if (c === '"') state = 'd'
      else if (c === '`') state = 't'
      out += c
      i += 1
      continue
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code'
        out += c
      } else out += ' '
      i += 1
      continue
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') {
        state = 'code'
        out += '  '
        i += 2
        continue
      }
      out += c === '\n' ? '\n' : ' '
      i += 1
      continue
    }
    out += c
    if (c === '\\') {
      out += c2 ?? ''
      i += 2
      continue
    }
    if ((state === 's' && c === "'") || (state === 'd' && c === '"') || (state === 't' && c === '`')) {
      state = 'code'
    }
    i += 1
  }
  return out
}

function walk(dir) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir.replace(/\/+$/, '')}/${entry.name}`
    if (entry.isDirectory()) walk(rel)
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) checkFile(rel)
  }
}

function checkFile(rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const src = stripComments(raw)
  const lines = src.split('\n')
  checked.push(rel)

  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`
    if (/from\s+['"]@\/lib\/tenancy(\/|['"])/.test(line)) {
      problems.push(`[B1] ${at} 内核引入了 @/lib/tenancy —— 授权不属于 Bridge 内核，必须在 API 层判定`)
    }
    if (/from\s+['"](@\/lib\/db|@\/lib\/prisma|@prisma\/[^'"]+)['"]/.test(line)) {
      problems.push(
        `[B2] ${at} 内核引入了数据库模块 —— 内核必须无 IO；这也是「不得直接查询对方私有行」的结构保证`,
      )
    }
    if (/dangerouslySetInnerHTML/.test(line)) {
      problems.push(`[B3] ${at} 使用了 dangerouslySetInnerHTML`)
    }
    if (/\bnew\s+Function\s*\(/.test(line) || /\beval\s*\(/.test(line)) {
      problems.push(`[B3] ${at} 使用了 eval / new Function`)
    }
    if (/\bset(Timeout|Interval)\s*\(/.test(line)) {
      problems.push(
        `[B4] ${at} 使用了 setTimeout/setInterval —— 撤销即刻生效靠实时读 DB，不靠定时器`,
      )
    }
    if (/\bfetch\b/i.test(line)) {
      problems.push(`[B5] ${at} 内核出现了 fetch —— 网络调用不属于内核`)
    }
    if (/\bnew\s+XMLHttpRequest\b/.test(line)) {
      problems.push(`[B5] ${at} 内核出现了 XMLHttpRequest`)
    }
    if (/from\s+['"](?:node:)?https?['"]/.test(line) || /from\s+['"](?:undici|axios|node-fetch|got|ky)['"]/.test(line)) {
      problems.push(`[B5] ${at} 内核引入了网络库/网络模块`)
    }
  })
}

/** 自证脚本若被中断会留下 `__mutant-*` 文件 —— 必须主动报错（理由同 agent 版）。 */
function findLeftovers() {
  const abs = path.join(ROOT, SCOPE)
  if (!fs.existsSync(abs)) return []
  return fs
    .readdirSync(abs)
    .filter((f) => f.startsWith('__mutant-bridge-'))
    .map((f) => `${SCOPE}/${f}`)
}

function run() {
  problems.length = 0
  checked.length = 0
  walk(SCOPE)
  if (!SELF_TEST_RUN) {
    for (const f of findLeftovers()) {
      problems.push(`[B0] ${f} 存在残留的变异文件（自证脚本被中断所致）—— 删除它再提交`)
    }
  }
  return problems.length === 0
}

// ── 自证模式 ──────────────────────────────────────────────────────────
const SELF_TEST = process.argv.includes('--self-test')
const SELF_TEST_RUN = process.env.LF_INVARIANT_SELF_TEST === '1'

const MUTANTS = [
  { rule: 'B1', body: `import { assertCapability } from '@/lib/tenancy'\nexport const x = assertCapability\n` },
  { rule: 'B2', body: `import { db } from '@/lib/db'\nexport const x = db\n` },
  { rule: 'B3', body: `export const F = (html: string) => <div dangerouslySetInnerHTML={{ __html: html }} />\n` },
  { rule: 'B4', body: `export const x = () => setTimeout(() => {}, 0)\n` },
  { rule: 'B5', body: `export const call = (url: string) => fetch(url, { method: 'POST' })\n` },
]
const CONTROL = `export const ok = { note: '合法文件：不违反任何一条' }\n`
const PREFIX = '__mutant-bridge-'

const created = []
function cleanup() {
  for (const p of created) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch (err) {
      console.error(`⚠️  临时文件删除失败（请手动删除）：${p} — ${err.message}`)
    }
  }
}

function runScript() {
  return spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, LF_INVARIANT_SELF_TEST: '1' },
  })
}

function selfTest() {
  const failures = []
  const baseline = runScript()
  console.log(`基线（无变异）：exit=${baseline.status}`)
  if (baseline.status !== 0) {
    console.error(baseline.stdout)
    console.error(baseline.stderr)
    console.error('❌ 基线就不通过 —— 先修好真实代码再做自证。')
    return 1
  }

  try {
    const controlPath = path.join(SCOPE_DIR, `${PREFIX}control.tsx`)
    fs.writeFileSync(controlPath, CONTROL, 'utf8')
    created.push(controlPath)
    const control = runScript()
    if (control.status !== 0 || !control.stdout.includes(`${PREFIX}control.tsx`)) {
      failures.push(`[对照] 合法文件被误报，或未被扫描到（exit=${control.status}）`)
    } else {
      console.log('✅ 负向对照：合法文件未误报且确实被扫描到')
    }
    fs.unlinkSync(controlPath)
    created.splice(created.indexOf(controlPath), 1)

    for (const m of MUTANTS) {
      const p = path.join(SCOPE_DIR, `${PREFIX}${m.rule.toLowerCase()}.tsx`)
      fs.writeFileSync(p, m.body, 'utf8')
      created.push(p)
      const res = runScript()
      const out = `${res.stdout}\n${res.stderr}`
      const scanned = res.stdout.includes(path.basename(p))
      const fired = out.includes(`[${m.rule}]`)
      if (!scanned) failures.push(`[${m.rule}] 变异文件未被扫描到`)
      if (res.status !== 1) failures.push(`[${m.rule}] 注入违反后 exit=${res.status}（应为 1）`)
      if (!fired) failures.push(`[${m.rule}] 输出未命中 [${m.rule}]`)
      if (scanned && fired && res.status === 1) console.log(`✅ ${m.rule} 变异被捕获（exit=1，命中 [${m.rule}]）`)
      fs.unlinkSync(p)
      created.splice(created.indexOf(p), 1)
    }
  } finally {
    cleanup()
    const after = runScript()
    console.log(`\n收尾复验（清理后）：exit=${after.status}`)
    if (after.status !== 0) failures.push('清理后仍不通过 —— 可能残留变异文件')
  }

  if (failures.length > 0) {
    console.error(`\n❌ Bridge 不变量自证未通过（${failures.length} 项）：`)
    for (const f of failures) console.error(`  · ${f}`)
    return 1
  }
  console.log(
    `\n✅ Bridge 不变量自证通过：${MUTANTS.length} 条规则（B1–B5）全部被证明生效；合法文件未误报；临时文件已清理。`,
  )
  return 0
}

if (SELF_TEST) {
  if (!fs.existsSync(SCOPE_DIR)) {
    console.error(`❌ 扫描目录不存在：${SCOPE_DIR}`)
    process.exit(1)
  }
  process.exit(selfTest())
}

const ok = run()

if (checked.length === 0) {
  console.error(`❌ 未扫描到任何文件 —— 检查 SCOPE 配置：${SCOPE}`)
  process.exit(1)
}

console.log(`扫描 ${checked.length} 个文件：`)
for (const f of checked) console.log(`  · ${f}`)

if (!ok) {
  console.error(`\n❌ Bridge 不变量未通过（${problems.length} 处）：`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

console.log(
  `\n✅ Bridge 不变量全部通过（B1 内核不碰授权 · B2 内核无 IO＝不得直查对方私有行的结构保证 · B3 不渲染动态 HTML · B4 无定时器伪生效 · B5 内核无网络调用）`,
)
