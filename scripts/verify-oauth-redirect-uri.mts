/**
 * OAuth redirect_uri 一致性门禁
 *
 * 用法：`npm run verify:oauth`（退出码 0 = 通过，1 = 有断言失败）
 *
 * ## 为什么需要它
 *
 * RFC 6749 §4.1.3 要求：授权请求里的 `redirect_uri` 与随后换取令牌时提交的
 * `redirect_uri` **必须逐字符一致**。不一致时 Twitter / Google 会直接拒绝换取
 * 令牌，而报错发生在**用户已经完成授权之后** —— 用户看到的是"授权成功却登录
 * 失败"，排查时极易怀疑到 scope、client_secret、网络上去。
 *
 * 本仓库历史上确实存在这处不一致：
 * `/api/auth/twitter/signin` 授权时声明 `/api/auth/oauth/twitter/callback`，
 * 而该回调换取令牌时却提交 `/api/auth/twitter/callback` —— 永远换不到令牌。
 *
 * 修法是收敛到 `lib/auth/twitter-oauth.ts#twitterCallbackUrl()` 单一来源。
 * 本脚本从三个方向防止再次分化：
 *   A. 动态：断言该函数的产物 = baseUrl + 路径，且支持 env 覆盖；
 *   B. 静态：扫描 src，禁止任何文件再用手拼模板串构造 Twitter 回调 URL；
 *   C. 静态：Twitter 路由不得再出现双实现（legacy 侧必须是转出），
 *      且**被引用的路由必须真实存在** —— 防止"以为没调用方就删掉"造成断链。
 *      该断言直接来自一次险些发生的误删：`/api/auth/twitter/signin` 被
 *      注册页 / 两个快捷弹窗 / `[...nextauth]` 转发共 5 处引用，
 *      并非"无调用方"。
 *
 * @module scripts/verify-oauth-redirect-uri
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_TWITTER_CALLBACK_PATH,
  twitterCallbackPath,
  twitterCallbackUrl,
} from '../src/lib/auth/twitter-oauth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra !== undefined ? ` → ${String(extra)}` : ''}`);
  }
}

// ─── A. 动态断言 ────────────────────────────────────────────────────

console.log('\nA. twitterCallbackUrl() 行为');

delete process.env.TWITTER_OAUTH_CALLBACK_PATH;

ok(
  '默认路径以 / 开头',
  twitterCallbackPath().startsWith('/'),
  twitterCallbackPath()
);

ok(
  `默认路径 = ${DEFAULT_TWITTER_CALLBACK_PATH}`,
  twitterCallbackPath() === DEFAULT_TWITTER_CALLBACK_PATH,
  twitterCallbackPath()
);

ok(
  '拼接结果 = baseUrl + 路径',
  twitterCallbackUrl('https://app.lokfeel.com') ===
    `https://app.lokfeel.com${twitterCallbackPath()}`
);

ok(
  'baseUrl 末尾多余斜杠不会造成双斜杠',
  twitterCallbackUrl('https://app.lokfeel.com/') ===
    `https://app.lokfeel.com${twitterCallbackPath()}`
);

process.env.TWITTER_OAUTH_CALLBACK_PATH = '/api/auth/twitter/callback';
ok(
  'env 覆盖生效（可一键对齐开发者后台登记的地址）',
  twitterCallbackPath() === '/api/auth/twitter/callback' &&
    twitterCallbackUrl('https://x.com') === 'https://x.com/api/auth/twitter/callback'
);

process.env.TWITTER_OAUTH_CALLBACK_PATH = 'https://evil.com/steal';
ok(
  '非法 env（绝对 URL）被拒绝并回落默认',
  twitterCallbackPath() === DEFAULT_TWITTER_CALLBACK_PATH
);

process.env.TWITTER_OAUTH_CALLBACK_PATH = '//evil.com/x';
ok(
  '协议相对 env（// 开头）被拒绝并回落默认',
  twitterCallbackPath() === DEFAULT_TWITTER_CALLBACK_PATH
);

delete process.env.TWITTER_OAUTH_CALLBACK_PATH;

// ─── B. 静态断言：禁止手拼 Twitter 回调 URL ─────────────────────────

console.log('\nB. 禁止在其它文件手拼 Twitter 回调 URL');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 唯一允许出现该字面量的文件（单一来源本体）。 */
const CANONICAL = path.join('src', 'lib', 'auth', 'twitter-oauth.ts');

const HAND_BUILT = /\$\{[^}]*\}\s*\/api\/auth\/(?:oauth\/)?twitter\/callback/;

const offenders: string[] = [];
for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file);
  if (rel === CANONICAL) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (HAND_BUILT.test(text)) offenders.push(rel);
}

ok(
  '没有任何文件用模板串手拼 Twitter 回调 URL',
  offenders.length === 0,
  offenders.join(', ')
);

// 反证：本脚本的检测式确实能命中「历史上的坏写法」
const historicalBad = 'const redirectUri = `${publicOrigin}/api/auth/twitter/callback`;';
ok('（自检）检测式可命中历史坏写法', HAND_BUILT.test(historicalBad));

// ─── C. Twitter 路由：禁止再出现双实现 + 断链检测 ────────────────────

console.log('\nC. Twitter OAuth 路由不得再出现双实现');

const ROUTES_DIR = path.join(SRC, 'app', 'api', 'auth');

/** 读取路由文件内容；不存在返回 null。 */
function readRoute(rel: string): string | null {
  const p = path.join(ROUTES_DIR, rel, 'route.ts');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

// 历史上 /api/auth/twitter/{signin,callback} 与 /api/auth/oauth/twitter/…
// 各有**一份独立实现**（callback 两侧逐字节相同，各 312 行）。在 OAuth 这种
// 「授权侧与换取侧必须逐字一致」的流程里，双实现 = 迟早漂移 = 授权成功却登录失败。
// 现在 legacy 侧必须是**转出**，不得再写回实现。
const LEGACY_ROUTES = ['twitter/signin', 'twitter/callback'];

for (const rel of LEGACY_ROUTES) {
  const text = readRoute(rel);
  ok(`legacy 路由存在：/api/auth/${rel}`, text !== null);
  if (text === null) continue;
  const lines = text.split('\n').length;
  ok(
    `  ${rel} 是转出而非实现`,
    !/export\s+async\s+function\s+GET/.test(text),
    '又出现了内联实现 → 会与规范实现漂移'
  );
  ok(
    `  ${rel} 转出规范实现 oauth/${rel}`,
    new RegExp(`from\\s+["'\`]@/app/api/auth/oauth/${rel}/route["'\`]`).test(text)
  );
  ok(`  ${rel} 保持精简（≤ 60 行）`, lines <= 60, `${lines} 行`);
}

for (const rel of ['oauth/twitter/signin', 'oauth/twitter/callback']) {
  const text = readRoute(rel);
  ok(
    `规范实现存在且确实含实现：/api/auth/${rel}`,
    text !== null && /export\s+async\s+function\s+GET/.test(text)
  );
}

// 最有价值的一条：**引用了不存在的路由 = 删路由时留下断链**。
// 这条守卫是机械化的：它曾差点被"这条路由无调用方"的误判绕过 ——
// /api/auth/twitter/signin 实际被注册页、两个快捷弹窗、[...nextauth] 转发引用着。
const ROUTE_LITERAL = /\/api\/auth\/(?:oauth\/)?twitter\/(?:signin|callback)/g;
const brokenRefs: string[] = [];
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(ROUTE_LITERAL)) {
    const rel = m[0].replace('/api/auth/', '');
    if (!fs.existsSync(path.join(ROUTES_DIR, rel, 'route.ts'))) {
      brokenRefs.push(`${path.relative(ROOT, file)} → ${m[0]}`);
    }
  }
}
ok(
  '所有被引用的 Twitter 路由都真实存在（无断链）',
  brokenRefs.length === 0,
  [...new Set(brokenRefs)].join(' | ')
);

// 反证：检测式确实能命中字面量
ok(
  '（自检）路由字面量检测式可命中',
  /\/api\/auth\/(?:oauth\/)?twitter\/(?:signin|callback)/.test(
    'window.location.href = "/api/auth/twitter/signin?callbackUrl=/dashboard"'
  )
);

// ─── 汇总 ─────────────────────────────────────────────────────────

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  process.exit(1);
}
