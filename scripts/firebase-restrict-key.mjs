#!/usr/bin/env node
// 1.3 自动化：给 Firebase Web API key 加 HTTP referrer + Google API 限制
// 只读服务账号 → OAuth → API Keys API → PATCH restrictions → LRO 轮询 → 冒烟验证
// 设计约束：幂等（已达标则跳过）；只改 restrictions，绝不创建/删除 key
//
// 退出码：0 = 完成 或 前置未满足（等 Owner 启用 API Keys API，见 ⏳ 提示）
//         1 = 限制已应用但冒烟异常   2 = 真实错误
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
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

const summary = (md) => {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); } catch {}
};

// 通用请求：args 里**不要再放 'curl'**（那会被 curl 当成一个 URL，
// 造成 -w 输出被拼接成 "000200"、退出码/输出双份，冒烟判定必然错）
const gcurl = (url, method = 'GET', body = null, auth = null, ct = null) => {
  const args = ['-sS', '--max-time', '60', '-X', method];
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

// Google 对"服务未启用"的两种返回形态：
//  ① 标准文案 "…has not been used in project … before or it is disabled…/overview…"
//  ② 简写形如 Permission 'apikeys.keys.list' denied on resource 'projects/N/locations/global'
//     —— 不带 disable 字样，但 details 里带 google.rpc.PreconditionFailure（实测为本项目形态）。
// ②必须靠 PreconditionFailure 认出来，否则会被误判成"真实错误"而中断自动重试。
const DISABLED_SIGNATURE = /has not been used in project|is disabled|SERVICE_DISABLED|apikeys\.googleapis\.com\/overview|google\.rpc\.PreconditionFailure/i;
const looksDisabled = (raw) => /apikeys\.keys\./i.test(raw) && DISABLED_SIGNATURE.test(raw);

// 自诊断：向 Service Usage API 询问 apikeys 服务的真实状态（ENABLED / DISABLED）。
// 目的：把"是没启用 API"还是"启用了但服务账号缺 IAM 角色"这两种长得几乎一样的
// 403（都可能是 Permission 'apikeys.keys.list' denied）区分开，避免用户点错地方。
const diagnose = () => {
  const url = `https://serviceusage.googleapis.com/v1/projects/${PROJECT_ID}/services/apikeys.googleapis.com`;
  const r = gcurl(url, 'GET', null, AUTH);
  const m = r.match(/"state"\s*:\s*"([A-Z_]+)"/);
  if (m) {
    console.log('诊断       : apikeys.googleapis.com 服务状态 =', m[1]);
    return `serviceState=${m[1]}`;
  }
  console.log('诊断       : 服务状态查询未获得结论 →', r.replace(/\s+/g, ' ').slice(0, 200));
  return `serviceState=UNKNOWN（查询响应：${r.replace(/\s+/g, ' ').slice(0, 200)}）`;
};

// 前置未满足（API Keys API 未启用）：不报错，留待定时任务自动重试
const pending = (detail) => {
  const url = `https://console.developers.google.com/apis/api/apikeys.googleapis.com/overview?project=${PROJECT_ID}`;
  const diag = diagnose();
  const why = diag === 'serviceState=ENABLED'
    ? '（服务已启用 → 阻塞在服务账号 IAM 权限）'
    : diag === 'serviceState=DISABLED'
      ? '（apikeys 服务未启用）'
      : '（服务状态未知，可能是权限不足）';
  console.log('\n⏳ 1.3 前置未满足：无法通过 API 读写 API key 限制' + why);
  console.log('   需项目 Owner 在控制台操作（任选其一，推荐 ②）：');
  console.log('   ① 启用 API Keys API：' + url);
  console.log('   ② 直接在控制台改 key 限制（不需要启用任何 API，最稳）：');
  console.log('      https://console.cloud.google.com/apis/credentials?project=' + PROJECT_ID);
  console.log('      → 点该 Web key（AIzaSyBq2gPa…）→ Edit → Application restrictions 选 "Websites"');
  console.log('        添加：https://app.lokfeel.com/* 、https://lokfeel.netlify.app/* 、http://localhost:3000/*');
  console.log('      → API restrictions 选 "Restrict key" → 勾 identitytoolkit / securetoken / firebaseinstallations → Save');
  console.log('   两种做法本工作流都会自动验证：已达标则打印「✅ 限制已就绪」，未达标则每日重试。');
  if (detail) console.log('   原始响应:', String(detail).replace(/\s+/g, ' ').slice(0, 1200));
  summary([
    '## ⏳ 1.3 待前置：API Keys API 未启用（或服务账号缺 IAM 角色）',
    '',
    `**自诊断**：\`${diag}\``,
    '',
    '需 Owner 在控制台操作，任选其一：',
    '',
    '**① 启用 API Keys API**（之后本脚本可全自动完成）',
    `\n${url}\n`,
    '**② 不启用 API，直接在控制台改 key 限制**（最稳，不依赖任何 API 权限）',
    `\nhttps://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}\n`,
    '- Application restrictions → Websites：`https://app.lokfeel.com/*`、`https://lokfeel.netlify.app/*`、`http://localhost:3000/*`',
    '- API restrictions → Restrict key：`identitytoolkit`、`securetoken`、`firebaseinstallations`',
    '',
    '两种做法之后，本工作流每日自动运行都会做一次幂等校验：已达标打印「✅ 限制已就绪」，未达标继续等待。',
    '',
    '<details><summary>原始响应</summary>',
    '',
    '```',
    String(detail || '').replace(/\s+/g, ' ').slice(0, 1200),
    '```',
    '</details>',
  ].join('\n'));
  process.exit(0);
};

// ── 0) 从公开配置端点取当前 key（自更新，避免硬编码）──────────────────
let cfgRaw = '';
try {
  cfgRaw = execFileSync('curl', ['-sS', '--max-time', '30', `${APP_ORIGIN}/api/config/firebase`], { maxBuffer: 1024 * 1024 }).toString();
} catch (e) {
  console.error('取线上配置失败:', String(e.stderr || e.message).slice(0, 200));
  process.exit(2);
}
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

// ── 2) 尽力启用 API Keys API ─────────────────────────────────────────
// 服务账号没有 serviceusage.services.enable 权限，这一步**拿不到授权是常态**
// （Google 权限设计：启用 API 属 Owner 动作）。因此此处任何失败都只记录、不致命，
// 由下一步"列 keys"的真实结果来判断 API 到底有没有启用。
const svcUrl = `https://serviceusage.googleapis.com/v1/projects/${PROJECT_ID}/services/apikeys.googleapis.com:enable`;
const en = gcurl(svcUrl, 'POST', '{}', AUTH, 'application/json');
try {
  const ej = JSON.parse(en);
  if (ej.error) {
    console.log('提示       : 服务账号无权启用 API（预期内，不影响已启用的服务）');
  } else if (ej.name) {
    for (let i = 0; i < 30; i++) {
      const r = gcurl(`https://serviceusage.googleapis.com/v1/${ej.name}`, 'GET', null, AUTH);
      try { if (JSON.parse(r).done) break; } catch {}
      await new Promise((res) => setTimeout(res, 3000));
    }
    console.log('API Keys API: 本次已启用');
    await new Promise((res) => setTimeout(res, 5000)); // 传播缓冲
  } else {
    console.log('API Keys API: 已处于启用状态');
  }
} catch { console.log('提示       : 启用响应异常（忽略）:', en.slice(0, 160)); }

// ── 3) 列 keys，按 keyString 精确匹配目标 ────────────────────────────
const keysUrl = `https://apikeys.googleapis.com/v2/projects/${PROJECT_ID}/locations/global/keys`;
const keysRaw = gcurl(keysUrl, 'GET', null, AUTH);
let keys;
try { keys = JSON.parse(keysRaw); } catch {
  if (looksDisabled(keysRaw)) pending(keysRaw);
  console.error('keys 响应异常:', keysRaw.slice(0, 400));
  process.exit(2);
}
if (keys.error) {
  const msg = JSON.stringify(keys.error);
  if (looksDisabled(msg)) pending(msg);
  console.error('列取 key 失败:', msg.slice(0, 400));
  process.exit(2);
}
if (!keys.keys?.length) { console.error('项目内无 API key 或无权限:', JSON.stringify(keys).slice(0, 300)); process.exit(2); }
const target = keys.keys.find((k) => k.keyString === apiKey);
if (!target) { console.error('未找到与线上配置匹配的 key（可能 key 已轮换但站点配置未更新）'); process.exit(2); }
console.log('匹配 key   :', target.name, '| displayName:', target.displayName || '(none)');

// ── 4) 计算目标限制，幂等检查 ────────────────────────────────────────
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
const alreadyDone = refsOk && targetsOk && !!cur.browserKeyRestrictions;
if (alreadyDone) {
  console.log('✅ 限制已就绪（幂等跳过）：referrers 与 apiTargets 均匹配');
} else {
  console.log('当前限制   :', JSON.stringify(cur).slice(0, 300) || '(无)');
}

// ── 5) PATCH 限制 ────────────────────────────────────────────────────
if (!alreadyDone) {
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

  // ── 6) 轮询 LRO 至完成 ─────────────────────────────────────────────
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
  await new Promise((r) => setTimeout(r, 5000)); // 限制传播缓冲
}

// ── 7) 冒烟验证：按错误正文判定，而不是只比 HTTP 码 ──────────────────
// 关键：identitytoolkit 对无鉴权请求本来可能返回 403 PERMISSION_DENIED，
// 单看状态码无法区分"被 referrer 拦"与"缺身份"。判据取响应正文里的
// referer-blocked 语义（API_KEY_HTTP_REFERRER_BLOCKED / requests-from-referer…）。
const httpProbe = (referer) => {
  const args = ['-sS', '--max-time', '30', '-w', '\n__CODE__%{http_code}'];
  if (referer) args.push('-H', `Referer: ${referer}`);
  args.push(`https://identitytoolkit.googleapis.com/v1/projects?key=${apiKey}`);
  let out = '';
  try {
    out = execFileSync('curl', args, { maxBuffer: 1024 * 1024 }).toString();
  } catch (e) {
    out = String(e.stdout || '') + '\n__CODE__000';
  }
  const m = out.match(/__CODE__(\d{3})\s*$/);
  return { code: m ? m[1] : '000', body: out.replace(/\n?__CODE__\d{3}\s*$/, '') };
};
const isBlocked = (r) => /API_KEY_HTTP_REFERRER_BLOCKED|requests-from-referer|referer[^"]*blocked/i.test(r.body);

const app = httpProbe(APP_ORIGIN + '/');
const none = httpProbe(null);
const evil = httpProbe('https://evil.example.com/');
const appOk = !isBlocked(app);
const evilOk = isBlocked(evil);
console.log(`冒烟（Referer=${APP_ORIGIN}/）: HTTP ${app.code}  ${appOk ? '✅ 未被 referrer 拦' : '❌ 被拦'}`);
console.log(`冒烟（无 Referer）           : HTTP ${none.code}  ${isBlocked(none) ? '（被拦：属正常收紧）' : '（放行）'}`);
console.log(`冒烟（Referer=evil.example） : HTTP ${evil.code}  ${evilOk ? '✅ 已拒绝' : '❌ 未拒绝'}`);
if (!appOk || !evilOk) {
  console.log('   样本正文:', `app=${app.body.replace(/\s+/g, ' ').slice(0, 160)} | evil=${evil.body.replace(/\s+/g, ' ').slice(0, 160)}`);
}
const allGood = appOk && evilOk;
console.log(allGood ? '\n🎉 1.3 完成：referrer + API 双限制生效，线上 Auth 冒烟通过' : '\n⚠️ 限制已应用但冒烟有异常，需人工核对');
summary(allGood
  ? `## 🎉 1.3 完成\n\nFirebase Web key 已加 HTTP referrer + Google API 双限制。\n\n| 探针 | HTTP | 结论 |\n|---|---|---|\n| ${APP_ORIGIN}/ | ${app.code} | ${appOk ? '放行' : '被拦'} |\n| 无 Referer | ${none.code} | ${isBlocked(none) ? '被拦' : '放行'} |\n| evil.example.com | ${evil.code} | ${evilOk ? '已拒绝' : '未拒绝'} |\n`
  : `## ⚠️ 1.3 限制已应用，但冒烟异常，需人工核对\n\napp=${app.code}、none=${none.code}、evil=${evil.code}\n`);
process.exit(allGood ? 0 : 1);
