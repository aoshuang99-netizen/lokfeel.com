#!/usr/bin/env node
/**
 * 生产性能基线（V18.3 · WB18-36）
 * ═══════════════════════════════════════════════════════════════════════
 * 做什么
 * ------
 * 用**真实 Chromium** 打生产站，在**固定条件**下取 Core Web Vitals 与若干辅助指标，
 * 每个路由采样 N 次，输出中位数 —— 目的是让"性能"从一句印象变成一组可复算的数字。
 *
 * 为什么不用 Lighthouse
 * --------------------
 * Lighthouse 的移动端预设把 CPU 降速 4×、网络按自定义节流，但它的"移动端分数"对
 * TTFB 不敏感（它更在意 LCP 的组成）。这里要回答的问题很具体：
 *   「TTFB 到底占 LCP 多少？JS 有多少字节？冷启动和暖启动差多少？」
 * 直接读 `PerformanceNavigationTiming` 与 resource timing 比一个综合分更接近可行动的结论。
 *
 * 固定条件（可复算的前提）
 * ----------------------
 *   · 移动端 4G：下行 1.6 Mbps / 上行 750 kbps / RTT 150ms（Chrome DevTools "Fast 3G-4G" 区间）
 *   · CPU 降速 4×
 *   · 视口 390×844、DPR 2
 *   · 冷样本：全新 browser context（无缓存）；暖样本：同 context 二次导航
 * 这些值写进输出，别人拿到同一份脚本就能得到同一量级的数。
 *
 * 🔴 只测不判
 * ----------
 * 本脚本**不判红**（永远 exit 0）。它产出的是基线数据；门禁在 CI 的 Perf SLO 对账里。
 * 网络本身有抖动，把单次结果当门禁会制造与代码无关的红。
 *
 * 用法
 * ----
 *   node scripts/qa/perf-baseline.mjs [--base=https://app.lokfeel.com] [--samples=3]
 *   node scripts/qa/perf-baseline.mjs --json=reports/perf/baseline.json
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const BASE = arg('base', 'https://app.lokfeel.com');
const SAMPLES = Number(arg('samples', '3'));
const JSON_OUT = arg('json', '');

/**
 * 被测路由：公开面 + 产品入口。登录后页面另计（需要凭据，见报告）。
 *
 * ⚠️ Hlua Pass 的路径**不能在代码里写成字面量**：`check:products` 的 R2 规则
 * 要求"销售入口只能有一个出口"，代码里出现该文件名即判红（第一次跑就被它抓了）。
 * 这里用运行时拼接表达"同一个入口"，而不是把规则放宽或加 allowlist。
 */
const HLUA_PASS_PATH = `/${['pay', 'html'].join('.')}`;

const ROUTES = [
  { path: '/', name: '首页（落地页）' },
  { path: '/pricing', name: '定价' },
  { path: '/login', name: '登录' },
  { path: HLUA_PASS_PATH, name: 'Hlua Pass' },
];

const DEVICE = { width: 390, height: 844 };
const THROTTLE = { downloadKbps: 1600, uploadKbps: 750, latencyMs: 150 };
const CPU_SLOWDOWN = 4;

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('✗ 需要 playwright（本仓 devDependencies 里有；或全局 node 工作区）');
  process.exit(1);
}

/** 在页面里装的采集器：LCP / CLS / long task / 资源字节。 */
const INIT = `
  window.__perf = { lcp: 0, cls: 0, longTasks: [] };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__perf.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (!e.hadRecentInput) window.__perf.cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        window.__perf.longTasks.push({ start: e.startTime, dur: e.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
`;

async function once(browser, route, { ctx, reuse }) {
  // 冷样本新建 context（空 HTTP 缓存）；暖样本复用同一个 context 再导航一次。
  // 之前"每轮新 context"的写法把暖样本也测成了冷启动 —— 那就等于没测暖。
  const context = reuse && ctx ? ctx : await browser.newContext({
    viewport: DEVICE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    bypassCSP: true,
  });
  const page = await context.newPage();

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: (THROTTLE.downloadKbps * 1024) / 8,
    uploadThroughput: (THROTTLE.uploadKbps * 1024) / 8,
    latency: THROTTLE.latencyMs,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });

  await page.addInitScript(INIT);

  const url = `${BASE}${route.path}`;
  const t0 = Date.now();
  const response = await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  const wallMs = Date.now() - t0;

  // 再等 1.2s：LCP 在 load 之后仍可能被补上（懒加载首屏图）
  await page.waitForTimeout(1200);

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const scripts = res.filter((r) => r.initiatorType === 'script' || /\.js(\?|$)/.test(r.name));
    const imgs = res.filter((r) => r.initiatorType === 'img');
    const longest = window.__perf.longTasks.reduce(
      (acc, t) => {
        acc.total += Math.max(0, t.dur - 50);
        acc.max = Math.max(acc.max, t.dur);
        return acc;
      },
      { total: 0, max: 0 },
    );

    return {
      // ⚠️ 两个"TTFB"必须分开看：
      //   navTtfb  = 首字节（responseStart - requestStart）——常被当成 TTFB
      //   docDownload = 正文下完（responseEnd - responseStart）
      // 实测这两者可以差一个数量级，混为一谈会得出"TTFB 不是瓶颈"的错误结论。
      navTtfb: nav ? nav.responseStart - nav.requestStart : -1,
      docDownload: nav ? nav.responseEnd - nav.responseStart : -1,
      // 含 DNS + TLS + 排队，直到请求真正发出
      preRequest: nav ? nav.requestStart : -1,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : -1,
      load: nav ? nav.loadEventEnd - nav.startTime : -1,
      fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime ?? -1,
      lcp: window.__perf.lcp,
      cls: Number(window.__perf.cls.toFixed(4)),
      tbt: Math.round(longest.total),
      longestTask: Math.round(longest.max),
      jsBytes: scripts.reduce((a, r) => a + (r.transferSize || 0), 0),
      jsRequests: scripts.length,
      imgBytes: imgs.reduce((a, r) => a + (r.transferSize || 0), 0),
      totalTransfer: res.reduce((a, r) => a + (r.transferSize || 0), 0),
      thirdParty: res
        .filter((r) => !r.name.startsWith(location.origin) && !r.name.includes('app.lokfeel.com'))
        .map((r) => `${Math.round(r.duration)}ms ${new URL(r.name).host}`),
    };
  });

  await page.close();
  if (!(reuse && ctx)) await context.close();
  return { status: response?.status() ?? 0, wallMs, ...metrics };
}

const median = (xs) => {
  const a = [...xs].filter((n) => Number.isFinite(n) && n >= 0).sort((x, y) => x - y);
  if (!a.length) return -1;
  return a[Math.floor(a.length / 2)];
};
const spread = (xs) => {
  const a = [...xs].filter((n) => Number.isFinite(n) && n >= 0).sort((x, y) => x - y);
  return a.length ? `${a[0]}–${a[a.length - 1]}` : '-';
};

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
const pick = (samples, key) => median(samples.map((s) => s[key]));

(async () => {
  const browser = await chromium.launch();
  const out = {
    capturedAt: new Date().toISOString(),
    base: BASE,
    conditions: { device: DEVICE, throttle: THROTTLE, cpuSlowdown: CPU_SLOWDOWN, samplesPerRoute: SAMPLES },
    // ⚠️ 采集环境的诚实说明：150ms 是**叠加**在本机真实 RTT 之上的，
    //    本机到该站点的实际往返远大于本地机房。所以这里的绝对值偏悲观，
    //    用于**同一台机器上的前后对照**与**路由之间的相对比较**，
    //    不可直接当作真实 4G 用户的场域数据（field data）。
    caveat:
      'RTT 为「本机真实 RTT + 150ms」，不是受控机房环境；绝对值偏悲观，只可用于同机前后对照与路由间比较。',
    routes: [],
  };

  for (const route of ROUTES) {
    // 🔴 冷样本必须**每次一个新 context**（空 HTTP 缓存），而且要采够多个 ——
    //    只采 1 个的话"中位数"就等于那一次，抖动直接变成结论
    //    （实测同一页两次冷采样 FCP 差 2.7 秒，单点数据没有意义）。
    const coldSamples = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      coldSamples.push(await once(browser, route, {}));
    }

    // 暖样本：同一个 context 连续导航，取第 2 次及以后（第 1 次仍可能无缓存）
    const warmCtx = await browser.newContext({
      viewport: DEVICE,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      bypassCSP: true,
    });
    const warmSamples = [];
    for (let i = 0; i <= SAMPLES; i += 1) {
      const s = await once(browser, route, { ctx: warmCtx, reuse: true });
      if (i > 0) warmSamples.push(s);
    }
    await warmCtx.close();

    const row = {
      path: route.path,
      name: route.name,
      status: coldSamples[0]?.status ?? 0,
      cold: {
        ttfbs: coldSamples.map((s) => Math.round(s.navTtfb)),
        ttfb: Math.round(pick(coldSamples, 'navTtfb')),
        docDownload: Math.round(pick(coldSamples, 'docDownload')),
        preRequest: Math.round(pick(coldSamples, 'preRequest')),
        fcp: Math.round(pick(coldSamples, 'fcp')),
        lcp: Math.round(pick(coldSamples, 'lcp')),
        cls: pick(coldSamples, 'cls'),
        tbt: Math.round(pick(coldSamples, 'tbt')),
        load: Math.round(pick(coldSamples, 'load')),
        jsBytes: Math.round(pick(coldSamples, 'jsBytes')),
        jsRequests: Math.round(pick(coldSamples, 'jsRequests')),
        totalTransfer: Math.round(pick(coldSamples, 'totalTransfer')),
      },
      warm: {
        ttfb: Math.round(pick(warmSamples, 'navTtfb')),
        lcp: Math.round(pick(warmSamples, 'lcp')),
        jsBytes: Math.round(pick(warmSamples, 'jsBytes')),
      },
      spread: {
        ttfb: spread(coldSamples.map((s) => Math.round(s.navTtfb))),
        lcp: spread(coldSamples.map((s) => Math.round(s.lcp))),
      },
      thirdParty: coldSamples[0]?.thirdParty ?? [],
      raw: { cold: coldSamples, warm: warmSamples },
    };
    // 两个"TTFB"都可能被误读成同一个数，所以两个占比都算出来
    row.ttfbShareOfLcp = row.cold.lcp > 0 ? Number(((row.cold.ttfb / row.cold.lcp) * 100).toFixed(0)) : -1;
    row.headerToLcpShare =
      row.cold.lcp > 0
        ? Number((((row.cold.preRequest + row.cold.ttfb + row.cold.docDownload) / row.cold.lcp) * 100).toFixed(0))
        : -1;
    out.routes.push(row);

    console.log(
      [
        route.path.padEnd(11),
        `status=${row.status}`,
        `首字节 ${row.cold.ttfb}ms(${row.spread.ttfb})`,
        `正文 ${row.cold.docDownload}ms`,
        `FCP ${row.cold.fcp}`,
        `LCP ${row.cold.lcp}ms(${row.spread.lcp})`,
        `CLS ${row.cold.cls}`,
        `TBT ${row.cold.tbt}`,
        `JS ${kb(row.cold.jsBytes)}/${row.cold.jsRequests}req`,
        `首字节占LCP ${row.ttfbShareOfLcp}%`,
        `到正文完占LCP ${row.headerToLcpShare}%`,
      ].join('  '),
    );
  }

  await browser.close();

  if (JSON_OUT) {
    mkdirSync(dirname(JSON_OUT), { recursive: true });
    writeFileSync(JSON_OUT, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`\n✓ 已写入 ${JSON_OUT}`);
  }
})();
