#!/usr/bin/env node
/**
 * 脚本未声明变量检查（针对 `scripts/**\/*.mjs`）
 *
 * ## 为什么需要它
 *
 * `scripts/` 下的 `.mjs` 有一条**独有的风险缝**：
 *   · `tsc` 不检查它们（TypeScript 只覆盖 `src/` 与 `scripts/**\/*.mts`）
 *   · `node --check` 只查**语法**，不查「引用了没声明的变量」
 *   · 项目 eslint 9 无配置文件（等于不生效）
 * → 一旦某次编辑**丢了 `const` 声明行**（跨轮次、多文件并行编辑时真发生过），
 *   脚本要到**运行时执行到那一行**才崩 `ReferenceError`。
 *   而这些脚本恰恰是「生产验证的最后一道防线」：它崩了，复验就变成假绿。
 *
 * 真实案例：`scripts/qa/verify-turn-prod.mjs` 引用了 `EXPECT_SOURCE`，
 * 但 `const EXPECT_SOURCE = process.env.QA_EXPECT_ICE_SOURCE || ''` 在编辑中丢失。
 * 语法检查全过，只有跑到那行才炸。
 *
 * ## 做法
 *
 * 用 acorn 解析 AST，区分「声明」与「引用」（跳过属性名 / 对象键 / 标签 / import 说明符），
 * 报出引用了但**文件内从未声明**且不在已知全局白名单里的标识符。
 *
 * 作用域是**扁平**的（不区分块级）：同名标识符只要在文件任意处声明过就不报。
 * 这是刻意的保守取舍 —— 少报（漏掉真问题）比多报（噪音淹没真问题）好。
 *
 * 用法：`node scripts/check-script-decls.mjs [--dir scripts] [--quiet]`
 *       退出码 1 = 发现未声明引用
 */

import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';

// ─────────────────────────────────────────────────────────────────────
// 已知全局（运行时 / 宿主提供）
// ─────────────────────────────────────────────────────────────────────

const GLOBALS = new Set([
  // Node 核心
  'process', 'console', 'Buffer', 'global', 'globalThis', 'require', 'module', 'exports',
  '__dirname', '__filename', 'queueMicrotask', 'structuredClone', 'crypto', 'performance',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  // 语言内建
  'undefined', 'NaN', 'Infinity', 'arguments', 'eval',
  'Object', 'Function', 'Boolean', 'Symbol', 'Error', 'EvalError', 'RangeError', 'ReferenceError',
  'SyntaxError', 'TypeError', 'URIError', 'AggregateError', 'Number', 'BigInt', 'Math', 'Date',
  'String', 'RegExp', 'Array', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array',
  'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array',
  'BigUint64Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'JSON', 'Promise', 'Proxy', 'Reflect',
  'Intl', 'Iterator', 'AsyncIterator',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'escape', 'unescape', 'atob', 'btoa',
  // Web / 平台
  'fetch', 'Response', 'Request', 'Headers', 'FormData', 'URL', 'URLSearchParams', 'AbortSignal',
  'AbortController', 'TextEncoder', 'TextDecoder', 'ReadableStream', 'WritableStream',
  'TransformStream', 'Blob', 'File', 'FileReader', 'WebSocket', 'EventSource', 'Event', 'EventTarget',
  'navigator', 'document', 'window', 'localStorage', 'sessionStorage', 'location', 'CustomEvent',
  'RTCPeerConnection', 'RTCSessionDescription', 'RTCIceCandidate', 'MediaStream', 'MediaRecorder',
  'Deno', 'Bun',
]);

const SCAN_EXT = new Set(['.mjs']);

// ─────────────────────────────────────────────────────────────────────
// 参数
// ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const dirArg = argv.indexOf('--dir');
const ROOT_DIR = path.resolve(dirArg > -1 ? argv[dirArg + 1] : 'scripts');

// ─────────────────────────────────────────────────────────────────────
// 文件遍历
// ─────────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walk(p, out);
    } else if (SCAN_EXT.has(path.extname(e.name))) {
      out.push(p);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// AST 遍历
// ─────────────────────────────────────────────────────────────────────

const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range']);

function traverse(node, parent, key, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) traverse(child, parent, key, visit);
    return;
  }
  if (typeof node.type !== 'string') return;
  visit(node, parent, key);
  for (const k of Object.keys(node)) {
    if (SKIP_KEYS.has(k)) continue;
    const v = node[k];
    if (v && typeof v === 'object') traverse(v, node, k, visit);
  }
}

/** 展开解构模式里的所有绑定名。 */
function patternNames(n, out) {
  if (!n) return;
  switch (n.type) {
    case 'Identifier':
      out.add(n.name);
      break;
    case 'ObjectPattern':
      for (const p of n.properties) {
        patternNames(p.type === 'RestElement' ? p.argument : p.value, out);
      }
      break;
    case 'ArrayPattern':
      for (const el of n.elements) patternNames(el, out);
      break;
    case 'AssignmentPattern':
      patternNames(n.left, out);
      break;
    case 'RestElement':
      patternNames(n.argument, out);
      break;
    default:
      break;
  }
}

/** 该 Identifier 是否构成「对变量的引用」（而非属性名 / 键 / 标签 / 声明本身）。 */
function isReference(node, parent, key) {
  if (!parent) return false;
  if (parent.type === 'MetaProperty') return false; // import.meta / new.target 不是变量引用
  switch (parent.type) {
    case 'MemberExpression':
      return !(key === 'property' && !parent.computed);
    case 'Property':
      return !(key === 'key' && !parent.computed && !parent.shorthand);
    case 'MethodDefinition':
    case 'PropertyDefinition':
      return !(key === 'key' && !parent.computed);
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return key !== 'label';
    case 'VariableDeclarator':
      return key !== 'id';
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
      return key !== 'id' && key !== 'params';
    default:
      if (/Specifier$/.test(parent.type)) return false; // import/export 说明符
      if (parent.type === 'ArrowFunctionExpression' && key === 'params') return false;
      if (parent.type === 'CatchClause' && key === 'param') return false;
      return true;
  }
}

/** 返回 [{ name, line }]，即引用了但文件内未声明的标识符。 */
function analyse(src, file) {
  let ast;
  try {
    ast = acorn.parse(src, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: true,
      locations: true,
    });
  } catch (err) {
    return [{ name: `<解析失败: ${err.message}>`, line: 0 }];
  }

  const declared = new Set();

  // 第 1 遍：收集声明
  traverse(ast, null, null, (node, parent, key) => {
    if (node.type === 'VariableDeclarator') patternNames(node.id, declared);
    else if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
      if (node.id) declared.add(node.id.name);
      for (const p of node.params) patternNames(p, declared);
    } else if (node.type === 'ArrowFunctionExpression') {
      for (const p of node.params) patternNames(p, declared);
    } else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (node.id) declared.add(node.id.name);
    } else if (node.type === 'CatchClause') {
      patternNames(node.param, declared);
    } else if (/Specifier$/.test(node.type) && node.local) {
      declared.add(node.local.name);
    }
  });

  // 第 2 遍：收集引用
  const missing = new Map();
  traverse(ast, null, null, (node, parent, key) => {
    if (node.type !== 'Identifier') return;
    if (!isReference(node, parent, key)) return;
    const n = node.name;
    if (declared.has(n) || GLOBALS.has(n)) return;
    if (!missing.has(n)) missing.set(n, node.loc ? node.loc.start.line : 0);
  });

  return [...missing.entries()].map(([name, line]) => ({ name, line }));
}

// ─────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(ROOT_DIR)) {
  console.error(`🔴 目录不存在：${ROOT_DIR}`);
  process.exit(1);
}

const files = walk(ROOT_DIR).sort();
let bad = 0;

for (const file of files) {
  const rel = path.relative(process.cwd(), file);
  const issues = analyse(fs.readFileSync(file, 'utf8'), file);
  if (issues.length === 0) continue;
  bad++;
  console.log(`\n🔴 ${rel}`);
  for (const it of issues) console.log(`     L${it.line}  未声明即引用：${it.name}`);
}

if (!QUIET) {
  console.log(
    `\n扫描 ${files.length} 个脚本，${bad} 个存在未声明引用 → ${bad === 0 ? '✅ 通过' : '失败'}`
  );
}

process.exit(bad === 0 ? 0 : 1);
