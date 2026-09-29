#!/usr/bin/env node
// 1.3 自动化：给 Firebase Web API key 加 HTTP referrer + Google API 限制
// 只读服务账号 → OAuth → API Keys API → PATCH restrictions → LRO 轮询 → 冒烟验证
// 设计约束：幂等（已达标则跳过）；只改 restrictions，绝不创建/删除 key
import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';

const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || '';
let PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || '';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const APP_ORIGIN = 'https://app.lokfeel.com';

if (!CLIENT_EMAIL || !PRIVATE_KEY || !PROJECT_ID) {
  console.error('缺少 FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / FIREBASE_PROJECT_ID');
  process.exit(2);
}
PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');

const gcurl = (url, method = 'GET', body = null, auth = null, ct = null) => {
  const args = ['curl', '-sS', '--max-time', '60', '-X', method];
  if (auth) args.push('-H', `Authorization: Bearer ${auth}`);
  if (ct) args.push('-H', `Content-Type: ${ct}`);
  if (body) args.push('--data-binary', '@-');
  args.push(url);
  try {
    return execFileSync('curl', args, { input: body || undefined, maxBuffer: 20 * 1024 * 1024 }).toString();
  } catch (e) {
    return `__ERR__${e.status} ${String(e.stderr || e.message).slice(0, 300)}`;
  }
};

// ── 0) 从公开配置端点取当前 key（自更新，避免硬编码）──────────────────
const cfgRaw = execFileSync('curl', ['-sS', '--max-time', '30', `${APP_ORIGIN}/api/config/firebase`], { maxBuffer: 1024 * 1024 }).toString();
let apiKey = '';
try { apiKey = JSON.parse(cfgRaw).config?.apiKey || ''; } catch {}
if (!apiKey.startsWith('AIza')) { console.error(`无法从 ${APP_ORIGIN}/api/config/firebase 取到 apiKey`); process.exit(2); }
console.log('目标 key   :', apiKey.slice(0, 12) + '…(len ' + apiKey.length + ')');
console.log('项目       :', PROJECT_ID);

// ── 1) 服务账号 JWT → OAuth token ────────────────────────────────────
const now = Math.floor(Date.now() / 1000);
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64u({ alg: 'RS256', typ: 'JWT' });
const payload = b64u({ iss: CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 });
const signer = createSign('RSA-SHA256');
signer.update(head + '.' + payload);
const sig = signer.sign(PRIVATE_KEY).toString('base64url');
const tokResp = gcurl('https://oauth2.googleapis.com/token', 'POST', JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + payload + '.' + sig }), null, 'application/json');
let tok; try { tok = JSON.parse(tokResp); } catch { console.error('token 响应异常:', tokResp.slice(0, 200)); process.exit(2); }
if (!tok.access_token) { console.error('OAuth 失败:', JSON.stringify(tok).slice(0, 300)); process.exit(2); }
console.log('OAuth      : OK（firebase-adminsdk 服务账号，cloud-platform scope）');
const AUTH = tok.access_token;

// ── 2) 列 keys，按 keyString 精确匹配目标 ────────────────────────────
const keysRaw = gcurl(`https://apikeys.googleapis.com/v2/projects/${PROJECT_ID}/locations/global/keys`, 'GET', null, AUTH);
let keys; try { keys = JSON.parse(keysRaw); } catch { console.error('keys 响应异常:', keysRaw.slice(0, 200)); process.exit(2); }
if (!keys.keys?.length) { console.error('项目内无 API key 或无权限:', JSON.stringify(keys).slice(0, 300)); process.exit(2); }
const target = keys.keys.find((k) => k.keyString === apiKey);
if (!target) { console.error('未找到与线上配置匹配的 key（可能 key 已轮换但站点配置未更新）'); process.exit(2); }
console.log('匹配 key   :', target.name, '| displayName:', target.displayName || '(none)');

// ── 3) 计算目标限制，幂等检查 ────────────────────────────────────────
const ALLOWED_REFERRERS = [
  'https://app.lokfeel.com/*',
  'https://lokfeel.netlify.app/*',
  'https://*.lokfeel.netlify.app/*',
  'http://localhost:3000/*',
  'http://127.0.0.1:3000/*',
];
const API_TARGETS = [
  { service: 'identitytoolkit.googleapis.com' },
  { service: 'securetoken.googleapis.com' },
  { service: 'firebaseinstallations.googleapis.com' },
];
const cur = target.restrictions || {};
const curRefs = (cur.browserKeyRestrictions?.allowedReferrers) || [];
const curTargets = (cur.apiTargets || []).map((t) => t.service).sort().join(',');
const wantTargets = API_TARGETS.map((t) => t.service).sort().join(',');
const refsOk = JSON.stringify([...curRefs].sort()) === JSON.stringify([...ALLOWED_REFERRERS].sort());
const targetsOk = curTargets === wantTargets;
if (refsOk && targetsOk && cur.browserKeyRestrictions) {
  console.log('✅ 限制已就绪（幂等跳过）：referrers 与 apiTargets 均匹配');
  process.exit(0);
}
console.log('当前限制   :', JSON.stringify(cur).slice(0, 300) || '(无)');

// ── 4) PATCH 限制 ────────────────────────────────────────────────────
const patchBody = JSON.stringify({
  restrictions: {
    browserKeyRestrictions: { allowedReferrers: ALLOWED_REFERRERS },
    apiTargets: API_TARGETS,
  },
});
const patchUrl = `https://apikeys.googleapis.com/v2/${target.name}?updateMask=restrictions`;
const patchResp = gcurl(patchUrl, 'PATCH', patchBody, AUTH, 'application/json');
let op; try { op = JSON.parse(patchResp); } catch { console.error('PATCH 响应异常:', patchResp.slice(0, 300)); process.exit(2); }
if (!op.name) { console.error('PATCH 失败:', JSON.stringify(op).slice(0, 400)); process.exit(2); }
console.log('PATCH 已受理，LRO:', op.name);

// ── 5) 轮询 LRO 至完成 ───────────────────────────────────────────────
let done = false, final = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const r = gcurl(`https://apikeys.googleapis.com/v2/${op.name}`, 'GET', null, AUTH);
  try { final = JSON.parse(r); } catch { continue; }
  if (final.done) { done = true; break; }
  process.stdout.write('.');
}
console.log('');
if (!done) { console.error('LRO 超时未完成'); process.exit(2); }
if (final.error) { console.error('LRO 失败:', JSON.stringify(final.error).slice(0, 400)); process.exit(2); }
console.log('LRO 完成 ✅');

// ── 6) 冒烟验证：Auth API 对允许 referrer 放行、对陌生 referrer 拒绝 ──
const smoke = async (referer) => {
  const args = ['curl', '-sS', '--max-time', '30', '-o', '/dev/null', '-w', '%{http_code}'];
  if (referer) args.push('-H', `Referer: ${referer}`);
  args.push(`https://identitytoolkit.googleapis.com/v1/projects?key=${apiKey}`);
  return execFileSync('curl', args, { maxBuffer: 1024 * 1024 }).toString();
};
const okApp = await smoke(APP_ORIGIN + '/');
const okNone = await smoke(null);
const badRef = await smoke('https://evil.example.com/');
console.log(`冒烟（Referer=${APP_ORIGIN}/）: HTTP ${okApp}  ${okApp === '200' ? '✅ 放行' : '❌ 异常'}`);
console.log(`冒烟（无 Referer）           : HTTP ${okNone}  ${okNone === '200' ? '✅' : '❌ 异常'}`);
console.log(`冒烟（Referer=evil.example） : HTTP ${badRef}  ${badRef === '403' ? '✅ 已拒绝' : '❌ 未拒绝'}`);
const allGood = okApp === '200' && badRef === '403';
console.log(allGood ? '\n🎉 1.3 完成：referrer + API 双限制生效，线上 Auth 冒烟通过' : '\n⚠️ 限制已应用但冒烟有异常，需人工核对');
process.exit(allGood ? 0 : 1);
