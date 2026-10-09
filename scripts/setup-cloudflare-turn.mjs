#!/usr/bin/env node
/**
 * 一键开通 Cloudflare Realtime TURN（路径 C）
 *
 * 它做四件事，且**严格按这个顺序**：
 *   ① 用 CF API 创建一个 Realtime TURN Key（一次性动作，token 只返回一次）
 *   ② 用该 Key **真实签发一次凭据**
 *   ③ 把凭据喂给 `verify-turn-candidate.mjs`，用**真实 Chrome** 确认能收集到 `relay` 候选
 *   ④ **只有第 ③ 步通过**，才写入 Netlify 生产环境变量（TURN_TOKEN_ID / TURN_API_TOKEN）
 *
 * 为什么顺序不能改：TURN 在 ICE 里的优先级是「有则用、无则降级」。一个**配错**的值
 * 会把当前可用的兜底（speed.cloudflare.com）顶掉，把「部分场景能连」换成「更差」，
 * 而且**没有任何报错**。所以必须先证明真能拿到 relay，才允许写进生产。
 *
 * 用法
 *   # 0) 干跑：只验证 CF 凭据权限 + 试签发 + 真实 relay 验证，**不写任何生产配置**
 *   CF_ACCOUNT_ID=<id> CF_API_TOKEN=<token> node scripts/setup-cloudflare-turn.mjs --dry-run
 *
 *   # 1) 正式开通（创建新 Key → 预检 → 写生产 env → 回读）
 *   CF_ACCOUNT_ID=<id> CF_API_TOKEN=<token> NETLIFY_TOKEN=<ntoken> \
 *     node scripts/setup-cloudflare-turn.mjs
 *
 *   # 2) 复用已有 Key（不创建，直接验证并写入 —— 用于 Key 已在 CF 面板建好的情况）
 *   node scripts/setup-cloudflare-turn.mjs --reuse-key <uid>:<api_token>
 *
 *   # 3) 回滚（删除两个 env → 自动回到 speed.cloudflare.com 兜底，代码不用动）
 *   NETLIFY_TOKEN=<ntoken> node scripts/setup-cloudflare-turn.mjs --rollback
 *
 * 环境变量
 *   CF_ACCOUNT_ID    Cloudflare Account ID（CF 面板右侧栏可见）
 *   CF_API_TOKEN     需权限 **Account → Cloudflare Calls:Edit**
 *   NETLIFY_TOKEN    写入/回滚生产 env 时需要（干跑不需要）
 *
 * 选项
 *   --dry-run             不写生产配置（仍会创建 Key，因为签发凭据必须有 Key）
 *   --reuse-key <u>:<t>   跳过创建，直接用给定的 uid + token
 *   --key-name <name>     新建 Key 的名称（默认 lokfeel-turn-<日期>）
 *   --rollback            删除 Netlify 上的两个 env
 *   --skip-preflight      跳过真实浏览器预检（**不建议**，仅离线环境用）
 *   --site <site_id>      覆盖站点 id
 *   --slug <account_slug> 覆盖账户 slug
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// ─────────────────────────────────────────────────────────────────────
// 常量（与 src/lib/rtc/ice-sources.ts 保持一致）
// ─────────────────────────────────────────────────────────────────────

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';
const CF_TURN_CREDS_BASE = 'https://rtc.live.cloudflare.com/v1/turn/keys';
/** 必须与 src/lib/rtc/ice-sources.ts 的 CF_REALTIME_TTL_SECONDS 一致。 */
const TTL_SECONDS = 3600;

const DEFAULT_SITE = 'c46478e9-7ac8-4bcf-9052-7638b04fef83';
const DEFAULT_SLUG = 'aoshuang99';

const ENV_TOKEN_ID = 'TURN_TOKEN_ID';
const ENV_API_TOKEN = 'TURN_API_TOKEN';

// ─────────────────────────────────────────────────────────────────────
// 参数
// ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f, d = '') => {
  const i = argv.indexOf(f);
  return i > -1 && argv[i + 1] ? argv[i + 1] : d;
};

const DRY_RUN = has('--dry-run');
const ROLLBACK = has('--rollback');
const SKIP_PREFLIGHT = has('--skip-preflight');
const SITE_ID = valOf('--site', DEFAULT_SITE);
const SLUG = valOf('--slug', DEFAULT_SLUG);
const REUSE_KEY = valOf('--reuse-key', '');
const KEY_NAME = valOf('--key-name', `lokfeel-turn-${new Date().toISOString().slice(0, 10)}`);

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_API_TOKEN = process.env.CF_API_TOKEN || '';
const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN || process.env.NETLIFY_AUTH_TOKEN || '';

let step = 0;
const say = (m) => console.log(m);
const head = (m) => console.log(`\n${'─'.repeat(64)}\n${++step}. ${m}\n${'─'.repeat(64)}`);
const die = (m, code = 1) => {
  console.error(`\n🔴 ${m}`);
  process.exit(code);
};

// ─────────────────────────────────────────────────────────────────────
// 回滚路径（最短、最安全，先处理）
// ─────────────────────────────────────────────────────────────────────

async function rollback() {
  head('回滚：删除 Netlify 上的 TURN_TOKEN_ID / TURN_API_TOKEN');
  if (!NETLIFY_TOKEN) die('需要 NETLIFY_TOKEN 才能回滚。');

  for (const key of [ENV_TOKEN_ID, ENV_API_TOKEN]) {
    const r = await fetch(
      `https://api.netlify.com/api/v1/accounts/${SLUG}/env/${key}?site_id=${SITE_ID}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` } }
    );
    say(`  DELETE ${key} → HTTP ${r.status}`);
  }

  const left = await readNetlifyTurnEnvs();
  say(`\n回读：剩余 TURN_* 条目 = ${left.length}`);
  for (const e of left) say(`  · ${e.key}`);
  if (left.length === 0) {
    say('\n✅ 已回滚。ICE 来源会自动回到 speed.cloudflare.com 兜底（代码无需改动）。');
    say('   建议随后触发一次 redeploy 并复跑 verify:turn:prod（不设 QA_EXPECT_ICE_SOURCE）。');
  } else {
    die('回读仍有残留，请人工核对。');
  }
}

// ─────────────────────────────────────────────────────────────────────
// Netlify env 读写
// ─────────────────────────────────────────────────────────────────────

const netlifyEnvUrl = () =>
  `https://api.netlify.com/api/v1/accounts/${SLUG}/env?site_id=${SITE_ID}`;

async function readNetlifyTurnEnvs() {
  const r = await fetch(netlifyEnvUrl(), { headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` } });
  if (!r.ok) die(`读取 Netlify env 失败 HTTP ${r.status}`);
  const list = await r.json();
  return (Array.isArray(list) ? list : []).filter((e) => /^TURN_(TOKEN_ID|API_TOKEN)$/.test(e.key));
}

async function writeNetlifyEnvs(uid, apiToken) {
  const body = [
    { key: ENV_TOKEN_ID, values: [uid], is_secret: false, scopes: ['builds', 'functions', 'runtime'] },
    { key: ENV_API_TOKEN, values: [apiToken], is_secret: true, scopes: ['builds', 'functions', 'runtime'] },
  ];
  const r = await fetch(netlifyEnvUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) die(`写入 Netlify env 失败 HTTP ${r.status}：${text.slice(0, 300)}`);
  say(`  POST env → HTTP ${r.status}（写入 201 ≠ 写成功，下面必须回读核对）`);
}

// ─────────────────────────────────────────────────────────────────────
// Cloudflare
// ─────────────────────────────────────────────────────────────────────

async function createTurnKey() {
  head(`创建 Cloudflare Realtime TURN Key（name=${KEY_NAME}）`);
  if (!CF_ACCOUNT_ID) die('缺少 CF_ACCOUNT_ID。CF 面板 → 任意域名概览页右下角可见。');
  if (!CF_API_TOKEN) die('缺少 CF_API_TOKEN。需权限 Account → Cloudflare Calls:Edit。');

  const r = await fetch(`${CF_API_BASE}/accounts/${CF_ACCOUNT_ID}/calls/turn_keys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: KEY_NAME }),
  });
  const data = await r.json().catch(() => ({}));

  if (!r.ok || !data?.success) {
    const errs = (data?.errors || []).map((e) => `${e.code} ${e.message}`).join('; ');
    die(
      `创建失败 HTTP ${r.status}${errs ? ` — ${errs}` : ''}\n` +
        '  常见原因：① token 权限不含 Cloudflare Calls:Edit ② Account ID 不对 ' +
        '③ 该账号未开通 Realtime（CF 面板 → Realtime → 启用一次）'
    );
  }

  const { uid, key } = data.result || {};
  if (!uid || !key) die(`响应缺少 uid/key：${JSON.stringify(data).slice(0, 300)}`);

  saveKeyLocally(uid, key);
  say(`  ✅ Key 已创建：uid=${uid}`);
  say('  ⚠️ API Token 只在此刻返回一次，已存到本机（见下），请勿提交进仓库。');
  return { uid, apiToken: key };
}

/** 把 Key 落盘到 ~/.lokfeel-turn-keys/（600 权限，不在仓库内）。 */
function saveKeyLocally(uid, apiToken) {
  const dir = path.join(os.homedir(), '.lokfeel-turn-keys');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${uid}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ uid, apiToken, createdAt: new Date().toISOString(), site: SITE_ID }, null, 2),
    { mode: 0o600 }
  );
  say(`  📁 已保存：${file}（权限 600）`);
}

/** 用 Key 真实签发一次凭据。 */
async function issueCredentials(uid, apiToken) {
  head('用该 Key 签发一次凭据（验证 Key 真的能用）');
  const url = `${CF_TURN_CREDS_BASE}/${encodeURIComponent(uid)}/credentials/generate`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL_SECONDS }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) die(`签发失败 HTTP ${r.status}：${JSON.stringify(data).slice(0, 300)}`);

  const inner = data?.iceServers;
  const urls = Array.isArray(inner?.urls) ? inner.urls : typeof inner?.urls === 'string' ? [inner.urls] : [];
  if (!urls.length || !inner?.username || !inner?.credential) {
    die(`签发响应形状不符：${JSON.stringify(data).slice(0, 300)}`);
  }

  say(`  ✅ 签发成功，ttl=${TTL_SECONDS}s`);
  for (const u of urls) say(`     · ${u}`);
  return { urls, username: inner.username, credential: inner.credential };
}

// ─────────────────────────────────────────────────────────────────────
// 真实浏览器预检（复用现有脚本，避免"两处各写一套判据"）
// ─────────────────────────────────────────────────────────────────────

function preflight(creds) {
  head('真实 Chrome 预检（必须收集到 relay 候选才允许写入生产）');
  if (SKIP_PREFLIGHT) {
    say('  ⚠️ --skip-preflight：已跳过。**存在把可用状态换成不可用状态的风险**。');
    return true;
  }

  const script = path.resolve(import.meta.dirname, 'qa/verify-turn-candidate.mjs');
  if (!fs.existsSync(script)) die(`找不到预检脚本：${script}`);

  const r = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    env: {
      ...process.env,
      TURN_URLS: creds.urls.join(','),
      TURN_USERNAME: creds.username,
      TURN_CREDENTIAL: creds.credential,
      // 凭据尚未写入生产，bundle 检查在此阶段无意义（且会误报"未生效"）
      QA_SKIP_BUNDLE: '1',
    },
  });

  if (r.status !== 0) {
    die(
      '预检未通过 → **已中止，未写入任何生产配置**。\n' +
        '  先按输出定位（最常见：中继端口被企业防火墙拦、或网络不支持 UDP）。'
    );
  }
  say('  ✅ 预检通过（该凭据确实能拿到 relay）。');
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────

if (ROLLBACK) {
  await rollback();
  process.exit(0);
}

say('Cloudflare Realtime TURN 一键开通');
say(`  模式        : ${DRY_RUN ? '干跑（不写生产）' : '正式'}`);
say(`  Netlify site: ${SITE_ID} (${SLUG})`);
say(`  凭据 TTL    : ${TTL_SECONDS}s`);

// 已有 Key 可复用（无需 CF API 权限）
let bundle;
if (REUSE_KEY) {
  const [uid, token] = REUSE_KEY.split(':');
  if (!uid || !token) die('--reuse-key 格式应为 <uid>:<api_token>');
  head('复用已有 Key');
  say(`  uid=${uid}（跳过创建，也无需要求 CF_API_TOKEN）`);
  bundle = { uid, apiToken: token };
} else {
  bundle = await createTurnKey();
}

const creds = await issueCredentials(bundle.uid, bundle.apiToken);
preflight(creds);

if (DRY_RUN) {
  head('干跑结束');
  say('  ✅ CF 凭据权限、Key 可用性、relay 可达性 —— 三项均验证通过。');
  say('  ⛔ 未写入任何生产配置（--dry-run）。');
  say(`\n  正式开通：CF_ACCOUNT_ID=… CF_API_TOKEN=… NETLIFY_TOKEN=… node scripts/setup-cloudflare-turn.mjs --reuse-key ${bundle.uid}:<token>`);
  process.exit(0);
}

// ── 写生产 ──
head('写入 Netlify 生产环境变量');
if (!NETLIFY_TOKEN) die('需要 NETLIFY_TOKEN 才能写入生产配置。');
await writeNetlifyEnvs(bundle.uid, bundle.apiToken);

head('回读核对（写入 201 ≠ 写成功）');
const left = await readNetlifyTurnEnvs();
const gotId = left.find((e) => e.key === ENV_TOKEN_ID);
const gotToken = left.find((e) => e.key === ENV_API_TOKEN);
say(`  ${ENV_TOKEN_ID} = ${gotId ? gotId.values[0].value : '(缺失)'}${gotId && gotId.values[0].value === bundle.uid ? '  ✓ 一致' : '  ✗ 不一致'}`);
say(`  ${ENV_API_TOKEN} = len=${gotToken ? (gotToken.values[0].value || '').length : 0}${gotToken && gotToken.values[0].value === bundle.apiToken ? '  ✓ 与签发值一致' : '  ✗ 不一致'}`);

if (!gotId || !gotToken || gotId.values[0].value !== bundle.uid || gotToken.values[0].value !== bundle.apiToken) {
  die('回读不一致 → 请人工核对 Netlify 面板。');
}

head('完成');
say('  ✅ 已写入。**还需一步才能生效**：触发一次 redeploy（env 变更不会自动重部署）。');
say('     推送任一提交，或用 Netlify 面板 Clear cache and deploy site。');
say('');
say('  生效后复验（真实 Chrome，需登录态下的 QA 账号与会话）：');
say('     QA_CONV=<conversationId> QA_EXPECT_ICE_SOURCE=cloudflare-realtime npm run verify:turn:prod');
say('');
say('  回滚：node scripts/setup-cloudflare-turn.mjs --rollback');
