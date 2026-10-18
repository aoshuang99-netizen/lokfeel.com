#!/usr/bin/env node
/**
 * 退款链路端到端验证（**无需 Stripe 账号**）：真实 SDK + 真实 HTTP + 本地 Stripe 协议服务端。
 *
 * 与 `refund-testmode.mjs` 的分工：
 *   · `refund-testmode.mjs` —— 有 `sk_test_` 时打**真 Stripe**，验证服务端语义；
 *   · 本脚本 —— 没有密钥时验证**我们这一侧**：SDK 请求构造是否合法、expand 是否带上、
 *     `invoice.payments` 与回落 `invoicePayments.list` 两条路径、已退金额累计、
 *     幂等键、部分/全额判定、超额拦截。
 *
 * 它不做 mock 函数替换：起一个真实 HTTP 服务端，Stripe SDK 照常发请求，
 * 只是把 host 重定向到本地。所以序列化、query 编码、Header（含 Idempotency-Key）
 * 都是真的；唯一不是真的是 Stripe 的账务与风控。
 *
 * 用法：
 *   node scripts/qa/refund-e2e.mjs
 *   node scripts/qa/refund-e2e.mjs --repo=/path/to/nexus-app   # 从别的目录跑
 */
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const repoFlag = argv.find((a) => a.startsWith("--repo="));
const repoRoot = repoFlag ? path.resolve(repoFlag.slice("--repo=".length)) : path.resolve(here, "../..");

const { createFakeStripe } = await import("./stripe-fake-server.mjs");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "🔴"} ${name}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// ── 用项目自己的 typescript 把真实模块转成 CJS ───────────────────────────────
let ts;
try {
  ts = require("typescript");
} catch {
  console.error("✗ 找不到 typescript：先在仓库执行 `npm ci`");
  process.exit(2);
}

const outDir = mkdtempSync(path.join(tmpdir(), "refund-e2e-"));
for (const name of ["invoice-payment", "refund"]) {
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
    console.error(
      `✗ ${name}.ts 转译失败：` +
        errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; ")
    );
    process.exit(2);
  }
  writeFileSync(path.join(outDir, `${name}.js`), outputText);
}

const { executeSubscriptionRefund } = require(path.join(outDir, "refund.js"));
const stripeModule = require("stripe");
const Stripe = stripeModule.default ?? stripeModule;

/** 把 SDK 的请求重定向到本地端口；其余（方法/路径/Header/Body）原样透传。 */
function localHttpClient(port) {
  return {
    getClientName: () => "local-fake-stripe",
    async makeRequest(_host, _port, requestPath, method, headers, body) {
      const res = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
      });
      const text = await res.text();
      const responseHeaders = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      // `getRawResponse()` 必须是**可写对象**：SDK 会往上挂 requestId/stripeAccount 等
      // （见 RequestSender._addHeadersDirectlyToObject）。真 FetchHttpClient 返回的是
      // Response 对象；这里用普通对象等价替代，不能返回响应体字符串。
      const raw = { statusCode: res.status, headers: responseHeaders, body: text };
      return {
        getStatusCode: () => res.status,
        getHeaders: () => responseHeaders,
        getRawResponse: () => raw,
        toStream: () => {
          throw new Error("toStream 不在本链路使用");
        },
        toJSON: async () => JSON.parse(text),
      };
    },
  };
}

const server = await createFakeStripe({ inlinePayments: false, amountPaid: 1000 });
const stripe = new Stripe("sk_test_local_only", {
  httpClient: localHttpClient(server.port),
  maxNetworkRetries: 0,
});

const SUB = server.state.subscriptionId;
const PI = server.state.paymentIntentId;

/** 从请求日志里按条件筛选。 */
const find = (predicate) => server.requests.filter(predicate);
const postRefunds = () => find((r) => r.method === "POST" && r.path === "/v1/refunds");

console.log(`本地 Stripe 服务端：${server.url}（订阅 ${SUB}）\n`);

// ── 场景 A：发票**不带** payments ⇒ 必须回落 invoice_payments ────────────────
console.log("场景 A · 未内联 payments（回落 invoice_payments）+ 全额退款");
const first = await executeSubscriptionRefund(stripe, { stripeSubscriptionId: SUB, type: "full" });
check("首次全额退款成功", first.ok === true, first.ok ? "" : first.code);
check("退款金额 = 发票实付 1000 分", first.refund?.amountCents === 1000, String(first.refund?.amountCents));
check("fullyRefunded = true", first.fullyRefunded === true);
check("标的解析为 payment_intent", first.target?.kind === "payment_intent" && first.target?.id === PI, `${first.target?.kind}:${first.target?.id}`);
check(
  "回落到 GET /v1/invoice_payments",
  find((r) => r.method === "GET" && r.path === "/v1/invoice_payments").length === 1
);
const subReq = find((r) => r.method === "GET" && r.path.startsWith("/v1/subscriptions/"))[0];
check(
  "订阅请求带 expand[]=latest_invoice",
  Object.entries(subReq?.query ?? {}).some(([k, v]) => (k === "expand" || k.startsWith("expand[")) && v === "latest_invoice"),
  JSON.stringify(subReq?.query)
);
const created = postRefunds()[0];
check("POST /v1/refunds 带 Idempotency-Key", Boolean(created?.headers["idempotency-key"]), created?.headers["idempotency-key"]);
check(
  "幂等键格式 = admin-refund:<pi>:<已退>:<本次>",
  created?.headers["idempotency-key"] === `admin-refund:${PI}:0:1000`,
  created?.headers["idempotency-key"]
);
check("请求体含 amount=1000 与默认 reason", created?.form?.amount === "1000" && created?.form?.reason === "requested_by_customer", JSON.stringify(created?.form));

// ── 场景 B：同一发票再退 ⇒ 必须在调用 Stripe 前被拦下 ──────────────────────
console.log("\n场景 B · 重复退款（已退干净）");
const before = postRefunds().length;
const second = await executeSubscriptionRefund(stripe, { stripeSubscriptionId: SUB, type: "full" });
check("返回 nothing_refundable", second.ok === false && second.code === "nothing_refundable", second.code);
check("没有新增 POST /v1/refunds", postRefunds().length === before, `${postRefunds().length - before} 次`);

// ── 场景 C：发票**内联** payments ⇒ 不该再调 invoice_payments ──────────────
console.log("\n场景 C · 内联 payments + 部分退款 3 元");
server.reset({ inlinePayments: true, amountPaid: 1000 });
const paymentsCallsBefore = find((r) => r.path === "/v1/invoice_payments").length;
const partial = await executeSubscriptionRefund(stripe, {
  stripeSubscriptionId: SUB,
  type: "partial",
  amount: 3,
});
check("部分退款成功", partial.ok === true, partial.ok ? "" : partial.code);
check("金额 = 300 分", partial.refund?.amountCents === 300, String(partial.refund?.amountCents));
check("fullyRefunded = false（部分退款不取消订阅）", partial.fullyRefunded === false);
check(
  "走内联 payments，未再调 invoice_payments",
  find((r) => r.path === "/v1/invoice_payments").length === paymentsCallsBefore
);

// ── 场景 D：超额 ⇒ 调用 Stripe 前就拒绝 ─────────────────────────────────────
console.log("\n场景 D · 超额退款");
const over = await executeSubscriptionRefund(stripe, {
  stripeSubscriptionId: SUB,
  type: "partial",
  amount: 9999,
});
check("返回 amount_exceeds_refundable", over.ok === false && over.code === "amount_exceeds_refundable", over.code);

// ── 场景 E：部分退款后把余额退干净 ⇒ fullyRefunded 必须翻成 true ────────────
console.log("\n场景 E · 退掉剩余 7 元");
const rest = await executeSubscriptionRefund(stripe, { stripeSubscriptionId: SUB, type: "full" });
check("成功", rest.ok === true, rest.ok ? "" : rest.code);
check("本次金额 = 剩余 700 分", rest.refund?.amountCents === 700, String(rest.refund?.amountCents));
check("fullyRefunded = true", rest.fullyRefunded === true);
check("累计已退 = 1000 分", rest.refundedBeforeCents + rest.refund.amountCents === 1000);

await server.close();

console.log(
  `\n${failures === 0 ? "✅ 全部通过" : `🔴 ${failures} 项失败`}` +
    `（HTTP 请求 ${server.requests.length} 次，覆盖 5 个场景）\n`
);
process.exit(failures === 0 ? 0 : 1);
