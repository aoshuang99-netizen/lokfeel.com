/**
 * Playwright → GitHub Actions annotation（V18-03）
 * ═══════════════════════════════════════════════════════════════════
 * 为什么需要它：job logs 的 REST 端点要 admin 权限（403），而
 * `check-runs/{id}/annotations` 是**公开可读**的。上一轮 E2E 连续红了三轮，
 * 每轮能读到的只有一句 "Process completed with exit code 1" ——
 * 于是"浏览器冒烟"变成黑箱，只能靠猜。
 *
 * 这与隔离取证里加 `::error` 是同一件事：**先让失败可分辨，再谈修复**。
 *
 * 注意：本文件是 CJS（仓里没有 `"type": "module"`），
 * 放在 `tests/e2e-ci/` 下也不会被当成用例（Playwright 只认 *.spec / *.test）。
 */

/** 去掉 ANSI 颜色、换行、`::`（后者会被 GitHub 当成命令分隔符） */
function sanitize(value) {
  return String(value ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\r?\n/g, ' / ')
    .replace(/::/g, ':')
    .trim();
}

class GhaAnnotationsReporter {
  constructor() {
    this.failedCount = 0;
  }

  onTestEnd(test, result) {
    const bad = result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted';
    if (!bad) return;
    this.failedCount += 1;

    const title = sanitize(`E2E 未通过：${test.title}`).slice(0, 180);
    const raw = result.error?.message ?? result.error?.value ?? '(无错误信息)';
    // 只留前 1200 字符：annotation 有长度上限，太长会被截断且更难读
    const message = sanitize(raw).slice(0, 1200) || '(无错误信息)';
    console.log(`::error title=${title}::${message}`);
  }

  onEnd(result) {
    const verdict = result.status;
    if (this.failedCount === 0 && verdict === 'passed') {
      console.log('::notice title=E2E 汇总::全部通过');
      return;
    }
    console.log(
      `::error title=E2E 汇总::status=${verdict} 失败用例=${this.failedCount} —— 明细见上方每条 annotation`,
    );
  }
}

module.exports = GhaAnnotationsReporter;
