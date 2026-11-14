#!/usr/bin/env node
/**
 * V21 · C03 真实取证：IntentGateway 服务端链路（INTENT_EXTRACTION agent run）
 * ═══════════════════════════════════════════════════════════════════════
 * 只打**本地构建产物** + 隔离 file: 库（与 CI e2e job 同一套闸门），不碰生产。
 *
 * 验证四件事（对应 gates V21-G05 / V21-G08）：
 *   1. `POST /api/v1/agents/runs`（skill=INTENT_EXTRACTION）真的走了一次服务端编排
 *      —— 归因 providerKind 如实记录（workbuddy/openai = 模型；rules = 规则降级）。
 *   2. proposal（唯一可渲染来源）通过契约形状：version=1.2 + nodes 数组。
 *   3. 幂等：同键同体重放 → `replayed:true` 且 runId 相同（不重复创建/计费）。
 *   4. 列表可见：`GET /api/v1/agents/runs?limit=5` 能读到这条运行。
 *
 * ⚠️ 本脚本会**消耗一次组织 agent 额度**（真实模型调用）—— 这是产品行为，
 *    不是测试债。本地隔离库里额度本就是种子值。
 *
 * 用法：
 *   node scripts/qa/v21-intent-gateway.mjs --base=http://127.0.0.1:3214 \
 *     --creds=.qa-authed-e2e.local.json --out=docs/v21/evidence/codex/c03
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const argOf = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = (argOf('base', 'http://127.0.0.1:3214') || '').replace(/\/$/, '');
const CREDS = path.resolve(ROOT, argOf('creds', '.qa-authed-e2e.local.json'));
const OUT_DIR = path.resolve(ROOT, argOf('out', 'docs/v21/evidence/codex/c03'));

const creds = JSON.parse(fs.readFileSync(CREDS, 'utf-8'));
const goal = '两周内约到 10 位目标用户做深度访谈，我们提供产品内测名额作为对价，每人聊 30 分钟。';

const evidence = {
  task: 'C03 IntentGateway 真实服务端链路',
  base: BASE,
  startedAt: new Date().toISOString(),
  steps: [],
  verdict: null,
};
function step(name, ok, detail) {
  evidence.steps.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) {
    evidence.verdict = 'FAIL';
    console.error('FAIL');
    process.exit(1);
  }
}

// ── 1. 登录（真实表单同款 HTTP 登录）──────────────────────────────────
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE, referer: `${BASE}/login` },
  body: JSON.stringify({ email: creds.email, password: creds.password }),
});
const setCookies = loginRes.headers.getSetCookie?.() ?? [];
const sessionCookie = setCookies
  .map((c) => c.split(';')[0])
  .filter((c) => /session/i.test(c))
  .join('; ');
step('登录 200 且下发会话 cookie', loginRes.status === 200 && !!sessionCookie, `HTTP ${loginRes.status}`);

const headers = {
  'content-type': 'application/json',
  origin: BASE,
  referer: BASE,
  cookie: sessionCookie,
};

// ── 2. 发起一次真实理解（INTENT_EXTRACTION）────────────────────────────
const key = crypto.randomUUID();
const runBody = JSON.stringify({ skill: 'INTENT_EXTRACTION', input: { goal } });
const runRes = await fetch(`${BASE}/api/v1/agents/runs`, {
  method: 'POST',
  headers: { ...headers, 'Idempotency-Key': key },
  body: runBody,
});
const runJson = await runRes.json().catch(() => null);
const run = runJson?.data?.run ?? null;
step(
  'POST /api/v1/agents/runs 2xx 且返回 run',
  runRes.status >= 200 && runRes.status < 300 && !!run?.id,
  `HTTP ${runRes.status} status=${run?.status} provider=${run?.providerKind} degrade=${run?.degradeCode ?? 'null'}`,
);
step(
  'proposal 形状 = WorkspaceSpec v1.2（version + nodes 数组）',
  run?.proposal?.version === '1.2' && Array.isArray(run?.proposal?.nodes),
  `title=${run?.proposal?.title ?? '(null)'} nodes=${run?.proposal?.nodes?.length ?? 0}`,
);
step(
  '归因如实（providerKind ∈ workbuddy/openai/rules）',
  ['workbuddy', 'openai', 'rules'].includes(run?.providerKind),
  `providerKind=${run?.providerKind}`,
);
if (run?.status === 'DEGRADED') {
  console.log(`  ⚠ 诚实降级：${run?.reason}`);
}
if (run?.injectionFlagged) {
  console.log('  ⚠ 注入信号被标记（如实透出）');
}

// ── 3. 幂等重放：同键同体 → 同一条 run，不重复创建──────────────────────
const replayRes = await fetch(`${BASE}/api/v1/agents/runs`, {
  method: 'POST',
  headers: { ...headers, 'Idempotency-Key': key },
  body: runBody,
});
const replayJson = await replayRes.json().catch(() => null);
const replayRun = replayJson?.data?.run ?? null;
step(
  '同键同体重放 → replayed:true 且 runId 相同',
  replayJson?.data?.replayed === true && replayRun?.id === run.id,
  `HTTP ${replayRes.status} replayed=${replayJson?.data?.replayed}`,
);

// ── 4. 列表可见（状态连续）────────────────────────────────────────────
const listRes = await fetch(`${BASE}/api/v1/agents/runs?limit=5`, { headers });
const listJson = await listRes.json().catch(() => null);
const items = listJson?.data?.items ?? listJson?.data?.runs ?? [];
step(
  'GET /api/v1/agents/runs 列表能读到这条运行',
  listRes.status === 200 && Array.isArray(items) && items.some((r) => r?.id === run.id),
  `HTTP ${listRes.status} 列表 ${items.length} 条`,
);

evidence.completedAt = new Date().toISOString();
evidence.run = {
  id: run.id,
  status: run.status,
  providerKind: run.providerKind,
  degradeCode: run.degradeCode ?? null,
  reason: run.reason ?? null,
  proposalTitle: run.proposal?.title ?? null,
  proposalNodes: run.proposal?.nodes?.length ?? 0,
  costMicroCents: run.costMicroCents ?? null,
  requiresApproval: run.requiresApproval ?? null,
  injectionFlagged: run.injectionFlagged ?? null,
};
evidence.verdict = run.providerKind === 'rules' ? 'PASS_DEGRADED' : 'PASS_AI';
evidence.goal = goal;

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, 'intent-gateway.json');
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
console.log(`\n${evidence.verdict === 'PASS_AI' ? '✅ AI 路径真实打通' : '✅ 规则降级路径真实打通（诚实标注）'}`);
console.log(`证据已写入 ${outPath}`);
