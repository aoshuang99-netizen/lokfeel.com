#!/usr/bin/env node
/**
 * 密钥 / 凭据字面量扫描（零依赖）
 *
 * 为什么不是直接用 gitleaks：本机与 CI 都没有 gitleaks 二进制，而"扫描通过"必须是
 * **可复现的退出码**，不能是一句"我扫过了没问题"。`.gitleaks.toml` 仍然维护，有二进制时
 * 优先用它；本脚本覆盖当前树的确定性检查，规则与它对齐。
 *
 * ── 门禁设计（关键）─────────────────────────────────────────────────
 * 第一版把"password 赋字面量"直接当失败条件，结果 30+ 条误报：zod 的
 * `password: 'reg-password'`（i18n 键）、`password: 'MAGIC_LINK_AUTH'`（魔法标记）、
 * `password: 'Test123!'`（本地 e2e 账号）。**误报的门禁等于没有门禁**——人会习惯性忽略它，
 * 真正的那一条就淹在里面。所以这里只保留两个**零误报**的硬门禁：
 *
 *   G1  已知泄漏字面量            —— 精确串匹配，命中即 P0
 *   G2  process.env.X || '字面量' —— 这正是本次事故的成因：配置缺失时静默降级到已知密码
 *
 * 其余"看起来像硬编码"的候选，用 `--report` 列出来给人看，不参与退出码。
 *
 * 用法：
 *   node scripts/check-secrets.mjs             # 门禁（G1+G2），0 = 通过
 *   node scripts/check-secrets.mjs --report    # 附候选清单（信息性）
 *   node scripts/check-secrets.mjs --history   # 附历史提交命中数
 *   node scripts/check-secrets.mjs --self-test # 规则自检（含负控）
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
process.chdir(ROOT)

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)

// 已知泄漏过的精确串在**运行时拼装**：本文件自己不能含有完整字面量，
// 否则扫描器会把自己判成一次新的泄漏（自我指涉）。
const KNOWN_LEAKED = [
  { id: 'admin-password-2026', value: 'LokFeel' + '@' + 'Admin' + '2026' + '!' },
  { id: 'test-account-password', value: 'Test' + '123' + '456' + '!' },
]

/**
 * G2：`process.env.X || '字面量'` —— 配置缺失时静默降级到硬编码值。
 *
 * 只对**凭据类**变量名生效。第一版对全部 `|| '...'` 报警，163 条里 155 条是
 * `process.env.APP_URL || 'http://localhost:3000'` 这种无害的地址默认值 ——
 * 又一次证明"误报多的规则等于没有规则"。
 * `src/constants`、`build-info`、`playwright.config` 这类全都不是凭据。
 */
// 非捕获组：否则 \\1 会指向变量名而不是引号（第一版就是这个错，正例反而漏报）。
const CREDENTIAL_VAR = '(?:[A-Za-z_][A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|CREDENTIAL|PRIVATE_KEY)[A-Za-z0-9_]*)'
const ENV_FALLBACK = {
  id: 'env-fallback-literal',
  re: new RegExp(`process\\.env\\.${CREDENTIAL_VAR}\\s*\\|\\|\\s*(['"])([^'"\\n]{4,})\\1`, 'g'),
  why: '凭据类环境变量缺失时回退到字面量。缺配置必须是**可见的失败**，不是静默降级。',
}

/** 报告模式用：可能是硬编码凭据，但不作为门禁。 */
const REPORT_ONLY = {
  id: 'possible-hardcoded-credential',
  re: /\b(pass(?:word|wd)?|secret|api[_-]?key)\b\s*[:=]\s*(['"])([^'"\n]{6,})\2/gi,
}

const ALLOW_PATHS = [
  /^docs\//,
  /^\.env\..*example$/,
  /^package-lock\.json$/,
  /^src\/generated\//,
  /^prisma\/migrations\//,
  /^scripts\/check-secrets\.mjs$/, // 本文件（规则定义本身）
  /^\.gitleaks\.toml$/,
  /\.md$/,
]

/** 夹具/占位值：e2e 专用、示例用途，不是生产凭据。 */
const FIXTURE_VALUE = /(test|e2e|fixture|sample|demo|placeholder|example|changeme|dummy)/i

const isAllowed = (rel) => ALLOW_PATHS.some((re) => re.test(rel))

function listTracked() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
}

/** 逐文件扫描。base 可覆盖，便于自检在临时目录里跑。 */
function scanFile(rel, base = ROOT, { report = false } = {}) {
  if (isAllowed(rel)) return { hits: [], candidates: [] }
  let buf
  try {
    buf = fs.readFileSync(path.join(base, rel))
  } catch {
    return { hits: [], candidates: [] }
  }
  if (buf.includes(0)) return { hits: [], candidates: [] } // 二进制
  const text = buf.toString('utf8')
  const hits = []
  const candidates = []

  // G1
  for (const k of KNOWN_LEAKED) {
    let idx = 0
    while ((idx = text.indexOf(k.value, idx)) !== -1) {
      const line = text.slice(0, idx).split('\n').length
      hits.push({ file: rel, line, rule: k.id, detail: '已知泄漏凭据字面量' })
      idx += k.value.length
    }
  }

  const lines = text.split('\n')

  // G2
  lines.forEach((line, i) => {
    ENV_FALLBACK.re.lastIndex = 0
    let m
    while ((m = ENV_FALLBACK.re.exec(line)) !== null) {
      // 夹具值放过：`E2E-Test-Passw0rd!` 这类是 e2e 专用账号的口令。
      // 它们**不是**生产凭据泄漏（G1 仍会精确抓真正泄漏过的那两个串），
      // 但把这类当红灯会让 14 条噪声盖住真正的那一条。
      if (FIXTURE_VALUE.test(m[2])) continue
      hits.push({ file: rel, line: i + 1, rule: ENV_FALLBACK.id, detail: ENV_FALLBACK.why })
    }
  })

  // 报告模式（不进退出码）
  if (report) {
    lines.forEach((line, i) => {
      REPORT_ONLY.re.lastIndex = 0
      let m
      while ((m = REPORT_ONLY.re.exec(line)) !== null) {
        candidates.push({ file: rel, line: i + 1, value: m[3] })
      }
    })
  }

  return { hits, candidates }
}

function selfTest() {
  const dir = fs.mkdtempSync('/tmp/lf-secret-')
  const cases = []
  const check = (name, cond) => cases.push([name, cond])
  const write = (name, body) => fs.writeFileSync(path.join(dir, name), body)

  // G1 正例
  write('leak.mjs', `const p = '${KNOWN_LEAKED[0].value}'\n`)
  check('G1 抓到已知泄漏字面量', scanFile('leak.mjs', dir).hits.some((h) => h.rule === 'admin-password-2026'))

  // G2 正例（本次事故的真实形态）
  write('fallback.mjs', "const p = process.env.ADMIN_PASSWORD || 'Known-Value-1'\n")
  check('G2 抓到 env 回退字面量', scanFile('fallback.mjs', dir).hits.some((h) => h.rule === 'env-fallback-literal'))

  // G2 负控 1：正常 env 读取
  write('ok1.mjs', 'const p = process.env.ADMIN_PASSWORD\n')
  check('G2 放过正常 env 读取', scanFile('ok1.mjs', dir).hits.length === 0)

  // G2 负控 2：回退到函数（不是字面量）
  write('ok2.mjs', 'const p = process.env.ADMIN_PASSWORD || getAdminPassword()\n')
  check('G2 放过回退到函数', scanFile('ok2.mjs', dir).hits.length === 0)

  // G2 负控 3：非凭据变量（URL 默认值）不得命中
  write('ok4.mjs', "const u = process.env.APP_URL || 'http://localhost:3000'\n")
  check('G2 放过 URL 默认值', scanFile('ok4.mjs', dir).hits.length === 0)

  // G2 负控 4：`??` 运算符不是 `||`
  write('ok3.mjs', "const p = process.env.ADMIN_PASSWORD ?? 'x'\n")
  check('G2 只认 ||（?? 不误报）', scanFile('ok3.mjs', dir).hits.length === 0)

  // 误报回归：zod 键 / 魔法标记 / e2e 假账号都不得进 G1/G2
  write('fp.mjs', "z.object({ password: 'reg-password' })\npassword: 'MAGIC_LINK_AUTH'\npassword: 'Test123!'\n")
  check('G1/G2 对 i18n 键与标记零误报', scanFile('fp.mjs', dir).hits.length === 0)
  check('--report 能看到候选', scanFile('fp.mjs', dir, { report: true }).candidates.length === 3)

  // 允许路径
  check('docs/ 不在门禁范围', scanFile('docs/x.md', dir).hits.length === 0)

  let pass = 0
  for (const [name, ok] of cases) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`)
    if (ok) pass++
  }
  console.log(`\n自检：${pass}/${cases.length}`)
  fs.rmSync(dir, { recursive: true, force: true })
  return pass === cases.length
}

function main() {
  if (has('--self-test')) process.exit(selfTest() ? 0 : 1)

  const files = listTracked()
  const hits = []
  const candidates = []
  for (const f of files) {
    const r = scanFile(f, ROOT, { report: has('--report') })
    hits.push(...r.hits)
    candidates.push(...r.candidates)
  }

  console.log(`扫描：${files.length} 个跟踪文件（门禁 G1 已知泄漏 + G2 env 回退字面量）`)

  if (has('--history')) {
    console.log('\n── 历史提交中出现过已知泄漏字面量的提交数 ──')
    for (const k of KNOWN_LEAKED) {
      let out = ''
      try {
        out = execFileSync('git', ['log', '--oneline', '--all', `-S${k.value}`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
      } catch {
        /* 无匹配时 git 非 0，属正常 */
      }
      console.log(`  ${k.id}: ${out.trim() ? out.trim().split('\n').length : 0} 个提交`)
    }
    console.log('  ⚠️ 历史里的字面量不会因为删除当前文件而消失；它们只能靠**轮换凭据**失效。')
  }

  if (has('--report')) {
    console.log(`\n── 候选清单（信息性，不影响退出码）：${candidates.length} 条 ──`)
    for (const c of candidates.slice(0, 40)) console.log(`  ${c.file}:${c.line}  ≈ ${c.value.slice(0, 6)}…`)
  }

  if (hits.length === 0) {
    console.log('\n✅ PASS —— 无命中')
    process.exit(0)
  }

  console.log(`\n🔴 FAIL —— ${hits.length} 处命中：`)
  for (const h of hits) console.log(`  ${h.file}:${h.line}  [${h.rule}]  ${h.detail}`)
  process.exit(1)
}

main()
