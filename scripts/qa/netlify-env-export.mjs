#!/usr/bin/env node
/**
 * 把 Netlify 站点的环境变量导出成 systemd 可用的 EnvironmentFile。
 *
 * 为什么需要它：自托管最隐蔽的失败不是构建失败，而是**少了一个变量**——
 *   - 18 个 NEXT_PUBLIC_* 在构建期内联，缺了就是 `undefined`，页面照常渲染但功能静默消失；
 *   - AUTH_URL 缺了会回落到 http://localhost:3000（见 src/lib/auth/config.ts:32）；
 *   - FIREBASE_PRIVATE_KEY 缺了，Firebase 桥接直接 disabled，只打一行 warn。
 * 手工从面板抄 40 个键，一定会错；从 API 导，一次到位。
 *
 * 用法（**token 只从环境变量读，不接受命令行参数**——argv 会进进程列表）：
 *   NETLIFY_AUTH_TOKEN=xxx node scripts/qa/netlify-env-export.mjs \
 *     --site c46478e9-... --out /etc/lokfeel/env
 *
 *   --keys-only        只列键名（用于审计，不落盘）
 *   --dry-run          只校验与统计，不写文件
 *   --force            允许写到仓库目录内（默认拒绝，防误提交密钥）
 *
 * 安全约束：
 *   - 输出文件 0600；内容含真实密钥，绝不打印值（只打印长度与键名）
 *   - 默认拒绝写到 git 仓库内；确需时 --force 并自行确认 .gitignore
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pexec = promisify(execFile)

function parseArgs(argv) {
  const out = { site: '', outFile: '', keysOnly: false, dryRun: false, force: false, context: 'production' }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--site') out.site = argv[++i]
    else if (a.startsWith('--site=')) out.site = a.slice(7)
    else if (a === '--out') out.outFile = argv[++i]
    else if (a.startsWith('--out=')) out.outFile = a.slice(6)
    else if (a === '--keys-only') out.keysOnly = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--force') out.force = true
    else if (a.startsWith('--context=')) out.context = a.slice(10)
  }
  return out
}

/** 单引号包裹，内部单引号用 '\'' 断开；EnvironmentFile 与 shell 都认 */
export function envQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/**
 * 选值：production 优先，其次 all，最后任意。
 * 理由：Netlify 的 dev 上下文经常指向另一个数据库，混用会造成"迁移后数据不对"。
 */
export function pickValue(entry, preferred = 'production') {
  const values = entry.values || []
  const order = [preferred, 'all']
  for (const ctx of order) {
    const hit = values.find((v) => v.context === ctx)
    if (hit) return hit
  }
  return values[0] || null
}

/**
 * 生成 env 文件内容。
 * 多行值：FIREBASE_PRIVATE_KEY 是唯一被代码 `.replace(/\\n/g,"\n")` 还原的键
 * （src/lib/firebase/admin.ts:105），所以把真实换行转成字面量 \n 是安全的；
 * 其它键若含真实换行，EnvironmentFile 无法表达，必须显式跳过并报警。
 */
export function buildEnvFile(entries, { context = 'production', site = '', now = new Date() } = {}) {
  const lines = [
    `# /etc/lokfeel/env — 由 scripts/qa/netlify-env-export.mjs 生成`,
    `# 来源：Netlify site ${site} · context=${context} · ${now.toISOString()}`,
    `# 权限应为 600，属主 root:lokfeel。**不要提交到 git。**`,
    '',
  ]
  const written = []
  const skipped = []

  for (const e of entries) {
    const v = pickValue(e, context)
    if (!v) {
      skipped.push([e.key, '无任何上下文的取值'])
      continue
    }
    let value = String(v.value ?? '')
    if (/[\r\n]/.test(value)) {
      if (e.key === 'FIREBASE_PRIVATE_KEY') {
        value = value.replace(/\r?\n/g, '\\n')
      } else {
        skipped.push([e.key, '含真实换行，EnvironmentFile 无法表达'])
        continue
      }
    }
    lines.push(`${e.key}=${envQuote(value)}`)
    written.push(e.key)
  }
  lines.push('')
  return { content: lines.join('\n'), written, skipped }
}

async function isInsideRepo(p) {
  try {
    const { stdout } = await pexec('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd() })
    const root = stdout.trim()
    const abs = path.resolve(p)
    return abs === root || abs.startsWith(root + path.sep)
  } catch {
    return false
  }
}

async function fetchEnv(site, token) {
  const res = await fetch(`https://api.netlify.com/api/v1/sites/${site}/env`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 404) throw new Error(`站点不存在或无权限：${site}`)
  if (res.status === 401) throw new Error('NETLIFY_AUTH_TOKEN 无效或已过期')
  if (!res.ok) throw new Error(`Netlify API ${res.status}`)
  const json = await res.json()
  if (!Array.isArray(json)) throw new Error('响应不是数组，接口可能变更')
  return json
}

async function selfTest() {
  const entries = [
    { key: 'A', values: [{ context: 'all', value: 'x' }] },
    { key: 'B', values: [{ context: 'dev', value: 'wrong' }, { context: 'production', value: "it's" }] },
    { key: 'FIREBASE_PRIVATE_KEY', values: [{ context: 'all', value: 'line1\nline2' }] },
    { key: 'MULTI', values: [{ context: 'all', value: 'a\nb' }] },
    { key: 'EMPTY', values: [] },
  ]
  const r = buildEnvFile(entries, { context: 'production', site: 'test' })
  const t = []
  t.push(['production 优先于 dev', r.content.includes(`B='it'\\''s'`)])
  t.push(['单引号被正确转义', r.content.includes(`'it'\\''s'`)])
  t.push(['私钥换行转为字面量 \\n', r.content.includes(`FIREBASE_PRIVATE_KEY='line1\\nline2'`)])
  t.push(['其它多行值被跳过并记录', r.skipped.some(([k]) => k === 'MULTI')])
  t.push(['无取值的键被跳过', r.skipped.some(([k]) => k === 'EMPTY')])
  t.push(['不泄漏到注释以外的位置', !r.content.includes('wrong')])

  // 反证：如果把 production 值拿掉，必须回落到 all
  const r2 = buildEnvFile([{ key: 'A', values: [{ context: 'all', value: 'fallback' }] }])
  t.push(['缺 production 时回落 all', r2.content.includes(`A='fallback'`)])

  let pass = 0
  for (const [name, ok] of t) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (ok) pass++
  }
  console.log(`\nSELFTEST ASSERTIONS=${t.length} → ${pass} PASS / ${t.length - pass} FAIL`)
  console.log(`ASSERTIONS=${t.length}`)
  return pass === t.length
}

async function main() {
  if (process.argv.includes('--self-test')) {
    process.exit((await selfTest()) ? 0 : 1)
  }

  const args = parseArgs(process.argv)
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN
  if (!token) {
    console.error('缺 NETLIFY_AUTH_TOKEN（请用环境变量传入，不要写在命令行）')
    process.exit(64)
  }
  if (!args.site) {
    console.error('缺 --site <site_id>')
    process.exit(64)
  }

  const entries = await fetchEnv(args.site, token)
  const keys = entries.map((e) => e.key).sort()

  if (args.keysOnly) {
    console.log(keys.join('\n'))
    console.log(`\nKEYS=${keys.length}`)
    return
  }

  const { content, written, skipped } = buildEnvFile(entries, { context: args.context, site: args.site })
  console.log(`读取 ${entries.length} 个键；可写入 ${written.length} 个`)
  for (const [k, why] of skipped) console.warn(`SKIP ${k}: ${why}`)

  if (args.dryRun) {
    console.log('DRY-RUN：未写文件。键名：')
    console.log(written.join('\n'))
    console.log(`\nASSERTIONS=${written.length + skipped.length}`)
    return
  }

  if (!args.outFile) {
    console.error('缺 --out <path>（例如 /etc/lokfeel/env）')
    process.exit(64)
  }
  if (await isInsideRepo(args.outFile)) {
    if (!args.force) {
      console.error(`拒绝写入仓库目录：${args.outFile}（确需请加 --force，并确认 .gitignore 覆盖）`)
      process.exit(65)
    }
    console.warn('⚠️ --force：正在把含密钥的文件写入仓库目录，请立即确认 .gitignore')
  }

  await fs.mkdir(path.dirname(path.resolve(args.outFile)), { recursive: true })
  await fs.writeFile(args.outFile, content, { mode: 0o600 })
  await fs.chmod(args.outFile, 0o600)
  const st = await fs.stat(args.outFile)
  console.log(`✅ 已写入 ${args.outFile}（${st.size} 字节，mode ${(st.mode & 0o777).toString(8)}）`)
  console.log(`ASSERTIONS=${written.length}`)
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (invoked) {
  main().catch((e) => {
    console.error('ERROR', e.message)
    process.exit(1)
  })
}
