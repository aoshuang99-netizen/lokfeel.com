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

// ══ 冒烟矩阵：本脚本唯一**不依赖任何 Google API 权限**的判据 ══════════
// 为什么必须有它：API Keys API 不可用时（线上当前即如此，实测 apikeys.keys.list
// 报 PERMISSION_DENIED），凡是以 API 读写为前提的校验都跑不起来 —— "每日哨兵"
// 就成了摆设（实测 2026-09-30 的 cron 每次都以"前置未满足"空跑退出，什么都没验）。
// 而 Referer 拦截是**外部可观测**的：用公开的 Auth 端点带不同 Referer 打一遍，
// 就能独立验证限制是否仍然生效。因此把它做成任何分支都能调用的函数。
//
// 判据取响应正文语义而不是状态码：identitytoolkit 对无鉴权请求本就可能返回 403，
// 单看状态码分不清"被 referrer 拦"与"缺身份"。
function httpProbe(referer) {
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
}
function isBlocked(r) {
  return /API_KEY_HTTP_REFERRER_BLOCKED|requests-from-referer|referer[^"]*blocked/i.test(r.body);
}

// 逐条断言"该放行的放行、该拦的拦住"。任一条不符即整体失败 → 工作流变红。
function smokeMatrix() {
  const cases = [
    { ref: APP_ORIGIN + '/', want: 'allow', why: '生产主域' },
    { ref: 'https://lokfeel.com/', want: 'allow', why: '营销域' },
    { ref: 'https://www.lokfeel.com/', want: 'allow', why: '营销域 www' },
    { ref: 'https://lokfeel.netlify.app/', want: 'allow', why: 'Netlify 主域' },
    { ref: 'https://demo.lokfeel.netlify.app/', want: 'allow', why: 'Netlify 预览通配' },
    { ref: 'http://localhost:3000/', want: 'allow', why: '本地开发' },
    { ref: 'http://127.0.0.1:3000/', want: 'allow', why: '本地开发 127' },
    { ref: 'https://app.lofeel.com/', want: 'block', why: '第三方错拼抢注域（lofeel 缺 k）' },
    { ref: 'https://evil.example.com/', want: 'block', why: '陌生域（对照）' },
    { ref: null, want: 'block', why: '无 Referer（对照）' },
  ];
  const rows = [];
  let ok = true;
  for (const c of cases) {
    const r = httpProbe(c.ref);
    const blocked = isBlocked(r);
    const pass = c.want === 'block' ? blocked : !blocked;
    if (!pass) ok = false;
    rows.push({ ...c, code: r.code, blocked, pass, body: r.body });
  }
  return { ok, rows };
}
function reportSmoke(sm) {
  console.log('\n── 冒烟矩阵（Referer 拦截，外部可观测）──');
  for (const r of sm.rows) {
    const mark = r.pass ? '✅' : '❌';
    console.log(`  ${mark} ${String(r.ref || '（无 Referer）').padEnd(38)} HTTP ${r.code}  ${r.blocked ? '被拦' : '放行'}  [期望${r.want === 'block' ? '拦住' : '放行'}] ${r.why}`);
  }
  if (!sm.ok) {
    for (const r of sm.rows.filter((x) => !x.pass)) {
      console.log(`   样本(${r.ref || 'none'}): ${String(r.body).replace(/\s+/g, ' ').slice(0, 200)}`);
    }
  }
  console.log(sm.ok ? '  → 冒烟全部符合预期 ✅' : '  → 冒烟存在不符项 ❌（限制可能被改动或丢失）');
  return sm.ok;
}
function smokeSummaryMd(sm, title) {
  const lines = [`## ${title}`, '', '| Referer | HTTP | 实测 | 期望 | 结论 |', '|---|---|---|---|---|'];
  for (const r of sm.rows) {
    lines.push(`| \`${r.ref || '(无)'}\` | ${r.code} | ${r.blocked ? '被拦' : '放行'} | ${r.want === 'block' ? '拦住' : '放行'} | ${r.pass ? '✅' : '❌'} |`);
  }
  lines.push('', sm.ok ? '**结论：限制仍然生效。**' : '**结论：存在不符项，限制可能被改动或丢失，请立即核对。**');
  return lines.join('\n');
}

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
  console.log('        添加（共 7 条，务必与本脚本 REQUIRED_REFERRERS 一致，否则下次运行会再补）：');
  console.log('          https://app.lokfeel.com/* 、https://lokfeel.com/* 、https://www.lokfeel.com/*');
  console.log('          https://lokfeel.netlify.app/* 、https://*.lokfeel.netlify.app/*');
  console.log('          http://localhost:3000/* 、http://127.0.0.1:3000/*');
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
    '- Application restrictions → Websites（共 7 条）：`https://app.lokfeel.com/*`、`https://lokfeel.com/*`、`https://www.lokfeel.com/*`、`https://lokfeel.netlify.app/*`、`https://*.lokfeel.netlify.app/*`、`http://localhost:3000/*`、`http://127.0.0.1:3000/*`',
    '- API restrictions → Restrict key：`identitytoolkit`、`securetoken`、`firebaseinstallations`',
    '- ⚠️ 不要勾「Don\'t restrict key」以外的缩减：本脚本按"只增不减"校验，删掉必需项会被判为未达标',
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

  // 关键补强：API 走不通 ≠ 什么都没法验。
  // Referer 拦截是**外部可观测**的（见文件顶部 smokeMatrix），所以这里照跑冒烟哨兵，
  // 让每日任务真正具备"限制被改动/丢失"的发现能力 —— 原先它每天只是空跑退出。
  const sm = smokeMatrix();
  const smokeOk = reportSmoke(sm);
  if (!smokeOk) {
    console.log('   ⚠️ API 不可用期间仍检测到限制异常：请优先按上面 ② 到控制台核对。');
  }
  summary(smokeSummaryMd(sm, smokeOk
    ? '🛡️ 1.3 哨兵（API 不可用，仅冒烟）：限制仍然生效'
    : '🚨 1.3 哨兵告警：限制可能已被改动或丢失'));
  process.exit(smokeOk ? 0 : 1);
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
// ⚠️ 达标判据必须是「只增不减」，绝不能用"精确相等"。这里踩过两个真实陷阱：
//   ① API 轴：本 key 由 Firebase 自动创建，Google 已替它填了一大票服务（实测线上 25 个）。
//      若以"精确相等"判为未达标再 PATCH，就会把 25 个削成下面的 3 个 → 直接打断线上。
//   ② 引荐来源轴：线上存在我们没列出的**合法**域（营销域 lokfeel.com / www.lokfeel.com，
//      2026-09-30 实测确实在列）。精确相等会把它们一并删掉。
// 因此：达标 = 必需项全部在 + 没有禁用项；PATCH 时写「并集」，永不删除未知条目。
const REQUIRED_REFERRERS = [
  'https://app.lokfeel.com/*',
  'https://lokfeel.com/*',
  'https://www.lokfeel.com/*',
  'https://lokfeel.netlify.app/*',
  'https://*.lokfeel.netlify.app/*',
  'http://localhost:3000/*',
  'http://127.0.0.1:3000/*',
];
const REQUIRED_API_TARGETS = [
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
];
// 禁用项：1.3 要清掉的第三方错拼抢注域（lokfeel 少一个 k；实测由他人持有且网站在线）
const DENIED_REFERRER_HOSTS = ['app.lofeel.com', 'lofeel.com', 'www.lofeel.com'];

// 归一化后比较：控制台常把条目存成裸主机名，API 则给完整 URL，
// 不做归一化就会把 "app.lokfeel.com" 与 "https://app.lokfeel.com/*" 当成两条。
const normRef = (r) => String(r || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/\/\*+$/, '').replace(/\/+$/, '');

const cur = target.restrictions || {};
const curRefs = (cur.browserKeyRestrictions?.allowedReferrers) || [];
const curSvc = (cur.apiTargets || []).map((t) => t.service);
const curRefN = curRefs.map(normRef);
const reqRefN = REQUIRED_REFERRERS.map(normRef);

console.log('线上 referrers :', curRefs.length ? JSON.stringify(curRefs) : '(无)');
console.log('线上 apiTargets:', curSvc.length ? `${curSvc.length} 个 → ${curSvc.join(', ')}` : '(无)');

const missingRef = reqRefN.filter((h) => !curRefN.includes(h));
const junkRef = curRefN.filter((h) => DENIED_REFERRER_HOSTS.includes(h));
const missingSvc = REQUIRED_API_TARGETS.filter((s) => !curSvc.includes(s));
const refsOk = missingRef.length === 0 && junkRef.length === 0;
const targetsOk = missingSvc.length === 0;
const alreadyDone = refsOk && targetsOk && !!cur.browserKeyRestrictions;
if (alreadyDone) {
  console.log('✅ 限制已就绪（幂等跳过）：必需 referrers 全在、无禁用域、必需 API 全在');
} else {
  if (missingRef.length) console.log('缺 referrer   :', JSON.stringify(missingRef));
  if (junkRef.length) console.log('需清除的禁用域:', JSON.stringify(junkRef));
  if (missingSvc.length) console.log('缺 API 服务   :', JSON.stringify(missingSvc));
}

// ── 5) PATCH 限制（写并集：保留线上已有的合法条目，只补必需项、只删禁用项）──
if (!alreadyDone) {
  const reqSet = new Set(reqRefN);
  const extras = curRefs.filter((r) => {
    const n = normRef(r);
    return !DENIED_REFERRER_HOSTS.includes(n) && !reqSet.has(n);
  });
  const nextReferrers = [...extras, ...REQUIRED_REFERRERS];
  const nextServices = [...curSvc.filter((s) => !REQUIRED_API_TARGETS.includes(s)), ...REQUIRED_API_TARGETS];
  if (extras.length) console.log('保留线上额外条目:', JSON.stringify(extras), '（不删：可能是合法消费方，删掉会打断它）');
  console.log(`PATCH       : referrers ${curRefs.length} → ${nextReferrers.length} 条；apiTargets ${curSvc.length} → ${nextServices.length} 个`);
  const patchBody = JSON.stringify({
    restrictions: {
      browserKeyRestrictions: { allowedReferrers: nextReferrers },
      apiTargets: nextServices.map((service) => ({ service })),
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

// ── 7) 冒烟验证 ──────────────────────────────────────────────────────
// 实现见文件顶部（smokeMatrix / reportSmoke）：那是一段**不依赖任何 Google API
// 权限**的检测，因此本步在"API 可用"与"API 不可用"两条路径上都会执行。
const sm = smokeMatrix();
const allGood = reportSmoke(sm);
console.log(allGood ? '\n🎉 1.3 完成：referrer + API 双限制生效，线上 Auth 冒烟通过' : '\n⚠️ 限制已应用但冒烟有异常，需人工核对');
summary(smokeSummaryMd(sm, allGood ? '🎉 1.3 完成：referrer + API 双限制生效' : '⚠️ 1.3 冒烟异常，需人工核对'));
process.exit(allGood ? 0 : 1);
