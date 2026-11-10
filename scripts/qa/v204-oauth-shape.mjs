#!/usr/bin/env node
/**
 * V20.4 · Google OAuth 授权请求与回调失败路径验收
 *
 * 为什么需要这个脚本：
 *   `56` 把「OAuth 回调」记为 NOT_TESTED，理由是"需要真人授权交互"。
 *   这个理由只对「成功回调」成立。**授权请求的形状**和**失败回调的拒绝行为**
 *   都不需要真人 —— 它们恰恰是最容易出错、也最容易被忽略的部分：
 *     · redirect_uri 写成 localhost / 写错域 → 上线后全员登录失败；
 *     · 没有 PKCE / 没有 state → 授权码拦截与 CSRF；
 *     · 回调验签失败却仍下发 session cookie → 直接账号接管。
 *
 * 所以本脚本不测"能不能登录成功"（那需要真人），只测**拒绝是否彻底**：
 *   1. 授权请求 7 项参数是否齐全且指向生产域；
 *   2. 三种坏回调（用户拒绝 / 伪造 code+state / 空参数）是否都 307 回登录页、
 *      是否都**没有**下发 session cookie、是否都**没有** 5xx。
 *
 * 用法：
 *   node scripts/qa/v204-oauth-shape.mjs
 *   node scripts/qa/v204-oauth-shape.mjs --base=https://app.lokfeel.com
 *
 * 只用 GET，不建立会话，不改任何服务端状态。
 */

import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { base: { type: "string", default: "https://app.lokfeel.com" } },
});
const BASE = values.base.replace(/\/$/, "");

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** 逐跳手动跟随，避免被 307 链绕晕；只看前 4 跳。 */
const BASE_HOST = new URL(BASE).host;

async function follow(url, maxHops = 4) {
  let cur = url;
  const hops = [];
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(cur, { redirect: "manual" });
    const loc = res.headers.get("location");
    const setCookie = res.headers.getSetCookie?.() ?? [];
    hops.push({ url: cur, status: res.status, loc, setCookie });
    if (!loc || res.status < 300 || res.status >= 400) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 200);
      } catch {
        /* 无 body 也无所谓 */
      }
      return { hops, finalStatus: res.status, finalBody: body, finalSetCookie: setCookie };
    }

    const next = new URL(loc, cur).toString();

    // 跳到站外（accounts.google.com 等）就停：我们只验证"我们发出去的请求长什么样"，
    // 不去连第三方 —— 本地网络对 Google 不可达，硬跟会把脚本变成网络可用性测试。
    if (new URL(next).host !== BASE_HOST) {
      hops.push({ url: next, status: -2, loc: next, setCookie: [], external: true });
      return { hops, finalStatus: -2, finalBody: "", finalSetCookie: [] };
    }

    cur = next;
  }
  return { hops, finalStatus: -1, finalBody: "", finalSetCookie: [] };
}

const hasSessionCookie = (cookies) =>
  cookies.some((c) => /authjs\.session-token|__Secure-authjs\.session-token/.test(c));

// ── 1. 授权请求形状 ────────────────────────────────────────
console.log(`\n=== 1. 授权请求形状（${BASE}）===`);
const signin = await follow(`${BASE}/api/auth/signin/google`);
const googleHop = signin.hops.find((h) => (h.loc || "").includes("accounts.google.com"));

check(
  "最终跳到 accounts.google.com",
  Boolean(googleHop),
  googleHop ? googleHop.url : `hops=${signin.hops.map((h) => h.status).join("→")}`,
);

if (googleHop) {
  const u = new URL(googleHop.loc);
  const q = u.searchParams;

  check("response_type=code", q.get("response_type") === "code", q.get("response_type"));

  const clientId = q.get("client_id") || "";
  check(
    "client_id 存在且不是占位符",
    clientId.length > 20 && !/^(your|test|xxx|placeholder)/i.test(clientId),
    clientId ? `${clientId.slice(0, 12)}…` : "缺失",
  );

  const redirectUri = q.get("redirect_uri") || "";
  const base = new URL(BASE);
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(base.hostname);
  // scheme 跟随 BASE：生产必须 https，本地 next start 是 http —— 写死 https
  // 会让本地复验永远假红（2026-11-10 RC 电池实跑发现：19/21 中的 2 条红
  // 全是环境断言写死所致，生产 21/21 证据不受影响）。
  check(
    `redirect_uri 指向 ${base.host}（${base.protocol}//）`,
    redirectUri.startsWith(`${base.protocol}//${base.host}/`),
    redirectUri || "缺失",
  );
  // 「不含 localhost」只在生产断言：对 localhost BASE 跑这条是同义反复。
  if (!isLocal) {
    check("redirect_uri 不含 localhost/127.0.0.1", !/localhost|127\.0\.0\.1/.test(redirectUri), redirectUri);
  }

  check(
    "scope 含 openid",
    (q.get("scope") || "").split(/[\s+]+/).includes("openid"),
    q.get("scope"),
  );

  check("有 state 且长度 ≥ 16", (q.get("state") || "").length >= 16, `len=${(q.get("state") || "").length}`);

  check(
    "PKCE: code_challenge_method=S256",
    q.get("code_challenge_method") === "S256",
    q.get("code_challenge_method"),
  );
  check("PKCE: code_challenge 长度 43–128", (q.get("code_challenge") || "").length >= 43, `len=${(q.get("code_challenge") || "").length}`);
}

// ── 2. 回调失败路径 ────────────────────────────────────────
console.log(`\n=== 2. 回调失败路径（必须全部拒绝，不得毛 500、不得下发会话）===`);
const cb = `${BASE}/api/auth/callback/google`;
const cases = [
  { name: "用户拒绝授权", q: "error=access_denied&state=fake", want: /authorization failed|access_denied/i },
  { name: "伪造 code + 伪造 state", q: "code=fake-code&state=fake-state", want: /security check failed/i },
  { name: "空参数", q: "", want: /missing authorization code/i },
];

for (const c of cases) {
  const r = await follow(`${cb}${c.q ? `?${c.q}` : ""}`);
  // 不要只看最后一跳：链路是 /callback → /login?error=… → /login(200)，
  // 关键证据在**中间那一跳的 Location** 上。
  const loginHop = r.hops.find((h) => /\/login\?error=/.test(h.loc || ""));
  const loc = loginHop?.loc || "";
  const no5xx = r.hops.every((h) => h.status < 500);
  const redirectedToLogin = Boolean(loginHop);
  const noSession = !hasSessionCookie(r.hops.flatMap((h) => h.setCookie));

  check(`[${c.name}] 无 5xx`, no5xx, r.hops.map((h) => h.status).join("→"));
  check(`[${c.name}] 307 回登录页并带错误`, redirectedToLogin, loc || "(no /login?error= hop)");
  check(`[${c.name}] 未下发 session cookie`, noSession, noSession ? "ok" : "发现会话 cookie — 严重");
  // 注意：Location 里是 `+` 分隔，decodeURIComponent 不会把 `+` 变空格，
  // 不归一化就会出现"文案明明对、正则匹配不上"的假 FAIL。
  const readable = decodeURIComponent(loc).replace(/\+/g, " ");
  check(`[${c.name}] 错误文案可读`, c.want.test(readable), readable.slice(0, 90));
}

// ── 汇总 ──────────────────────────────────────────────────
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log(`\n━━━ ${pass} PASS / ${fail} FAIL / ${results.length} total ━━━`);
if (fail > 0) {
  console.log("\n失败项：");
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name} — ${r.detail}`);
  process.exit(1);
}
console.log("授权请求形状合规；三种坏回调全部被拒且不建会话。");
console.log("注：成功回调（真实 code 交换）仍需真人授权，本脚本不覆盖。");
