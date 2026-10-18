#!/usr/bin/env node
/**
 * Stripe **test mode** 退款端到端验证：直接调用生产代码里的
 * `executeSubscriptionRefund()`，不复制任何业务逻辑。
 *
 * 为什么需要它：生产没配 `STRIPE_*`，所以上线时只能证明「路由能加载、鉴权会 401」，
 * 证明不了「配上密钥后真的能退」。这个脚本补的正是那一段 —— 走真实 Stripe API，
 * 覆盖 `latest_invoice` 解引用、`invoice.payments[].payment.payment_intent` 解析、
 * 已退金额累计、幂等键、`fullyRefunded` 判定。
 *
 * 它**不写数据库**、不改订阅状态，因此可以安全地反复跑。
 *
 * 用法：
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/qa/refund-testmode.mjs sub_xxx
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/qa/refund-testmode.mjs sub_xxx --amount=5
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/qa/refund-testmode.mjs sub_xxx --reason=requested_by_customer
 *   node scripts/qa/refund-testmode.mjs --dry      # 只验证模块能编译/加载（不需要密钥）
 *
 * 判定：
 *   首次全额  → exit 0，success:true、fullyRefunded:true
 *   再跑一次  → exit 1，code:nothing_refundable（幂等生效）
 *   部分退款  → exit 0，fullyRefunded:false
 *   live 密钥 → exit 2，直接拒绝（防止真退钱）
 */
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(repoRoot, "package.json"));

const argv = process.argv.slice(2);
const flags = new Map(
  argv
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...rest] = a.slice(2).split("=");
      return [k, rest.length ? rest.join("=") : "true"];
    })
);
const subId = argv.find((a) => !a.startsWith("--"));
const dry = flags.has("dry");

function bail(message, code = 2) {
  console.error(`\n✗ ${message}\n`);
  process.exit(code);
}

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!dry) {
  if (!subId) bail("用法：STRIPE_SECRET_KEY=sk_test_xxx node scripts/qa/refund-testmode.mjs sub_xxx [--amount=5]");
  if (!key) bail("缺少 STRIPE_SECRET_KEY 环境变量");
  if (key.startsWith("sk_live_")) bail("拒绝在 live 密钥下执行 —— 这会真的退钱。请用 test mode 的 sk_test_。");
  if (!key.startsWith("sk_test_")) bail("只接受 test mode 密钥（sk_test_ 开头）");
}

// ---- 用项目自己的 typescript 把真实模块转成 CJS，然后加载 -------------------
let ts;
try {
  ts = require("typescript");
} catch {
  bail("找不到 typescript —— 先在本仓库执行 `npm ci`（本机 node_modules 需要完整安装）");
}

const outDir = mkdtempSync(path.join(tmpdir(), "refund-e2e-"));
for (const name of ["config", "invoice-payment", "refund"]) {
  const file = path.join(repoRoot, "src/lib/stripe", `${name}.ts`);
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: `${name}.ts`,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const errors = (diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    bail(
      `${name}.ts 转译失败：` +
        errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; ")
    );
  }
  writeFileSync(path.join(outDir, `${name}.js`), outputText);
}

const { executeSubscriptionRefund, STRIPE_REFUND_REASONS } = require(
  path.join(outDir, "refund.js")
);
const { STRIPE_API_VERSION } = require(path.join(outDir, "config.js"));

if (typeof executeSubscriptionRefund !== "function") {
  bail("refund.js 没有导出 executeSubscriptionRefund —— 模块结构变了，先修脚本");
}

if (dry) {
  console.log("✓ 模块编译并加载成功");
  console.log(`  executeSubscriptionRefund: function`);
  console.log(`  STRIPE_API_VERSION: ${STRIPE_API_VERSION}`);
  console.log(`  reason 白名单: ${STRIPE_REFUND_REASONS.join(", ")}`);
  process.exit(0);
}

// ---- 真实 Stripe test mode 调用 -------------------------------------------
const stripeModule = require("stripe");
const Stripe = stripeModule.default ?? stripeModule;
const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });

const amount = flags.has("amount") ? Number(flags.get("amount")) : undefined;
if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
  bail(`--amount 需要正数（单位：元），当前是 ${flags.get("amount")}`);
}
const reason = flags.get("reason") ?? undefined;

console.log(`→ 订阅 ${subId}${amount === undefined ? "（全额）" : `（部分 ${amount} 元）`}`);

let result;
try {
  result = await executeSubscriptionRefund(stripe, {
    stripeSubscriptionId: subId,
    amount,
    reason,
  });
} catch (error) {
  // 与路由行为一致：Stripe 侧异常不折叠成「业务失败」，而是向上抛（路由 → 500）。
  // 这里只负责把它打印成人能读的样子，别甩一坨 SDK 原始对象。
  const type = error?.type ?? error?.name ?? "Error";
  const message = error?.message ?? String(error);
  console.error(`\n✗ Stripe 调用抛错：[${type}] ${message}`);
  console.error("  （密钥无效 / 网络不通 / 订阅 id 不存在都会走到这里，不是退款逻辑失败）\n");
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));

if (result.ok) {
  console.log(
    [
      "",
      "✓ 退款成功",
      `  refund.id       ${result.refund.id}`,
      `  refund.amount   ${result.refund.amountCents / 100} ${result.currency ?? ""}`,
      `  发票实付        ${result.amountPaidCents / 100}`,
      `  本次前已退      ${result.refundedBeforeCents / 100}`,
      `  fullyRefunded   ${result.fullyRefunded}`,
      `  标的            ${result.target.kind}:${result.target.id}`,
      `  幂等键          ${result.idempotencyKey}`,
      "",
    ].join("\n")
  );
  process.exit(0);
}

console.error(`\n✗ 退款失败：${result.code} — ${result.message}\n`);
process.exit(1);
