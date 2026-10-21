/**
 * V16 · 轻量单测运行器（jest 兼容子集）
 *
 * 为什么需要它：本机 `node_modules` 只装了部分依赖（无 jest / ts-jest 可执行），
 * 而 CI 里跑的是真 jest。为了在**本地也能拿到真实 PASS/FAIL 证据**（而不是
 * "测试文件存在"），这里用 tsx + 自写的 jest 兼容层执行同一批测试文件。
 *
 * 支持：describe / it / test / beforeEach / afterEach / expect(…).{toBe,toEqual,
 * toBeNull,toBeUndefined,toBeDefined,toHaveLength,toContain,toMatch,toThrow,
 * toBeTruthy,toBeFalsy,toBeGreaterThan,toBeLessThan,toBeInstanceOf} + .not
 *
 * 用法：tsx scripts/qa/v16-unit-runner.mts tests/admin/*.test.ts
 * 退出码：0 = 全绿；1 = 有失败（可直接用于门禁）
 */
import assert from 'node:assert'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

type TestFn = () => void | Promise<void>
interface Case {
  title: string
  fn: TestFn
}

const cases: Case[] = []
const stack: string[] = []
let beforeEachFns: TestFn[] = []
let afterEachFns: TestFn[] = []

function registerDescribe(name: string, fn: () => void) {
  stack.push(name)
  const savedBefore = beforeEachFns
  const savedAfter = afterEachFns
  beforeEachFns = [...savedBefore]
  afterEachFns = [...savedAfter]
  fn()
  stack.pop()
  beforeEachFns = savedBefore
  afterEachFns = savedAfter
}

function registerIt(name: string, fn: TestFn) {
  const title = [...stack, name].join(' › ')
  cases.push({ title, fn })
}

type Matchers = {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toBeNull(): void
  toBeUndefined(): void
  toBeDefined(): void
  toHaveLength(n: number): void
  toContain(item: unknown): void
  toMatch(re: RegExp | string): void
  toThrow(): void
  toBeTruthy(): void
  toBeFalsy(): void
  toBeGreaterThan(n: number): void
  toBeLessThan(n: number): void
  toBeInstanceOf(ctor: unknown): void
}

function buildMatchers(actual: unknown, negated: boolean): Matchers {
  const check = (pass: boolean, message: string) => {
    if (negated ? pass : !pass) {
      throw new Error((negated ? 'NOT ' : '') + message)
    }
  }

  return {
    toBe(expected) {
      check(Object.is(actual, expected), `期望 ${format(expected)}，实际 ${format(actual)}`)
    },
    toEqual(expected) {
      let pass = true
      try {
        assert.deepStrictEqual(actual, expected)
      } catch {
        pass = false
      }
      check(pass, `期望深等于 ${format(expected)}，实际 ${format(actual)}`)
    },
    toBeNull() {
      check(actual === null, `期望 null，实际 ${format(actual)}`)
    },
    toBeUndefined() {
      check(actual === undefined, `期望 undefined，实际 ${format(actual)}`)
    },
    toBeDefined() {
      check(actual !== undefined, '期望已定义，实际 undefined')
    },
    toHaveLength(n) {
      const len = (actual as { length?: number })?.length
      check(len === n, `期望长度 ${n}，实际 ${format(len)}`)
    },
    toContain(item) {
      const pass = Array.isArray(actual)
        ? actual.includes(item)
        : typeof actual === 'string'
          ? actual.includes(String(item))
          : false
      check(pass, `期望包含 ${format(item)}，实际 ${format(actual)}`)
    },
    toMatch(re) {
      const pass = typeof actual === 'string' && new RegExp(re).test(actual)
      check(pass, `期望匹配 ${String(re)}，实际 ${format(actual)}`)
    },
    toThrow() {
      let threw = false
      try {
        ;(actual as TestFn)()
      } catch {
        threw = true
      }
      check(threw, '期望抛出异常，实际没有抛出')
    },
    toBeTruthy() {
      check(Boolean(actual), `期望真值，实际 ${format(actual)}`)
    },
    toBeFalsy() {
      check(!actual, `期望假值，实际 ${format(actual)}`)
    },
    toBeGreaterThan(n) {
      check(Number(actual) > n, `期望 > ${n}，实际 ${format(actual)}`)
    },
    toBeLessThan(n) {
      check(Number(actual) < n, `期望 < ${n}，实际 ${format(actual)}`)
    },
    toBeInstanceOf(ctor) {
      check(actual instanceof (ctor as new () => unknown), `期望是 ${String(ctor)} 的实例`)
    },
  }
}

function format(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'function') return '[Function]'
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

// —— 注入 jest 全局 ——
const g = globalThis as unknown as Record<string, unknown>
g.describe = registerDescribe
g.it = registerIt
g.test = registerIt
g.beforeEach = (fn: TestFn) => beforeEachFns.push(fn)
g.afterEach = (fn: TestFn) => afterEachFns.push(fn)
g.expect = (actual: unknown) => {
  const matchers = buildMatchers(actual, false)
  return Object.assign(matchers, { not: buildMatchers(actual, true) })
}

async function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('用法：tsx scripts/qa/v16-unit-runner.mts <test-file...>')
    process.exit(2)
  }

  for (const f of files) {
    await import(pathToFileURL(path.resolve(f)).href)
  }

  let passed = 0
  const failures: string[] = []

  for (const c of cases) {
    try {
      for (const fn of beforeEachFns) await fn()
      await c.fn()
      for (const fn of afterEachFns) await fn()
      passed += 1
      console.log(`  ✓ ${c.title}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failures.push(`${c.title}\n      ${msg}`)
      console.log(`  ✗ ${c.title}\n      ${msg}`)
    }
  }

  console.log('')
  console.log(`总计 ${cases.length} · 通过 ${passed} · 失败 ${failures.length}`)
  if (failures.length > 0) {
    console.log('\n失败明细：')
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('runner 异常：', err)
  process.exit(2)
})
