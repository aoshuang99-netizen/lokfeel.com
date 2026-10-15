#!/usr/bin/env node
/**
 * T09 · Agent 内核不变量门禁
 * ---------------------------
 * 目的：把 `docs/implementation/T09/plan.md` §2 里"防线是**不存在的代码路径**"这句话
 * 变成**可复跑的检查**，而不是只写在文档里靠人记。
 *
 * 规则（扫描 `src/lib/agent/**`）：
 *
 *   A1  不得 import `@/lib/tenancy`（或其子路径）
 *       —— **授权不属于内核**。能力判定必须在 API 层（`withTenant(capability)`）发生。
 *          内核一旦能拿到 capability，就会有人用**模型输出**去喂它。
 *
 *   A2  不得 import `@/lib/db` / `@/lib/prisma` / `@prisma/*`
 *       —— 内核保持**纯净**（Slice 1 无 IO）。持久化归 Slice 2 的仓储层，
 *          这样 `runSkill()` 才能在无数据库的情况下被单测完整覆盖。
 *
 *   A3  不得 `dangerouslySetInnerHTML` / `eval` / `new Function`
 *       —— 模型输出**只能**经 zod 校验后当数据用，绝不能当代码执行。
 *
 *   A4  不得 `setTimeout` / `setInterval`
 *       —— 与 UI 门禁 R1 同一理由：不得用定时器伪造"执行成功"。
 *
 *   A5  不得出现任何**网络调用**（`fetch` / `XMLHttpRequest` / `node:http(s)` /
 *       `undici` / `axios` / `node-fetch` / `got`）
 *       —— Slice 3 把真实模型端点接上了（`src/lib/agents/provider-openai.ts`）。
 *          它**刻意**放在**服务层**（复数目录）：内核的"无 IO"必须是**可执行**的性质
 *          （跑内核单测不需要网络、不需要凭据），一旦这里出现 `fetch`，
 *          "内核纯净"就从性质退化成口号 —— 而 A2 只挡数据库，挡不住网络。
 *          因此判据（认哪个 env 键、默认模型、超时）留内核，
 *          **怎么打**（HTTP 请求与响应解析）留在服务层。
 *          ⚠️ 本规则是**文本级**的（`\bfetch\b` 即命中，含 `typeof fetch` 这类类型引用）：
 *             保守取严 —— 内核本来就不需要提到它；要提就说明边界该重新讨论。
 *
 * 自证：`node scripts/check-agent-invariants.mjs --self-test`
 *   在扫描目录内写**单条违反**的临时文件 → 断言 exit 1 且命中对应 `[An]`；
 *   再写**合法**文件做负向对照（必须仍 exit 0）；`finally` 删除。
 *   （理由同 `verify-ui-invariants-mutation.mjs`：门禁"通过"不能证明"规则生效"。）
 *
 * 退出码：0 = 通过；1 = 有违规或自证失败。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SCOPE = 'src/lib/agent'
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
      problems.push(`[A1] ${at} 内核引入了 @/lib/tenancy —— 授权不属于 Agent 内核，必须在 API 层判定`)
    }
    if (/from\s+['"](@\/lib\/db|@\/lib\/prisma|@prisma\/[^'"]+)['"]/.test(line)) {
      problems.push(`[A2] ${at} 内核引入了数据库模块 —— Slice 1 内核必须保持纯净（无 IO）`)
    }
    if (/dangerouslySetInnerHTML/.test(line)) {
      problems.push(`[A3] ${at} 使用了 dangerouslySetInnerHTML`)
    }
    if (/\bnew\s+Function\s*\(/.test(line) || /\beval\s*\(/.test(line)) {
      problems.push(`[A3] ${at} 使用了 eval / new Function —— 模型输出不得当代码执行`)
    }
    if (/\bset(Timeout|Interval)\s*\(/.test(line)) {
      problems.push(`[A4] ${at} 使用了 setTimeout/setInterval —— 不得用定时器伪造执行成功`)
    }
    if (/\bfetch\b/i.test(line)) {
      problems.push(`[A5] ${at} 内核出现了 fetch —— 网络调用属服务层（src/lib/agents/provider-openai.ts）`)
    }
    if (/\bnew\s+XMLHttpRequest\b/.test(line)) {
      problems.push(`[A5] ${at} 内核出现了 XMLHttpRequest —— 网络调用属服务层`)
    }
    if (/from\s+['"](?:node:)?https?['"]/.test(line) || /from\s+['"](?:undici|axios|node-fetch|got|ky)['"]/.test(line)) {
      problems.push(`[A5] ${at} 内核引入了网络库/网络模块 —— 网络调用属服务层`)
    }
  })
}

/**
 * 自证脚本若被**中断**（沙箱重试 / Ctrl-C / OOM 被杀），会留下 `__mutant-*` 文件。
 * 它会被后续扫描当"正常文件"，甚至被 `git add -A` 提交 —— 所以**必须主动报错**。
 * （本仓实测踩过一次：残留导致扫描列表里凭空多出一个文件。）
 */
function findLeftovers() {
  const abs = path.join(ROOT, SCOPE)
  if (!fs.existsSync(abs)) return []
  return fs
    .readdirSync(abs)
    .filter((f) => f.startsWith('__mutant-agent-'))
    .map((f) => `${SCOPE}/${f}`)
}

function run() {
  problems.length = 0
  checked.length = 0
  walk(SCOPE)
  // 自证模式**自己**会创建这些文件 → 跳过残留检测；正常模式下一律视为错误。
  if (!SELF_TEST_RUN) {
    for (const f of findLeftovers()) {
      problems.push(`[A0] ${f} 存在残留的变异文件（自证脚本被中断所致）—— 删除它再提交`)
    }
  }
  return problems.length === 0
}

// ── 自证模式 ──────────────────────────────────────────────────────────
const SELF_TEST = process.argv.includes('--self-test')
/** 父进程 spawn 子进程时注入 `LF_INVARIANT_SELF_TEST=1` → 子进程跳过残留检测。 */
const SELF_TEST_RUN = process.env.LF_INVARIANT_SELF_TEST === '1'

const MUTANTS = [
  { rule: 'A1', body: `import { assertCapability } from '@/lib/tenancy'\nexport const x = assertCapability\n` },
  { rule: 'A2', body: `import { db } from '@/lib/db'\nexport const x = db\n` },
  { rule: 'A3', body: `export const F = (html: string) => <div dangerouslySetInnerHTML={{ __html: html }} />\n` },
  { rule: 'A4', body: `export const x = () => setTimeout(() => {}, 0)\n` },
  { rule: 'A5', body: `export const call = (url: string) => fetch(url, { method: 'POST' })\n` },
]
const CONTROL = `export const ok = { note: '合法文件：不违反任何一条' }\n`
const PREFIX = '__mutant-agent-'

const created = []

/**
 * 删除一个临时文件。**删除失败不是致命错误**：本机可能启用了删除守卫
 * （`CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD`），此时 unlinkSync 会抛错。
 * 把裸 unlinkSync 写进自证正文会让脚本**以 shim 崩溃栈退出** —— 那会把
 * 「环境限制」伪装成「脚本 bug」，掩盖真正要看的信号。这里退化为
 * 「警告 + 保留在 created 里」，交给收尾复验兜底报红。
 */
function removeNow(p) {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p)
  } catch (err) {
    console.error(`⚠️  临时文件删除失败（请手动删除）：${p} — ${err.message}`)
    return false
  }
  const i = created.indexOf(p)
  if (i >= 0) created.splice(i, 1)
  return true
}

function cleanup() {
  for (const p of [...created]) removeNow(p)
}

function runScript() {
  return spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: ROOT,
    encoding: 'utf8',
    // 告诉子进程"这是自证的一部分" → 允许 `__mutant-*` 文件存在（否则 A0 会把它自己判失败）。
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
    removeNow(controlPath)

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
      removeNow(p)
    }
  } finally {
    cleanup()
    const after = runScript()
    console.log(`\n收尾复验（清理后）：exit=${after.status}`)
    if (after.status !== 0) failures.push('清理后仍不通过 —— 可能残留变异文件')
  }

  if (failures.length > 0) {
    console.error(`\n❌ Agent 不变量自证未通过（${failures.length} 项）：`)
    for (const f of failures) console.error(`  · ${f}`)
    return 1
  }
  console.log(`\n✅ Agent 不变量自证通过：${MUTANTS.length} 条规则（A1–A5）全部被证明生效；合法文件未误报；临时文件已清理。`)
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
  console.error(`\n❌ Agent 不变量未通过（${problems.length} 处）：`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

  console.log(
    `\n✅ Agent 不变量全部通过（A1 内核不碰授权 · A2 内核无 IO · A3 模型输出不当代码 · A4 无定时器伪成功 · A5 内核无网络调用）`,
  )
