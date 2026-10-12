#!/usr/bin/env node
/**
 * T06 · 邮件通道就绪度核验（离线优先）
 *
 * 背景：真实外发缺 `RESEND_API_KEY`（用户明确排除）→ AC-09 的"真实送达"这一条
 * 只能标 BLOCKED。但"接上 key 即可用"（零代码改动）这件事**可以**被坐实。
 * 本脚本把这件事变成可复跑的证据，而不是一句口头承诺。
 *
 * 三层核验：
 *   1. **凭据分类**：读 env，把 `RESEND_API_KEY` 归为
 *      MISSING（沙箱）/ READY（形如 re_xxx）/ MALFORMED（有值但前缀不对 → 会静默落回沙箱，属于误配，必须报红）。
 *   2. **契约漂移**：静态读 `src/lib/workflow/delivery.ts`，断言
 *      `resolveEmailSender` 仍然要求 `re_` 前缀、沙箱分支仍然写 `CAPTURED`。
 *      防的是"某次重构把沙箱判定改没了，通知就静默伪装成已发送"。
 *   3. **真实发送（可选）**：`--send you@example.com` —— 仅在有合法凭据时执行，
 *      走 Resend **官方 HTTP API**（与 `createResendSender` 同形状），打印 provider message id。
 *
 * 退出码：
 *   0 = 就绪（MISSING 也算就绪 —— 沙箱是**合法终态**，不是故障）
 *   1 = MALFORMED 或契约漂移（**必须**修）
 *   2 = `--send` 被请求但无凭据（拒绝静默跳过）
 *
 * 用法：
 *   node scripts/qa/verify-email-channel.mjs
 *   node scripts/qa/verify-email-channel.mjs --send qa@example.com
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DELIVERY = path.join(ROOT, 'src/lib/workflow/delivery.ts');

// ─────────────────────────────────────────────────────────────────────
// env 读取（不打印任何凭据值）
// ─────────────────────────────────────────────────────────────────────

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const fileEnv = {
  ...parseEnvFile(path.join(ROOT, '.env')),
  ...parseEnvFile(path.join(ROOT, '.env.local')),
  ...parseEnvFile(path.join(ROOT, '.env.production')),
};
const env = { ...fileEnv, ...process.env };

// ─────────────────────────────────────────────────────────────────────
// 1) 凭据分类
// ─────────────────────────────────────────────────────────────────────

const rawKey = (env.RESEND_API_KEY || '').trim();
const from = (env.SMTP_FROM || '').trim() || 'noreply@lokfeel.com';

let verdict;
if (!rawKey) verdict = 'MISSING';
else if (/^re_[A-Za-z0-9_-]{6,}$/.test(rawKey)) verdict = 'READY';
else verdict = 'MALFORMED';

const VERDICT_LABEL = {
  MISSING: '⚠️  BLOCKED  — 无凭据 → 邮件走沙箱捕获（CAPTURED），不冒充已发送',
  READY: '✅ READY    — 凭据合法 → 邮件真实外发（SENT）',
  MALFORMED: '🔴 MALFORMED — 有值但前缀非 re_ → 会被 resolveEmailSender 判为无效并**静默落回沙箱**',
};

// ─────────────────────────────────────────────────────────────────────
// 2) 契约漂移检查
// ─────────────────────────────────────────────────────────────────────

function checkContract() {
  const problems = [];
  if (!fs.existsSync(DELIVERY)) {
    return ['找不到 src/lib/workflow/delivery.ts'];
  }
  const src = fs.readFileSync(DELIVERY, 'utf8');

  if (!/export function resolveEmailSender/.test(src)) {
    problems.push('delivery.ts 里没有 resolveEmailSender（唯一凭据判定入口消失）');
  }
  if (!src.includes("startsWith('re_')")) {
    problems.push("resolveEmailSender 不再要求 `re_` 前缀 —— 误配的 key 会被拿去发信");
  }
  if (!/status = 'CAPTURED'/.test(src)) {
    problems.push("delivery.ts 里找不到 `status = 'CAPTURED'` —— 沙箱分支可能被改没了");
  }
  if (!/capturedAt = now/.test(src)) {
    problems.push('未找到 capturedAt 赋值 —— 沙箱证据（内容快照时间）可能丢了');
  }
  if (!/api\.resend\.com\/emails/.test(src)) {
    problems.push('未走 Resend 官方 HTTP API（主指令：不得绕过平台官方 API）');
  }
  return problems;
}

const contractProblems = checkContract();

// ─────────────────────────────────────────────────────────────────────
// 3) 可选：真实发送冒烟
// ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const sendIdx = argv.indexOf('--send');
const sendTo = sendIdx > -1 ? argv[sendIdx + 1] : null;

async function realSend(to) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({
      from: `LokFeel <${from}>`,
      to: [to],
      subject: '[LokFeel] 邮件通道冒烟测试',
      text: '这是一封由 verify-email-channel.mjs 发出的通道冒烟邮件。收到即表示 RESEND_API_KEY 生效。\n\n（系统通知，由社群运营方通过 LokFeel 发出）',
    }),
  });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, text: text.slice(0, 300) };
}

// ─────────────────────────────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────────────────────────────

console.log('\n━━━ T06 邮件通道就绪度 ━━━');
console.log(`凭据来源   : ${env.RESEND_API_KEY ? (process.env.RESEND_API_KEY ? 'process.env' : 'env 文件') : '（无）'}`);
console.log(`发件地址   : ${from}`);
console.log(`通道状态   : ${VERDICT_LABEL[verdict]}`);
console.log(`契约检查   : ${contractProblems.length === 0 ? '✅ 未发现漂移' : `🔴 ${contractProblems.length} 处问题`}`);

if (contractProblems.length > 0) {
  for (const p of contractProblems) console.log(`             · ${p}`);
}

let exitCode = 0;
if (verdict === 'MALFORMED' || contractProblems.length > 0) exitCode = 1;

if (sendTo) {
  console.log(`\n── 真实发送冒烟 → ${sendTo} ──`);
  if (verdict !== 'READY') {
    console.log('❌ 拒绝执行：无合法凭据（--send 不做静默跳过，避免"假绿"）');
    exitCode = 2;
  } else {
    const r = await realSend(sendTo);
    if (r.ok) {
      console.log(`✅ provider 已受理：${r.text}`);
    } else {
      console.log(`❌ provider 拒绝：HTTP ${r.status} ${r.text}`);
      exitCode = 1;
    }
  }
}

if (!sendTo) {
  console.log('\n提示：加 `--send you@example.com` 可在凭据就绪时做一次真实外发冒烟。');
}

console.log(`\n结论：${exitCode === 0 ? '✅ 就绪（接入零代码改动）' : exitCode === 2 ? '⚠️ 无凭据，未发送' : '🔴 需修'}\n`);
process.exit(exitCode);
