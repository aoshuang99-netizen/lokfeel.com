#!/usr/bin/env node
/**
 * 本地 Stripe 协议服务端（仅退款链路用到的那几个端点）。
 *
 * 用途：生产没有 `STRIPE_*`，拿不到 `sk_test_`，但退款链路又必须端到端验证。
 * 这个服务端**不是 mock 函数**：它监听真实 HTTP 端口，按 Stripe REST 的形状
 * 收发 JSON / form-urlencoded，真实 Stripe SDK 打过来的是什么请求，它就回什么响应。
 * 于是被验证的仍然是「SDK 请求构造 + 我们的业务代码」，只是把 Stripe 的服务端
 * 换成了本地实现。
 *
 * 覆盖的端点：
 *   GET  /v1/subscriptions/:id        （含 expand[]=latest_invoice）
 *   GET  /v1/invoice_payments         （按 invoice 列收款记录）
 *   GET  /v1/refunds                  （按 payment_intent / charge 列已退）
 *   POST /v1/refunds                  （创建退款，支持 Idempotency-Key）
 *
 * 它**不模拟** Stripe 的余额、风控、结算与真实退款状态机 —— 那是只有真
 * Stripe test mode 才能给的部分，见 `refund-testmode.mjs`。
 */
import http from "node:http";

const json = (res, status, body, extraHeaders = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "request-id": `req_local_${Math.random().toString(36).slice(2, 10)}`,
    ...extraHeaders,
  });
  res.end(payload);
};

/** 把 `a[b][0]=x` 这类 Stripe 风格表单键还原成普通对象（只处理本链路用到的层级）。 */
function parseForm(raw) {
  const out = {};
  const params = new URLSearchParams(raw);
  for (const [key, value] of params.entries()) {
    const m = key.match(/^([^[]+)((\[[^\]]*\])*)$/);
    if (!m) continue;
    const path = [m[1], ...(m[2].match(/\[[^\]]*\]/g) || []).map((s) => s.slice(1, -1))];
    let cursor = out;
    for (let i = 0; i < path.length; i += 1) {
      const seg = path[i];
      const last = i === path.length - 1;
      if (last) {
        if (seg === "" || seg === "0") {
          // `expand[0]` 这类数组：收到即忽略，测试只关心是否出现过 expand
          out.__expand = true;
        } else {
          cursor[seg] = value;
        }
      } else {
        cursor[seg] ??= {};
        cursor = cursor[seg];
      }
    }
  }
  return out;
}

/**
 * 起一个本地 Stripe 服务端。
 * @param {{ amountPaid?: number, inlinePayments?: boolean, currency?: string }} [options]
 */
export async function createFakeStripe(options = {}) {
  const state = {
    subscriptionId: "sub_e2e_local",
    invoiceId: "in_e2e_local",
    paymentIntentId: "pi_e2e_local",
    chargeId: "ch_e2e_local",
    amountPaid: options.amountPaid ?? 1000,
    currency: options.currency ?? "usd",
    /** true ⇒ 发票直接带 `payments`（expand 路径）；false ⇒ 必须回落 invoice_payments。 */
    inlinePayments: options.inlinePayments ?? false,
    refunds: [],
    idempotency: new Map(),
    seq: 0,
  };

  /** 每个请求都记下来，供断言「到底打了哪些接口、带了什么参数」。 */
  const requests = [];

  const invoice = () => {
    const base = {
      id: state.invoiceId,
      object: "invoice",
      amount_paid: state.amountPaid,
      amount_due: 0,
      amount_remaining: 0,
      currency: state.currency,
      status: "paid",
      subscription: state.subscriptionId,
      created: 1_700_000_000,
    };
    if (!state.inlinePayments) return base;
    return {
      ...base,
      payments: {
        object: "list",
        data: [invoicePayment()],
        has_more: false,
        url: `/v1/invoice_payments?invoice=${state.invoiceId}`,
      },
    };
  };

  const invoicePayment = () => ({
    id: "inpay_e2e_local",
    object: "invoice_payment",
    status: "paid",
    is_default: true,
    created: 1_700_000_000,
    invoice: state.invoiceId,
    payment: {
      type: "payment_intent",
      payment_intent: state.paymentIntentId,
      charge: state.chargeId,
    },
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const entry = {
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: req.headers,
        body: raw,
        form: req.method === "POST" ? parseForm(raw) : null,
      };
      requests.push(entry);

      // ---- 订阅：必须支持 expand[]=latest_invoice ----
      if (req.method === "GET" && url.pathname.startsWith("/v1/subscriptions/")) {
        const id = url.pathname.split("/").pop();
        if (id !== state.subscriptionId) {
          return json(res, 404, {
            error: { type: "invalid_request_error", code: "resource_missing", message: `No such subscription: ${id}` },
          });
        }
        // Stripe SDK 把数组序列化成 `expand[0]=latest_invoice`（带下标），
        // 旧式 `expand[]=` 也要接受 —— 两种都见过，别只认一种。
        const expandValues = [...url.searchParams.entries()]
          .filter(([k]) => k === "expand" || k.startsWith("expand["))
          .map(([, v]) => v);
        const wantsExpand = expandValues.includes("latest_invoice");
        return json(res, 200, {
          id: state.subscriptionId,
          object: "subscription",
          status: "active",
          customer: "cus_e2e_local",
          latest_invoice: wantsExpand ? invoice() : state.invoiceId,
        });
      }

      // ---- 发票收款记录 ----
      if (req.method === "GET" && url.pathname === "/v1/invoice_payments") {
        return json(res, 200, {
          object: "list",
          data: [invoicePayment()],
          has_more: false,
          url: "/v1/invoice_payments",
        });
      }

      // ---- 已退金额 ----
      if (req.method === "GET" && url.pathname === "/v1/refunds") {
        const pi = url.searchParams.get("payment_intent");
        const ch = url.searchParams.get("charge");
        const data = state.refunds.filter(
          (r) => (pi && r.payment_intent === pi) || (ch && r.charge === ch)
        );
        return json(res, 200, { object: "list", data, has_more: false, url: "/v1/refunds" });
      }

      // ---- 创建退款（含幂等）----
      if (req.method === "POST" && url.pathname === "/v1/refunds") {
        const form = entry.form || {};
        const key = req.headers["idempotency-key"];
        if (key && state.idempotency.has(key)) {
          return json(res, 200, state.idempotency.get(key));
        }

        const targetPi = form.payment_intent;
        const targetCh = form.charge;
        if (!targetPi && !targetCh) {
          return json(res, 400, {
            error: {
              type: "invalid_request_error",
              code: "parameter_missing",
              message: "Missing required param: payment_intent or charge.",
            },
          });
        }

        const amount = Number(form.amount);
        if (!Number.isInteger(amount) || amount <= 0) {
          return json(res, 400, {
            error: {
              type: "invalid_request_error",
              code: "parameter_invalid_integer",
              message: "Refund amount must be a positive integer in cents.",
            },
          });
        }

        // 服务端也做一次余额校验：超额必须 400，和真 Stripe 一致。
        const refunded = state.refunds
          .filter((r) => r.status !== "failed" && r.status !== "canceled")
          .reduce((sum, r) => sum + r.amount, 0);
        if (refunded + amount > state.amountPaid) {
          return json(res, 400, {
            error: {
              type: "invalid_request_error",
              code: "amount_too_large",
              message: "Refund amount exceeds the refundable amount.",
            },
          });
        }

        state.seq += 1;
        const refund = {
          id: `re_e2e_local_${state.seq}`,
          object: "refund",
          amount,
          currency: state.currency,
          status: "succeeded",
          created: 1_700_000_000 + state.seq,
          payment_intent: targetPi ?? null,
          charge: targetCh ?? null,
          reason: form.reason ?? null,
        };
        state.refunds.push(refund);
        if (key) state.idempotency.set(key, refund);
        return json(res, 200, refund);
      }

      return json(res, 404, {
        error: { type: "invalid_request_error", message: `Unhandled endpoint ${req.method} ${url.pathname}` },
      });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    state,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
    /** 换一份干净的账单状态（保留端口与请求日志）。 */
    reset(next = {}) {
      state.amountPaid = next.amountPaid ?? options.amountPaid ?? 1000;
      state.inlinePayments = next.inlinePayments ?? options.inlinePayments ?? false;
      state.refunds = [];
      state.idempotency.clear();
      state.seq = 0;
    },
  };
}
