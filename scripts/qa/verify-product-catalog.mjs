#!/usr/bin/env node
/**
 * 商业契约门禁：产品线不得串线（V18-02）
 * ═══════════════════════════════════════════════════════════════════════
 * 它守的那件事，用一句话说：
 *
 *   **`/pay.html` 是 Hlua 的结账页。Connection OS 的任何入口都不许指向它。**
 *
 * 此前 `/pricing` `/plans` `/subscribe` `/membership` `/pass` 全部 302 到
 * `pay.html` —— 点"定价"，买到的是 streaming 会员。这不是文案瑕疵，
 * 是用户付了钱、却没买到被介绍的那个产品。
 *
 * ── 规则（违反任一条即 exit 1）───────────────────────────────────────
 *
 *  R1. `next.config.ts` 里**不存在**任何指向 `/pay.html` 的重定向
 *      （`/pricing`、`/plans`、`/subscribe` 必须落在 Connection OS 自己的页面上）
 *  R2. 剥掉注释后，`pay.html` 在代码里**只允许出现在一处**：`src/config/products.ts`
 *      （以及明确标注为"探测目标"的脚本）。销售入口只能有一个出口。
 *  R3. `products.ts` 里 `connection-os` 必须 `PENDING_APPROVAL` + `displayPrice: null`
 *      —— 定价未获批就不许有金额。想改成 APPROVED 必须同时填 `approvalRef`。
 *  R4. 定价页**不得**引用 `src/config/plans.ts`（那是旧 B2C 的价格源；
 *      把它接进 SaaS 定价 = 用交友会员价冒充 Connection OS 的价格）
 *  R5. `/pricing` 页面必须真实存在（不是重定向到别处）
 *
 * ── 为什么 R2 要剥注释 ───────────────────────────────────────────────
 * 本仓栽过：枚举里的 `/** *\/` 块注释会被只过滤 `//` 的守卫读成一个取值，
 * 于是"注释里提到 pay.html"被判成"代码里引用了 pay.html"。
 * 断言源码前先剥注释，是这里唯一正确的顺序。
 *
 * 用法：
 *   node scripts/qa/verify-product-catalog.mjs
 *   node scripts/qa/verify-product-catalog.mjs --self-test
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const FILES = {
  products: 'src/config/products.ts',
  nextConfig: 'next.config.ts',
  pricingPage: 'src/app/(public)/pricing/page.tsx',
  hluaPage: 'src/app/(public)/hlua/page.tsx',
  legacyPlans: 'src/config/plans.ts',
};

/**
 * `pay.html` 允许出现的文件（剥注释后仍需命中）。
 * 每一条都必须写清"为什么它可以" —— 白名单不写理由就是在攒技术债。
 */
const PAY_HTML_ALLOW = [
  { file: 'src/config/products.ts', why: '唯一的产品→结账映射（href 在这里定义一次）' },
  { file: 'scripts/qa/uptime-probe.mjs', why: '存活探测的目标路径，只 GET 不导流' },
  { file: 'scripts/perf/measure-vitals.mjs', why: '首屏指标采集的目标路径，只 GET 不导流' },
  { file: 'scripts/qa/verify-pricing-consistency.mjs', why: '价格审计的输入文件，只读不导流' },
  { file: 'scripts/qa/verify-product-catalog.mjs', why: '本门禁自身（规则文本里要提它）' },
];

/** 剥掉行注释与块注释（保留字符串字面量内容——本仓没有把注释符写进字符串的用法） */
export function stripComments(src) {
  const s = String(src);
  let out = '';
  let i = 0;
  let inBlock = false;
  let inLine = false;
  let quote = null;

  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];

    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += c;
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false;
        i += 2;
        continue;
      }
      if (c === '\n') out += '\n';
      i += 1;
      continue;
    }
    if (quote) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlock = true;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function read(rel) {
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

/** 从 next.config.ts 的 redirects 数组里抽出 {source, destination} */
export function parseRedirects(src) {
  const code = stripComments(src);
  const out = [];
  const re = /\{\s*source:\s*['"]([^'"]+)['"]\s*,\s*destination:\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(re)) out.push({ source: m[1], destination: m[2] });
  return out;
}

/** 核心分析：返回问题列表 */
export function analyze(sources) {
  const problems = [];
  const { products, nextConfig, pricingPage, legacyPlans } = sources;

  if (products === null) {
    problems.push(`缺少 ${FILES.products} —— 没有产品目录就没有单一真相源`);
  }
  if (pricingPage === null) {
    problems.push(`缺少 ${FILES.pricingPage} —— /pricing 必须是真实页面（R5）`);
  }

  // R1：不许有任何指向 pay.html 的重定向
  if (nextConfig === null) {
    problems.push(`缺少 ${FILES.nextConfig}`);
  } else {
    const redirects = parseRedirects(nextConfig);
    const toPay = redirects.filter((r) => /pay\.html/.test(r.destination));
    for (const r of toPay) {
      problems.push(`R1：${r.source} → ${r.destination}（销售入口指向了 Hlua 的结账页）`);
    }
    for (const s of ['/pricing', '/plans', '/subscribe']) {
      const hit = redirects.find((r) => r.source === s);
      if (hit && hit.destination === '/pay.html') {
        problems.push(`R1：${s} 仍然跳到 pay.html`);
      }
    }
  }

  // R3：产品目录的状态约束
  if (products) {
    const code = stripComments(products);
    if (!/id:\s*'connection-os'/.test(code)) problems.push('R3：products.ts 里没有 connection-os');
    if (!/id:\s*'hlua-pass'/.test(code)) problems.push('R3：products.ts 里没有 hlua-pass');

    const block = code.slice(code.indexOf("id: 'connection-os'"), code.indexOf("id: 'legacy-membership'"));
    if (block) {
      if (!/status:\s*'PENDING_APPROVAL'/.test(block)) {
        problems.push('R3：connection-os 的 pricing.status 不是 PENDING_APPROVAL（定价未获批就该是它）');
      }
      if (!/displayPrice:\s*null/.test(block)) {
        problems.push('R3：connection-os 的 displayPrice 不是 null —— 未获批定价不许显示金额');
      }
      if (/kind:\s*'external'/.test(block)) {
        problems.push("R3：connection-os 挂了外部结账入口 —— 这正是本次要修的错配");
      }
    }

    // R4：不允许把旧 B2C 价格源接进来
    if (/from\s+['"][^'"]*config\/plans['"]/.test(code)) {
      problems.push('R4：products.ts 引用了 src/config/plans.ts（旧 B2C 价格源）');
    }
  }

  // R4：定价页不得引用旧 plans.ts
  if (pricingPage) {
    const code = stripComments(pricingPage);
    if (/from\s+['"][^'"]*config\/plans['"]/.test(code)) {
      problems.push('R4：/pricing 页面引用了 src/config/plans.ts（用 B2C 会员价冒充 SaaS 价格）');
    }
    if (/pay\.html/.test(code)) {
      problems.push('R2：/pricing 页面直接出现了 pay.html（销售入口必须经 products.ts）');
    }
  }

  if (legacyPlans === null) {
    problems.push(`缺少 ${FILES.legacyPlans}（旧会员价格源不见了？请确认是有意删除）`);
  }

  return problems;
}

/** 扫描全仓：剥注释后 pay.html 只允许出现在白名单里 */
export function scanPayHtml(sourcesByPath) {
  const problems = [];
  const allow = new Set(PAY_HTML_ALLOW.map((a) => a.file));

  for (const [file, src] of Object.entries(sourcesByPath)) {
    if (src === null) continue;
    const code = stripComments(src);
    if (!/pay\.html/.test(code)) continue;
    if (allow.has(file)) continue;
    problems.push(`R2：${file} 在代码（非注释）里引用了 pay.html —— 销售入口只能有一个出口`);
  }
  return problems;
}

/* ───────────────────────────── 主流程 ───────────────────────────── */

function collectRepoFiles() {
  const out = {};
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (/^(node_modules|\.next|\.git|\.nm-broken|test-results)$/.test(name)) continue;
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (/\.(ts|tsx|mjs|js)$/.test(name)) {
        out[path.relative(ROOT, abs)] = fs.readFileSync(abs, 'utf8');
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'scripts'));
  return out;
}

function main() {
  const sources = {
    products: read(FILES.products),
    nextConfig: read(FILES.nextConfig),
    pricingPage: read(FILES.pricingPage),
    legacyPlans: read(FILES.legacyPlans),
  };

  const problems = [...analyze(sources), ...scanPayHtml(collectRepoFiles())];

  if (problems.length) {
    console.error('✗ 商业契约不合格：');
    for (const p of problems) console.error(`   · ${p}`);
    process.exit(1);
  }

  console.log('✅ 商业契约通过：');
  console.log('   · 没有任何重定向把销售入口指向 /pay.html（R1）');
  console.log(`   · 剥注释后 pay.html 只出现在 ${PAY_HTML_ALLOW.length} 个白名单文件（R2）`);
  console.log('   · connection-os = PENDING_APPROVAL + displayPrice:null + 无外部结账（R3）');
  console.log('   · 定价页与产品目录都不引用旧 B2C 价格源 plans.ts（R4）');
  console.log('   · /pricing 是真实页面（R5）');
}

/* ───────────────────────────── 自证 ───────────────────────────── */

function selfTest() {
  const cases = [];
  const ok = (name, cond, detail = '') => {
    cases.push({ name, ok: Boolean(cond) });
    console.log(`${cond ? '✓' : '✗'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  };

  const GOOD_PRODUCTS = `
import type { X } from './x';
export const PRODUCTS = [
  { id: 'connection-os', pricing: { status: 'PENDING_APPROVAL', displayPrice: null }, checkout: { kind: 'none' } },
  { id: 'legacy-membership', pricing: { status: 'NOT_FOR_SALE', displayPrice: null }, checkout: { kind: 'none' } },
  { id: 'hlua-pass', pricing: { status: 'NOT_FOR_SALE', displayPrice: null }, checkout: { kind: 'external', href: '/pay.html' } },
];
`;
  const GOOD_NEXT = `
async redirects() {
  return [
    { source: '/plans', destination: '/pricing', permanent: false },
    { source: '/subscribe', destination: '/pricing', permanent: false },
  ];
}`;
  const GOOD_PRICING = `import { PRODUCTS } from '@/config/products';\nexport default function P(){ return null }`;

  const base = { products: GOOD_PRODUCTS, nextConfig: GOOD_NEXT, pricingPage: GOOD_PRICING, legacyPlans: 'export const PLANS=[]' };

  // ① 基准：合法的夹具必须通过（否则门禁恒红）
  ok('对照：合法夹具通过', analyze(base).length === 0, JSON.stringify(analyze(base)));

  // ② 变异：把 /pricing 改回跳 pay.html ⇒ 必须红
  {
    const bad = { ...base, nextConfig: `${GOOD_NEXT}\n    { source: '/pricing', destination: '/pay.html', permanent: false },` };
    ok('变异①：/pricing → pay.html ⇒ 红', analyze(bad).some((p) => p.includes('R1')));
  }

  // ③ 变异：给未获批产品填价格 ⇒ 必须红
  {
    const bad = {
      ...base,
      products: GOOD_PRODUCTS.replace(
        "id: 'connection-os', pricing: { status: 'PENDING_APPROVAL', displayPrice: null }",
        "id: 'connection-os', pricing: { status: 'PENDING_APPROVAL', displayPrice: '$19.99' }",
      ),
    };
    ok('变异②：未获批却填价格 ⇒ 红', analyze(bad).some((p) => p.includes('displayPrice')));
  }

  // ④ 变异：connection-os 挂外部结账 ⇒ 必须红
  {
    const bad = {
      ...base,
      products: GOOD_PRODUCTS.replace(
        "id: 'connection-os', pricing: { status: 'PENDING_APPROVAL', displayPrice: null }, checkout: { kind: 'none' }",
        "id: 'connection-os', pricing: { status: 'PENDING_APPROVAL', displayPrice: null }, checkout: { kind: 'external', href: '/pay.html' }",
      ),
    };
    ok('变异③：SaaS 挂 Hlua 结账 ⇒ 红', analyze(bad).some((p) => p.includes('外部结账')));
  }

  // ⑤ 变异：定价页引用旧 plans.ts ⇒ 必须红
  {
    const bad = { ...base, pricingPage: `import { PLANS } from '@/config/plans';\nexport default function P(){return null}` };
    ok('变异④：定价页接旧 B2C 价格 ⇒ 红', analyze(bad).some((p) => p.includes('R4')));
  }

  // ⑥ 变异：定价页直接写 pay.html ⇒ 必须红
  {
    const bad = { ...base, pricingPage: `<a href="/pay.html">buy</a>` };
    ok('变异⑤：定价页直连 pay.html ⇒ 红', analyze(bad).some((p) => p.includes('R2')));
  }

  // ⑦ 剥注释：注释里提到 pay.html 不得误报
  {
    const commented = `// 这里以前跳到 pay.html\n/* 也曾跳到 /pay.html */\nconst x = 1;`;
    const files = { 'src/some/file.ts': commented };
    ok('对照：注释里的 pay.html 不误报', scanPayHtml(files).length === 0);
  }

  // ⑧ 剥注释：真代码里出现 pay.html 必须被抓
  {
    const real = `const href = '/pay.html';`;
    ok('变异⑥：真代码里的 pay.html 必被抓', scanPayHtml({ 'src/some/file.ts': real }).length === 1);
  }

  // ⑨ 字符串里的 // 不能被当成注释（否则后面的代码会被吞掉）
  {
    const src = `const url = "https://x";\nconst y = '/pay.html';`;
    ok('对照：URL 里的 // 不误伤后续代码', stripComments(src).includes("'/pay.html'"));
  }

  const failed = cases.filter((c) => !c.ok);
  console.log(`\n${failed.length ? '✗' : '✅'} 自证 ${cases.length} 条：${cases.length - failed.length} 通过 / ${failed.length} 失败`);
  process.exit(failed.length ? 1 : 0);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
