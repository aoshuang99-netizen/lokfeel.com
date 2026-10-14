#!/usr/bin/env node
/**
 * P0/P1/P2 前端不变量门禁（Living Connection OS）
 * -----------------------------------------
 * 把设计基准里"必须成立、否则就是假功能"的几条，变成**可复跑的静态检查**：
 *
 *   R1  禁止用 `setTimeout` 伪造执行成功 / 加载完成（阻断标准 #6）
 *   R2  每个 <button> 必须"有事可做"：有 onClick、或 disabled、或 type="submit"
 *      —— 否则就是 AC-18 说的"空按钮"（点了没反应）
 *   R3  P0 范围内不得依赖 3D（three / @react-three/*）—— 避免"先做 3D 再做内部"
 *   R4  `ready: false` 的导航项必须写清 `reason`（不许"敬请期待"式空话）
 *   R5  被检查的文件不得出现 `mock` / `fakeData` / `dummyData` 这类假数据标识
 *   R6  【P1→P2 改造】**agent 节点不得无源**。T09 Agent Runtime 已交付，故本规则
 *       从"禁止产出 `type: 'agent'`"改为"产出就必须带 `runs`"：
 *       `runs` 只能来自 `GET /api/v1/agents/runs`；没有它的 agent 节点是**手写的
 *       拓扑**，与 P1 禁止的那件事是同一种伪造（阻断标准 #6/#9）。
 *       ⚠️ 规则**变松**（从禁止到有条件允许）是升级带来的，不是标准降低 ——
 *       所以判据必须落在"有没有真实数据来源"上，而不是落在"有没有写这个字面量"上。
 *   R7  不得使用 `dangerouslySetInnerHTML` / `eval` / `new Function` ——
 *       `WorkspaceSpec` 只能被"白名单组件"渲染，绝不能当代码执行
 *   R8  【P2】画布库 `@xyflow/react` 只允许出现在 `src/components/living/field/`
 *       —— P2 的设计基准明确"不强迫一个库承担所有场景"（DESIGN/02-plan.md D5），
 *       因此把它**收敛到一个目录**：要换/要加第二套渲染方案时，影响面是可数的。
 *   R9  【P2】会进界面的字符串 / JSX 文本里不得出现 markdown 强调标记（`**`）
 *       —— React 把字符串**原样**渲染成文本，`**重点**` 到了屏幕上就是两个星号。
 *       本切片踩过两次（详情面板 + 装配器的 note），所以固化成规则。
 *   R10 【P2】客户端可达的 Living 代码**只能 `import type`** 服务端模块。
 *       值导入会把服务层（Prisma / 租户守卫 / 网络）拖进客户端 bundle ——
 *       P1 的 `@/lib/connection` 桶文件正是这样：一行 `import { X }` 就够。
 *       唯一放行的是 `@/lib/connection/field-catalog`（**零 import** 的纯字段目录，
 *       它的全部意义就是被展示层引用）。
 *
 * 用法：node scripts/check-ui-invariants.mjs   （退出码 0 = 通过）
 * 环境：纯静态扫描，不连数据库、不读 .env。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

/**
 * 被检查范围：Living 界面层（P0/P1/P2）+ `WorkspaceSpec` 契约层 + P2 装配层
 *            + **社群控制台**（AC-18 的落点）。
 *
 * 🔴 为什么到 T08 Slice 4 才把 `src/app/console` 加进来（2026-10-14）：
 *   R2（无空按钮）与 R4（未就绪要说明原因）**本来就是 AC-18 的判据**，但这个数组
 *   自 T07 起就**没有** console ⇒ 规则在、扫描面不在，七屏从未被门禁管过。
 *   首次纳入即抓出 **11 处真实违规**（1×R4 + 10×R9），且 R9 的星号
 *   **此刻正渲染在生产界面上**（`/console` 与 `/console/outcomes`）。
 *   配套地，`verify-ui-invariants-mutation.mjs` 也补了"**每个 scope 都要被证明扫到**"
 *   的覆盖面自证 —— 否则把这里的一行删掉，自证仍然全绿（哨兵不能只守自己）。
 */
const SCOPES = [
  'src/components/living',
  'src/app/workspace',
  'src/lib/workspace-spec',
  'src/lib/living',
  // T08 Slice 4：AC-18 判的就是这七屏 —— 规则 R2/R4 不覆盖它，等于没判。
  'src/app/console',
]

/**
 * R8 的白名单目录。**只此一处**允许引画布库。
 * 注意：用带尾斜杠的前缀比较，避免 `field-extra/` 这类"前缀相同但不是它"的目录混进来。
 */
const XYFLOW_SCOPE = 'src/components/living/field/'

/**
 * R10 的适用范围：客户端可达的 Living 代码（组件 + 装配层）。
 * `src/app/workspace` 是 `'use client'` 页面，同样适用。
 */
const CLIENT_REACHABLE_SCOPES = ['src/components/living/', 'src/lib/living/', 'src/app/workspace/']

/**
 * R10 黑名单：**服务端模块前缀**。值导入它们 = 把 Prisma/守卫/网络拖进客户端。
 * 用 `=== prefix || startsWith(prefix + '/')` 精确匹配，避免
 * `@/lib/agent`（纯内核，允许）被 `@/lib/agents`（服务层，禁止）的规则误伤。
 */
const SERVER_MODULE_PREFIXES = [
  '@/lib/connection',
  '@/lib/outcome',
  '@/lib/agents',
  '@/lib/workflow',
  '@/lib/db',
  '@/lib/tenancy',
]

/** R10 白名单：允许**值导入**的服务端子模块（唯一：零 import 的字段目录）。 */
const VALUE_IMPORT_ALLOWLIST = new Set(['@/lib/connection/field-catalog'])

/**
 * R6：agent 节点被判为"有源"所必需的字段（来自 `/api/v1/agents/runs`）。
 *
 * 同时接受**简写**（`data: { runs, provider }`）与**显式赋值**（`runs: value`）两种写法
 * —— 只认 `runs:` 会让前者被误判为"无源"，而简写是这块代码最自然的写法。
 */
const AGENT_NODE_SOURCE_FIELD = /\bruns\b\s*[:,}]/

const problems = []
const checked = []

function walk(dir) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = posixJoin(dir, entry.name)
    if (entry.isDirectory()) walk(rel)
    else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) checkFile(rel)
  }
}
function posixJoin(a, b) {
  return `${a.replace(/\/+$/, '')}/${b}`
}

/** 剥离注释（保留长度与换行，便于报行号）。只处理常见情形，够本检查使用。 */
function stripComments(code) {
  let out = ''
  let i = 0
  const n = code.length
  let state = 'code' // code | s | d | t | line | block
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
      } else {
        out += ' '
      }
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
    // 字符串 / 模板串内：原样保留
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

/**
 * 抓出源码里**全部** import / export-from 语句（含多行写法）。
 *
 * 为什么要整条语句而不是逐行：`import {\n a,\n b,\n} from 'x'` 的多行写法
 * 逐行匹配会**漏检**——而 R10 的漏检后果正是"值导入混进客户端"。惰性量词
 * 配合 `from '...'` 能跨行，且不会吃掉下一条语句（因为遇到第一个 from 就停）。
 */
function collectImportStatements(src) {
  const re = /(?:^|\n)[ \t]*(import|export)\s+([\s\S]*?)\bfrom\s+['"]([^'"]+)['"]/g
  const out = []
  let m
  while ((m = re.exec(src)) !== null) {
    out.push({
      kind: m[1],
      clause: m[2],
      spec: m[3],
      index: m.index + (m[0].startsWith('\n') ? 1 : 0),
    })
  }
  return out
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length
}

function checkFile(rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  // 🔴 先剥离注释（把注释字符替换成空格，**保留换行与偏移**），否则注释里的
  //    散文（如本文件的规则说明）会被当成真代码命中，产生误报。
  const src = stripComments(raw)
  const lines = src.split('\n')
  checked.push(rel)

  // R1 · setTimeout / setInterval 伪装
  lines.forEach((line, i) => {
    if (/\bset(Timeout|Interval)\s*\(/.test(line)) {
      problems.push(`[R1] ${rel}:${i + 1} 出现 setTimeout/setInterval —— 不得用它伪造执行成功或加载完成`)
    }
  })

  // R3 · P0 不得依赖 3D
  lines.forEach((line, i) => {
    if (/from\s+['"](three|@react-three\/[^'"]+)['"]/.test(line)) {
      problems.push(`[R3] ${rel}:${i + 1} P0 层引入了 3D 依赖（three / @react-three/*）—— 属 P3 范围`)
    }
  })

  // R5 · 假数据标识
  lines.forEach((line, i) => {
    if (/\b(mockData|fakeData|dummyData)\b/.test(line)) {
      problems.push(`[R5] ${rel}:${i + 1} 出现假数据标识（mockData/fakeData/dummyData）`)
    }
  })

  // R6 · agent 节点**不得无源**（T09 已交付 ⇒ 由"禁止"改为"必须带真实数据"）
  //   判据刻意落在"有没有 runs 字段"上，而不是"有没有写 type: 'agent'"：
  //   前者对应"这条拓扑是从 /api/v1/agents/runs 来的吗"，后者只对应"你写了这七个字母吗"。
  const agentRe = /\btype\s*:\s*['"]agent['"]/g
  let am
  while ((am = agentRe.exec(src)) !== null) {
    // 同一条对象字面量内 `data: { runs: [...] }` 紧随其后（实测 < 200 字符），
    // 600 字符窗口足够覆盖格式化后的多行写法。
    const tail = src.slice(am.index, am.index + 600)
    if (!AGENT_NODE_SOURCE_FIELD.test(tail)) {
      problems.push(
        `[R6] ${rel}:${lineOf(src, am.index)} 产出了 agent 节点但没有 runs 字段 —— ` +
          `无数据来源的 agent 拓扑就是伪造（runs 必须来自 GET /api/v1/agents/runs）`,
      )
    }
  }

  // R7 · spec 不得被当代码执行
  lines.forEach((line, i) => {
    if (/dangerouslySetInnerHTML/.test(line)) {
      problems.push(`[R7] ${rel}:${i + 1} 使用了 dangerouslySetInnerHTML —— spec 文本只能当文本渲染`)
    }
    if (/\bnew\s+Function\s*\(/.test(line) || /\beval\s*\(/.test(line)) {
      problems.push(`[R7] ${rel}:${i + 1} 使用了 eval / new Function —— 禁止把 spec 当代码执行`)
    }
  })

  // R8 · 画布库作用域收敛（白名单目录之外一律不得出现）
  //   放在"剥离注释后"的源码上判断，避免散文里的库名（如本文件的说明）被误报。
  //   匹配两种写法：`import ... from '@xyflow/react'` 与副作用 `import '@xyflow/react/dist/style.css'`。
  if (!rel.startsWith(XYFLOW_SCOPE)) {
    lines.forEach((line, i) => {
      const mentionsLib = /['"]@xyflow\/react(?:\/[^'"]*)?['"]/.test(line)
      const isImport = /(?:^|\s)(?:import|from)\s/.test(line) || /^\s*import\b/.test(line)
      if (mentionsLib && isImport) {
        problems.push(
          `[R8] ${rel}:${i + 1} 引用了 @xyflow/react —— 该库只允许出现在 ${XYFLOW_SCOPE}（D5：不强迫一个库承担所有场景）`,
        )
      }
    })
  }

  // R9 · 用户可见文本里不得出现 markdown 强调标记
  //   注释已被剥掉 ⇒ 命中的必然是"会进界面的字符串或 JSX 文本"。
  //   （不查反引号：模板串的界定符到处都是，会淹没真信号。）
  lines.forEach((line, i) => {
    if (line.includes('**')) {
      problems.push(
        `[R9] ${rel}:${i + 1} 字符串/JSX 文本里出现 markdown 强调标记（**）—— 会被原样渲染成星号，改用 <strong> 或调整措辞`,
      )
    }
  })

  // R10 · 客户端可达代码**只能 `import type`** 服务端模块
  //   值导入会把服务层（Prisma / 租户守卫 / 网络）拖进客户端 bundle。
  //   豁免：唯一的零 import 纯目录 `@/lib/connection/field-catalog`。
  if (CLIENT_REACHABLE_SCOPES.some((p) => rel.startsWith(p))) {
    for (const stmt of collectImportStatements(src)) {
      if (!SERVER_MODULE_PREFIXES.some((p) => stmt.spec === p || stmt.spec.startsWith(`${p}/`))) continue
      if (VALUE_IMPORT_ALLOWLIST.has(stmt.spec)) continue
      // `import type { ... }` / `export type { ... }` = 零运行时 ⇒ 允许。
      if (/^\s*type\b/.test(stmt.clause)) continue
      problems.push(
        `[R10] ${rel}:${lineOf(src, stmt.index)} 值导入了服务端模块 "${stmt.spec}" —— ` +
          `客户端可达代码只能用 \`import type\`（否则会把 Prisma/守卫拖进 bundle）；` +
          `确需取值请走零依赖目录或本地装配层`,
      )
    }
  }

  // R2 · 空按钮：逐个 <button ...> 开标签检查
  const btnRe = /<button\b([\s\S]*?)>/g
  let m
  while ((m = btnRe.exec(src)) !== null) {
    const attrs = m[1]
    const hasOnClick = /\bonClick\s*=/.test(attrs)
    const hasDisabled = /\bdisabled\b/.test(attrs)
    const isSubmit = /type\s*=\s*['"]submit['"]/.test(attrs)
    if (!hasOnClick && !hasDisabled && !isSubmit) {
      const line = src.slice(0, m.index).split('\n').length
      problems.push(`[R2] ${rel}:${line} <button> 既无 onClick、也无 disabled、也非 submit —— 这是"空按钮"（AC-18）`)
    }
  }

  // R4 · ready:false 必须有 reason
  const readyRe = /ready\s*:\s*false/g
  let r
  while ((r = readyRe.exec(src)) !== null) {
    const line = src.slice(0, r.index).split('\n').length
    // 取该行到下一个 `}` 结尾的片段（同一对象字面量的其余属性）
    const tail = src.slice(r.index, src.indexOf('\n', r.index + 1) < 0 ? src.length : r.index + 400)
    if (!/\breason\s*:/.test(tail)) {
      problems.push(`[R4] ${rel}:${line} ready:false 未给出 reason —— 未就绪能力必须写明原因`)
    }
  }
}

for (const s of SCOPES) walk(s)

// R0 · 残留变异文件检测
//   自证脚本被**中断**（沙箱重试 / Ctrl-C / OOM）会留下 `__mutant-*` 文件，
//   它会被后续扫描当"正常文件"，甚至被 `git add -A` 提交 —— 必须主动报错。
//   （本仓实测踩过一次。）自证模式自己会创建它们，故用 env 跳过。
if (process.env.LF_INVARIANT_SELF_TEST !== '1') {
  for (const s of SCOPES) {
    const abs = path.join(ROOT, s)
    if (!fs.existsSync(abs)) continue
    walkMutants(s, abs)
  }
}

/** 递归找 `__mutant-*`（子目录也要查：R8 的变异会写在 `living/` 下）。 */
function walkMutants(relDir, absDir) {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = posixJoin(relDir, entry.name)
    if (entry.isDirectory()) walkMutants(rel, path.join(absDir, entry.name))
    else if (entry.name.startsWith('__mutant-')) {
      problems.push(`[R0] ${rel} 存在残留的变异文件（自证脚本被中断所致）—— 删除它再提交`)
    }
  }
}

if (checked.length === 0) {
  console.error('❌ 未扫描到任何文件 —— 检查 SCOPES 配置：', SCOPES.join(', '))
  process.exit(1)
}

console.log(`扫描 ${checked.length} 个文件：`)
for (const f of checked) console.log(`  · ${f}`)

if (problems.length > 0) {
  console.error(`\n❌ UI 不变量未通过（${problems.length} 处）：`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

console.log(
  `\n✅ UI 不变量全部通过（R1 无伪成功 · R2 无空按钮 · R3 无 3D 依赖 · R4 未就绪有原因 · R5 无假数据标识 · R6 agent 节点有源 · R7 无代码执行面 · R8 画布库作用域收敛 · R9 无 markdown 字面量 · R10 服务端模块仅类型导入）`,
)
