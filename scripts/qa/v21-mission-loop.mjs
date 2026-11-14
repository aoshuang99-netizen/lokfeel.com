#!/usr/bin/env node
/**
 * V21 · C05 真实取证：Mission 闭环（create → list → detail → 状态迁移 → 幂等）
 * ═══════════════════════════════════════════════════════════════════
 * 只打本地构建产物 + 隔离 file: 库（同 CI e2e job 闸门），不碰生产。
 *
 * 断言（gates V21-G07 / V21-G08）：
 *   1. POST /api/v1/missions（Idempotency-Key）→ 201 + 服务端 id
 *   2. 同键同体重放 → Idempotent-Replayed:true 且同 id（不重复创建）
 *   3. GET /api/v1/missions 列表包含该任务（状态连续）
 *   4. GET /api/v1/missions/{id} 详情字段与创建一致
 *   5. POST .../pause {action:'publish'} → ACTIVE；再 {action:'close'} → CLOSED
 *   6. 非法迁移（CLOSED 再 publish）→ 409（状态机真的在服务端裁决）
 *
 * 用法：node scripts/qa/v21-mission-loop.mjs --base=http://127.0.0.1:3214
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
const OUT = path.resolve(ROOT, argOf('out', 'docs/v21/evidence/codex/c05'));
const creds = JSON.parse(fs.readFileSync(path.join(ROOT, '.qa-authed-e2e.local.json'), 'utf-8'));

const ev = { task: 'C05 Mission 闭环', base: BASE, startedAt: new Date().toISOString(), steps: [] };
const step = (name, ok, detail) => {
  ev.steps.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) {
    ev.verdict = 'FAIL';
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'mission-loop.json'), JSON.stringify(ev, null, 2));
    process.exit(1);
  }
};

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE, referer: `${BASE}/login` },
  body: JSON.stringify({ email: creds.email, password: creds.password }),
});
const cookie = (loginRes.headers.getSetCookie?.() ?? [])
  .map((c) => c.split(';')[0])
  .filter((c) => /session/i.test(c))
  .join('; ');
step('登录 200 + 会话 cookie', loginRes.status === 200 && !!cookie, `HTTP ${loginRes.status}`);

const H = { 'content-type': 'application/json', origin: BASE, referer: BASE, cookie };
const key = crypto.randomUUID();
const body = JSON.stringify({
  title: 'V21 取证任务：渠道伙伴对接',
  goal: '30 天内对接 20 家渠道伙伴，验证联名内容的转化效果。',
  offer: '提供联名内容与线下场地支持。',
  successCriteria: '至少 20 家完成首轮沟通，其中 5 家进入联名方案阶段。',
  constraints: ['不承诺独家'],
});

const create = await fetch(`${BASE}/api/v1/missions`, {
  method: 'POST',
  headers: { ...H, 'Idempotency-Key': key },
  body,
});
const created = await create.json().catch(() => null);
const mission = created?.data ?? null;
step('POST /api/v1/missions → 201 且返回 id', create.status === 201 && !!mission?.id, `HTTP ${create.status} id=${mission?.id ?? '-'}`);

const replay = await fetch(`${BASE}/api/v1/missions`, {
  method: 'POST',
  headers: { ...H, 'Idempotency-Key': key },
  body,
});
const replayed = await replay.json().catch(() => null);
step(
  '同键同体重放 → 头 Idempotent-Replayed + 同 id',
  replay.headers.get('Idempotent-Replayed') === 'true' && replayed?.data?.id === mission.id,
  `HTTP ${replay.status} replayed=${replay.headers.get('Idempotent-Replayed')}`,
);

const list = await fetch(`${BASE}/api/v1/missions?page=1&pageSize=10`, { headers: H });
const listJson = await list.json().catch(() => null);
const items = Array.isArray(listJson?.data) ? listJson.data : (listJson?.data?.items ?? []);
step('列表包含该任务（状态连续）', list.status === 200 && items.some((m) => m.id === mission.id), `共 ${items.length} 条`);

const detail = await fetch(`${BASE}/api/v1/missions/${mission.id}`, { headers: H });
const detailJson = await detail.json().catch(() => null);
step(
  '详情字段与创建一致（标题/状态）',
  detail.status === 200 && detailJson?.data?.title === 'V21 取证任务：渠道伙伴对接',
  `status=${detailJson?.data?.status}`,
);

const publish = await fetch(`${BASE}/api/v1/missions/${mission.id}/pause`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ action: 'publish' }),
});
const published = await publish.json().catch(() => null);
step('publish → ACTIVE', publish.status === 200 && published?.data?.status === 'ACTIVE', `HTTP ${publish.status} status=${published?.data?.status}`);

const close = await fetch(`${BASE}/api/v1/missions/${mission.id}/pause`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ action: 'close' }),
});
const closed = await close.json().catch(() => null);
step('close → CLOSED', close.status === 200 && closed?.data?.status === 'CLOSED', `HTTP ${close.status} status=${closed?.data?.status}`);

const illegal = await fetch(`${BASE}/api/v1/missions/${mission.id}/pause`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ action: 'publish' }),
});
step('CLOSED 再 publish → 409（状态机在服务端裁决）', illegal.status === 409, `HTTP ${illegal.status}`);

// 清理：取证任务留在隔离库里无害，但再跑会累积 —— 关闭态已足够，不删（删除需要 mission.delete 且会写审计）
ev.completedAt = new Date().toISOString();
ev.missionId = mission.id;
ev.verdict = 'PASS';
fs.mkdirSync(OUT, { recursive: true });
const outPath = path.join(OUT, 'mission-loop.json');
fs.writeFileSync(outPath, JSON.stringify(ev, null, 2));
console.log(`\n✅ Mission 闭环真实打通（create → replay → list → detail → publish → close → 409）`);
console.log(`证据已写入 ${outPath}`);
