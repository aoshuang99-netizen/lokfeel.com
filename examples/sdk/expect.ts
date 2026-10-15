/**
 * 极小的断言/汇总器（示例用，非测试框架）。
 *
 * 为什么示例里要带断言：**演示脚本只有两种结局 —— 通过，或明确地失败。**
 * 一个只打印 JSON、永远 exit 0 的示例，在 CI 里等于没跑；而"越权必须失败"
 * 这类安全命题，恰恰需要示例自己把结论说出来（而不是让读者自己看输出判断）。
 *
 * 因此每个断言有三态：`ok` / `FAIL` / `SKIP`。`SKIP` 用于**无法确定**的场景，
 * 例如"越权演示要求调用者恰好不具备某能力" —— 若令牌账号恰好具备，那不是缺陷，
 * 只是这组夹具不适用；此时必须**显式说出来**，而不是静默算通过。
 */

export type CheckResult = { name: string; ok: boolean; skipped: boolean; detail: string }

export type Checker = {
  ok(name: string, ok: boolean, detail?: string): void
  skip(name: string, detail: string): void
  /** 打印汇总；返回进程退出码（有 FAIL → 1）。 */
  finish(): number
}

export function createChecker(title: string): Checker {
  const results: CheckResult[] = []
  console.log(`\n━━━ ${title} ━━━`)

  return {
    ok(name, ok, detail = '') {
      results.push({ name, ok, skipped: false, detail })
      console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`)
    },
    skip(name, detail) {
      results.push({ name, ok: true, skipped: true, detail })
      console.log(`  ~ ${name}  — SKIP: ${detail}`)
    },
    finish() {
      const failed = results.filter((r) => !r.ok)
      const skipped = results.filter((r) => r.skipped)
      const passed = results.length - failed.length - skipped.length
      console.log(
        `  ── ${passed} 通过 / ${failed.length} 失败 / ${skipped.length} 跳过（共 ${results.length}）`,
      )
      for (const f of failed) console.log(`     ✗ ${f.name}${f.detail ? `  — ${f.detail}` : ''}`)
      return failed.length > 0 ? 1 : 0
    },
  }
}
