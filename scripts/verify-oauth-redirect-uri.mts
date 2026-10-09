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
 * 本脚本从两个方向防止再次分化：
 *   A. 动态：断言该函数的产物 = baseUrl + 路径，且支持 env 覆盖；
 *   B. 静态：扫描 src，禁止任何文件再用手拼模板串构造 Twitter 回调 URL。
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

// ─── 汇总 ─────────────────────────────────────────────────────────

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  process.exit(1);
}
