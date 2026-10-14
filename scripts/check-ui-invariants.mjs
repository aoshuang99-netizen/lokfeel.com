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
 *   R6  【P1】不得产出保留节点类型（`type: 'agent'`）—— 它依赖 T09 Agent Runtime
 *   R7  【P1】不得使用 `dangerouslySetInnerHTML` / `eval` / `new Function` ——
 *       `WorkspaceSpec` 只能被"白名单组件"渲染，绝不能当代码执行
 *   R8  【P2】画布库 `@xyflow/react` 只允许出现在 `src/components/living/field/`
 *       —— P2 的设计基准明确"不强迫一个库承担所有场景"（DESIGN/02-plan.md D5），
 *       因此把它**收敛到一个目录**：要换/要加第二套渲染方案时，影响面是可数的。
 *   R9  【P2】会进界面的字符串 / JSX 文本里不得出现 markdown 强调标记（`**`）
 *       —— React 把字符串**原样**渲染成文本，`**重点**` 到了屏幕上就是两个星号。
 *       本切片踩过两次（详情面板 + 装配器的 note），所以固化成规则。
 *
 * 用法：node scripts/check-ui-invariants.mjs   （退出码 0 = 通过）
 * 环境：纯静态扫描，不连数据库、不读 .env。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

/** 被检查范围：Living 界面层（P0/P1/P2）+ `WorkspaceSpec` 契约层 + P2 装配层。 */
const SCOPES = [
  'src/components/living',
  'src/app/workspace',
  'src/lib/workspace-spec',
  'src/lib/living',
]

/**
 * R8 的白名单目录。**只此一处**允许引画布库。
 * 注意：用带尾斜杠的前缀比较，避免 `field-extra/` 这类"前缀相同但不是它"的目录混进来。
 */
const XYFLOW_SCOPE = 'src/components/living/field/'

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

  // R6 · 保留节点类型（agent 依赖 T09，产出即为伪造能力）
  lines.forEach((line, i) => {
    if (/\btype\s*:\s*['"]agent['"]/.test(line)) {
      problems.push(`[R6] ${rel}:${i + 1} 产出了保留节点类型 "agent" —— 依赖 T09 Agent Runtime，P1 不得生成`)
    }
  })

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
  `\n✅ UI 不变量全部通过（R1 无伪成功 · R2 无空按钮 · R3 无 3D 依赖 · R4 未就绪有原因 · R5 无假数据标识 · R6 无保留节点类型 · R7 无代码执行面 · R8 画布库作用域收敛 · R9 无 markdown 字面量）`,
)
