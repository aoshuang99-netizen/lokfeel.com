#!/usr/bin/env node
/**
 * 认证面导航契约探针（V18 · 2026-10-22）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么需要它
 * ------------
 * CI 的 `authed-mobile.spec.ts` 有约 1/3 的用例在「登录 → 跳 /dashboard」这一步
 * 报 `net:ERR_FAILED`，且**每次失败的用例都不同**（不是固定的某几条）。
 * `net:ERR_FAILED` 是 Chromium 的**网络层**兜底码，它同时覆盖
 * 「服务端把响应掐断」「重定向到连不上的地址」「导航被中途替换」等多种情形。
 * 只看浏览器侧的报错，永远分不清是**服务端行为**还是**浏览器导航**的问题。
 *
 * 这个探针把同一段流程用**纯 HTTP**（不带浏览器）走一遍：
 *   POST /api/auth/login → 拿 Set-Cookie → 带 cookie GET /dashboard 与 /console。
 * 于是判据被拆成两条互斥的：
 *   · 探针失败  ⇒ 服务端/重定向有问题，是**产品缺陷**，与移动端版面无关；
 *   · 探针通过  ⇒ 服务端这条路是通的，浏览器侧的失败属于**导航/并发**问题，
 *                  该去查浏览器与用例写法，而不是查登录接口。
 *
 * 只读：不发任何写请求，不建数据，不碰远程库（纯 HTTP，不需要 db）。
 *
 * 用法：
 *   node scripts/qa/probe-authed-nav.mjs --base=http://127.0.0.1:3000 \
 *     --email=<E2E_AUTHED_EMAIL> --password=<E2E_AUTHED_PASSWORD> [--rounds=3]
 *   （也可用环境变量 E2E_AUTHED_EMAIL / E2E_AUTHED_PASSWORD）
 */

const args = new Map(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), 'true'];
  }),
);

const BASE = (args.get('base') || process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const EMAIL = args.get('email') || process.env.E2E_AUTHED_EMAIL || '';
const PASSWORD = args.get('password') || process.env.E2E_AUTHED_PASSWORD || '';
const ROUNDS = Number(args.get('rounds') || 3);

/** 探针必须有账号：缺了要判红，不能"没账号所以跳过"。 */
if (!EMAIL || !PASSWORD) {
  console.error('::error::缺少 E2E_AUTHED_EMAIL / E2E_AUTHED_PASSWORD —— 先跑 seed-authed-e2e-user.mjs');
  process.exit(2);
}

/** 手动跟随重定向：需要看到**每一跳**的状态码与 Location，而不是只看最终页。 */
async function fetchChain(url, init, maxHops = 5) {
  const hops = [];
  let current = url;
  let opts = { ...init, redirect: 'manual' };

  for (let i = 0; i < maxHops; i += 1) {
    const res = await fetch(current, opts);
    const location = res.headers.get('location');
    hops.push({ url: current, status: res.status, location });
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      // 重定向之后不再重复发 body（303/302 语义），cookie 由下面统一带上
      opts = { method: 'GET', headers: opts.headers, redirect: 'manual' };
      continue;
    }
    const body = await res.text();
    return { hops, status: res.status, body };
  }
  return { hops, status: 0, body: '（重定向超过 5 跳，判定为环）' };
}

function fmt(hops) {
  return hops
    .map((h) => `    ${String(h.status).padEnd(4)} ${h.url}${h.location ? `  →  ${h.location}` : ''}`)
    .join('\n');
}

let failures = 0;
const seen = new Set();

for (let round = 1; round <= ROUNDS; round += 1) {
  // ── 1. 登录：必须 200 且下发会话 cookie ──────────────────────────
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, referer: `${BASE}/login` },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const setCookies = loginRes.headers.getSetCookie?.() ?? [];
  const sessionCookie = setCookies
    .map((c) => c.split(';')[0])
    .filter((c) => /session-token/.test(c))
    .join('; ');
  const loginBody = await loginRes.text();

  if (loginRes.status !== 200 || !sessionCookie) {
    failures += 1;
    console.log(`  ✗ 第 ${round} 轮 登录失败：${loginRes.status} cookie=${sessionCookie ? '有' : '无'}`);
    console.log(`    响应：${loginBody.slice(0, 200)}`);
    continue;
  }

  // ── 2. 带 cookie 走认证面：每一步都必须 200，不能出现 307 回 /login ──
  for (const path of ['/dashboard', '/console', '/workspace']) {
    const r = await fetchChain(`${BASE}${path}`, {
      method: 'GET',
      headers: { cookie: sessionCookie },
    });
    const landedOnLogin = r.hops.some((h) => h.location && h.location.includes('/login'));
    const ok = r.status === 200 && !landedOnLogin;

    if (!ok) {
      failures += 1;
      console.log(`  ✗ 第 ${round} 轮 ${path} → 最终 ${r.status}${landedOnLogin ? '（被踢回 /login）' : ''}`);
      console.log(fmt(r.hops));
      if (r.body) console.log(`    响应片段：${r.body.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
    seen.add(`${path} ${ok ? 'ok' : 'bad'}`);
  }

  if (![...seen].some((s) => s.endsWith('bad'))) {
    console.log(`  ✓ 第 ${round} 轮：登录 → /dashboard → /console → /workspace 全部 200`);
  }
}

if (failures > 0) {
  console.log('');
  console.log('::error::认证面导航契约失败 —— 这是**服务端/重定向**问题，不是移动端版面问题。');
  console.log('  判据：浏览器用例报 net:ERR_FAILED 时，先看这里是不是也红；这里红就别去查排版。');
  process.exit(1);
}

console.log('');
console.log(`✅ 认证面导航契约：${ROUNDS} 轮全部 200（服务端这条路是通的）`);
