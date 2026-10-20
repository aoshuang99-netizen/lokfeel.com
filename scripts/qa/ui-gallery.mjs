#!/usr/bin/env node
/**
 * 前端交互页面预览抓取（真实生产站，真实登录态）
 *
 * 为什么打生产而不是本地 dev：
 *  1. 本地 node_modules 是半装状态，`next dev` 起不来（见 DEPENDENCY_RISK / BACKLOG）；
 *  2. 生产才是用户实际看到的界面，截图才有「预览」价值；
 *  3. 三个角色（匿名 / 普通用户 / 管理员）在线上都有可用凭据。
 *
 * 用法：
 *   node scripts/qa/ui-gallery.mjs                 # 全量
 *   node scripts/qa/ui-gallery.mjs --only=public   # 只跑某组（public/user/admin/console）
 *   node scripts/qa/ui-gallery.mjs --base=http://localhost:3099
 *
 * 产出：
 *   reports/ui-gallery/shots/<slug>.png
 *   reports/ui-gallery/manifest.json
 *   reports/ui-gallery/index.html
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "reports/ui-gallery");
const SHOTS = path.join(OUT, "shots");

const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = argOf("base", "https://app.lokfeel.com").replace(/\/$/, "");
const ONLY = argOf("only", "").split(",").filter(Boolean);

const ACCOUNTS = {
  user: { email: "test.female@lokfeel.com", password: "Test123456!" },
  male: { email: "test.male@lokfeel.com", password: "Test123456!" },
  admin: { email: "admin@lokfeel.com", password: "LokFeel@Admin2026!" },
};

/** 每个页面：slug / 路径 / 分组 / 是否要登录 / 说明 / 是否 fullPage */
const PAGES = [
  // ── 公开层（未登录可见，SEO 与合规门面）
  { group: "public", slug: "home", path: "/", desc: "落地页：价值主张 + 视频 Hero + 注册入口" },
  { group: "public", slug: "login", path: "/login", desc: "登录：邮箱密码 / Google / Twitter" },
  { group: "public", slug: "register", path: "/register", desc: "注册：邮箱 + 密码 + 条款勾选" },
  { group: "public", slug: "about", path: "/about", desc: "关于我们（品牌叙事）" },
  { group: "public", slug: "faq", path: "/faq", desc: "常见问题" },
  { group: "public", slug: "safety-tips", path: "/safety-tips", desc: "安全指引（交友类合规必备）" },
  { group: "public", slug: "community-guidelines", path: "/community-guidelines", desc: "社区准则" },
  { group: "public", slug: "support", path: "/support", desc: "帮助与支持" },
  { group: "public", slug: "terms", path: "/terms", desc: "服务条款" },
  { group: "public", slug: "blocked", path: "/blocked", desc: "地域/风控拦截提示页" },

  // ── 登录后主链路（女性账号，资料完整）
  { group: "user", slug: "dashboard", path: "/dashboard", desc: "工作台首页：推荐 / 数据概览" },
  { group: "user", slug: "explore", path: "/dashboard/explore", desc: "探索：按条件发现匹配对象" },
  { group: "user", slug: "connections", path: "/dashboard/connections", desc: "连接：已建立的关系" },
  { group: "user", slug: "chats", path: "/dashboard/chats", desc: "消息：会话列表" },
  {
    group: "user",
    slug: "profile-self",
    path: "/dashboard/profile",
    desc: "个人资料：编辑 / 头像 / 标签",
  },
  {
    group: "user",
    slug: "profile-other",
    path: "/dashboard/profile/cmo3yq2yb0002r5k8sv2d3i0e",
    desc: "他人资料页（男性测试账号）",
  },
  { group: "user", slug: "notifications", path: "/dashboard/notifications", desc: "通知中心" },
  { group: "user", slug: "settings", path: "/dashboard/settings", desc: "账号与隐私设置" },
  { group: "user", slug: "subscription", path: "/dashboard/subscription", desc: "订阅：套餐与升级" },
  { group: "user", slug: "onboarding", path: "/dashboard/onboarding", desc: "引导流程（8 步）" },

  // ── 管理后台
  { group: "admin", slug: "admin-home", path: "/admin", desc: "后台总览：核心指标看板" },
  { group: "admin", slug: "admin-users", path: "/admin/users", desc: "用户管理：检索 / 封禁 / 角色" },
  { group: "admin", slug: "admin-matches", path: "/admin/matches", desc: "匹配管理：配对与质量" },
  { group: "admin", slug: "admin-review", path: "/admin/review", desc: "内容审核队列" },
  { group: "admin", slug: "admin-analytics", path: "/admin/analytics", desc: "数据分析总览" },
  { group: "admin", slug: "admin-funnel", path: "/admin/analytics/funnel", desc: "转化漏斗" },
  { group: "admin", slug: "admin-retention", path: "/admin/analytics/retention", desc: "留存分析" },
  { group: "admin", slug: "admin-subscriptions", path: "/admin/subscriptions", desc: "订阅与收入" },
  { group: "admin", slug: "admin-content", path: "/admin/content", desc: "内容运营位" },
  { group: "admin", slug: "admin-features", path: "/admin/features", desc: "功能开关" },
  { group: "admin", slug: "admin-alerts", path: "/admin/alerts", desc: "告警中心" },
  { group: "admin", slug: "admin-audit", path: "/admin/audit", desc: "审计日志" },
  { group: "admin", slug: "admin-rbac", path: "/admin/rbac", desc: "权限矩阵可视化" },
  { group: "admin", slug: "admin-settings", path: "/admin/settings", desc: "系统设置" },

  // ── SaaS 主产品：Living Workspace（生成式工作空间）+ Console（组织态）
  // workspace 各屏共用一个 URL，靠点击左侧 Dock 切换；Studio 屏额外触发一次真实「编译工作区」。
  { group: "saas", slug: "ws-now", path: "/workspace", desc: "Now · 今日工作台（未读/待处理/证据面板）" },
  {
    group: "saas",
    slug: "ws-studio",
    path: "/workspace",
    nav: "Studio",
    compose: "帮助我们社群在30天内促成20次高质量的渠道合作交流",
    desc: "Studio · 输入目标 →「编译工作区」（本地规则式编译生成 WorkspaceSpec 画布）",
  },
  { group: "saas", slug: "ws-field", path: "/workspace", nav: "Field", desc: "Field · 关系场图（FieldGraph 节点）" },
  { group: "saas", slug: "ws-consent", path: "/workspace", nav: "Consent", desc: "Consent · 同意与披露门禁" },
  { group: "saas", slug: "ws-outcomes", path: "/workspace", nav: "Outcomes", desc: "Outcomes · 成果观测台" },
  { group: "saas", slug: "ws-agents", path: "/workspace", nav: "Agents", desc: "Agents · Agent 看板（运行/审批状态）" },
  { group: "saas", slug: "console-home", path: "/console", desc: "Console · 运营待办（队列健康/死信/停滞）" },
  { group: "saas", slug: "console-agents", path: "/console/agents", desc: "Console · Agent 列表与运行状态" },
  { group: "saas", slug: "console-missions", path: "/console/missions", desc: "Console · 使命列表" },
  { group: "saas", slug: "console-connections", path: "/console/connections", desc: "Console · 连接管道" },
  { group: "saas", slug: "console-members", path: "/console/members", desc: "Console · 成员与角色" },
  { group: "saas", slug: "console-outcomes", path: "/console/outcomes", desc: "Console · 成果核算" },
  { group: "saas", slug: "console-settings", path: "/console/settings", desc: "Console · 组织设置" },
];

const GROUPS = {
  saas: {
    title: "SaaS 主产品 · Living Workspace + Console",
    who: "user",
    note: "test.female@lokfeel.com（ADMIN / preview 组织）",
  },
  public: { title: "公开层 · 未登录可见", who: null, note: "SEO 与合规门面，任何人可访问" },
  user: { title: "用户端 · 登录后主链路（legacy B2C）", who: "user", note: "Emma Thompson（女性 / 资料完整）" },
  admin: { title: "运营后台 · 管理员", who: "admin", note: "admin@lokfeel.com（SUPER_ADMIN）" },
};

const ts = () =>
  new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });

/** 用站点自己的登录接口建会话（与浏览器同源，避免 CSRF 拦截） */
async function login(page, account) {
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { email: account.email, password: account.password },
    headers: { Origin: BASE, Referer: `${BASE}/login` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), ok: res.ok() && body?.success === true, body };
}

async function shoot(page, item) {
  const url = BASE + item.path;
  const errors = [];
  const onErr = (e) => errors.push(String(e).slice(0, 300));
  page.on("pageerror", onErr);

  let status = 0;
  let finalUrl = url;
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    status = resp?.status() ?? 0;
    // 等 HTTP 静默（匹配引擎/图表 API 冷启动可达 1.5s+；超时则退回固定等待）
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    // 等显式 loading 文案消失（如 "Loading profiles..."），最多再 8s
    await page
      .waitForFunction(
        () => !/Loading profiles|Loading\.\.\./i.test(document.body?.innerText || ""),
        { timeout: 8000 }
      )
      .catch(() => {});
    // 骨架屏（animate-pulse）消失，最多再 6s
    await page
      .waitForFunction(
        () => document.querySelectorAll(".animate-pulse, .skeleton").length === 0,
        { timeout: 6000 }
      )
      .catch(() => {});
    await page.waitForTimeout(1200);
    finalUrl = page.url();
  } catch (e) {
    errors.push(`goto failed: ${String(e).slice(0, 200)}`);
  }

  // ── Living Workspace 的屏内导航（Dock 是组件内 state，无 URL 变化 → 点击切换）──
  if (item.nav) {
    try {
      await page.locator(`button:has-text("${item.nav}")`).first().click({ timeout: 6000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1800);
    } catch (e) {
      errors.push(`nav "${item.nav}" 点击失败: ${String(e).slice(0, 150)}`);
    }
  }
  // ── Studio：输入目标并触发真实「编译工作区」（本地规则式编译 → WorkspaceSpec 画布）──
  if (item.compose) {
    try {
      const input = page.locator("textarea").first();
      await input.fill(item.compose, { timeout: 6000 });
      await page.locator('button:has-text("编译工作区")').first().click({ timeout: 6000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(3500);
    } catch (e) {
      errors.push(`编译触发失败: ${String(e).slice(0, 150)}`);
    }
  }

  const file = path.join(SHOTS, `${item.slug}.png`);
  try {
    await page.screenshot({ path: file, fullPage: item.fullPage !== false });
  } catch (e) {
    errors.push(`screenshot failed: ${String(e).slice(0, 200)}`);
  }

  const title = await page.title().catch(() => "");
  const redirected = finalUrl.replace(BASE, "") !== item.path;
  const h1 = await page
    .locator("h1")
    .first()
    .innerText()
    .catch(() => "");

  page.off("pageerror", onErr);
  return {
    ...item,
    url,
    status,
    finalPath: finalUrl.replace(BASE, ""),
    redirected,
    title: title.trim(),
    h1: (h1 || "").trim().slice(0, 80),
    shot: `shots/${item.slug}.png`,
    errors: errors.slice(0, 4),
  };
}

async function runGroup(browser, groupKey) {
  const meta = GROUPS[groupKey];
  const items = PAGES.filter((p) => p.group === groupKey);
  if (!items.length) return [];

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    extraHTTPHeaders: { "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
  });
  const page = await ctx.newPage();

  if (meta.who) {
    const r = await login(page, ACCOUNTS[meta.who]);
    console.log(`  login(${meta.who}) → ${r.status} ${r.ok ? "OK" : "FAIL " + JSON.stringify(r.body).slice(0, 120)}`);
  }

  const out = [];
  for (const item of items) {
    process.stdout.write(`  · ${item.path} ... `);
    const rec = await shoot(page, item);
    console.log(`${rec.status}${rec.redirected ? ` → ${rec.finalPath}` : ""}`);
    out.push(rec);
  }
  await ctx.close();
  return out;
}

function renderHtml(rows) {
  const byGroup = {};
  for (const r of rows) (byGroup[r.group] ||= []).push(r);

  const okCount = rows.filter((r) => r.status >= 200 && r.status < 400).length;
  const errCount = rows.filter((r) => r.status === 0 || r.status >= 500).length;

  const section = (key) => {
    const list = byGroup[key] || [];
    if (!list.length) return "";
    const g = GROUPS[key];
    return `
  <section id="${key}">
    <div class="sec-head">
      <h2>${g.title}</h2>
      <span class="who">${g.note}</span>
    </div>
    <div class="grid">
      ${list
        .map(
          (r) => `
      <figure class="card" data-status="${r.status}">
        <a href="${r.shot}" target="_blank" class="thumb">
          <img loading="lazy" src="${r.shot}" alt="${r.desc}">
        </a>
        <figcaption>
          <div class="row1">
            <code>${r.path}</code>
            <span class="badge ${r.status >= 200 && r.status < 400 ? "ok" : "bad"}">${r.status || "ERR"}</span>
            ${r.redirected ? `<span class="badge warn">→ ${r.finalPath}</span>` : ""}
          </div>
          <p class="desc">${r.desc}</p>
          <p class="meta">${r.h1 ? `H1：${r.h1}` : r.title ? `title：${r.title}` : ""}</p>
          ${r.errors.length ? `<p class="err">${r.errors.length} 个前端异常</p>` : ""}
        </figcaption>
      </figure>`
        )
        .join("")}
    </div>
  </section>`;
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LokFeel 前端页面预览 · ${rows.length} 个页面</title>
<style>
  :root{
    --bg:#0b0a12; --panel:#141220; --line:#26233a; --txt:#e9e6f5; --dim:#9c97b5;
    --lime:#c6f24e; --violet:#8b6cf0; --red:#ff6b6b; --amber:#f0b429;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);
    font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
  header{padding:36px 40px 24px;border-bottom:1px solid var(--line);
    background:radial-gradient(1200px 400px at 10% -20%,rgba(139,108,240,.28),transparent 70%)}
  h1{margin:0 0 8px;font-size:26px;letter-spacing:-.3px}
  h1 em{font-style:normal;color:var(--lime)}
  .sub{color:var(--dim);font-size:13px}
  .stats{display:flex;gap:28px;margin-top:18px;flex-wrap:wrap}
  .stat b{display:block;font-size:22px;color:var(--lime);line-height:1.1}
  .stat span{font-size:12px;color:var(--dim)}
  nav{position:sticky;top:0;z-index:9;display:flex;gap:8px;flex-wrap:wrap;
    padding:12px 40px;background:rgba(11,10,18,.92);backdrop-filter:blur(10px);
    border-bottom:1px solid var(--line)}
  nav a{color:var(--dim);text-decoration:none;font-size:13px;padding:5px 12px;
    border:1px solid var(--line);border-radius:999px}
  nav a:hover{color:var(--txt);border-color:var(--violet)}
  section{padding:32px 40px 8px}
  .sec-head{display:flex;align-items:baseline;gap:14px;margin-bottom:18px;flex-wrap:wrap}
  .sec-head h2{margin:0;font-size:18px}
  .who{color:var(--dim);font-size:12px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:20px}
  .card{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:14px;
    overflow:hidden;transition:.18s}
  .card:hover{transform:translateY(-3px);border-color:var(--violet);
    box-shadow:0 14px 40px rgba(0,0,0,.45)}
  .thumb{display:block;height:230px;overflow:hidden;background:#000;
    border-bottom:1px solid var(--line)}
  .thumb img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
  figcaption{padding:12px 14px 14px}
  .row1{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
  .row1 code{font-size:12px;color:var(--lime);background:rgba(198,242,78,.08);
    padding:2px 7px;border-radius:5px;word-break:break-all}
  .badge{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid}
  .badge.ok{color:var(--lime);border-color:rgba(198,242,78,.4)}
  .badge.bad{color:var(--red);border-color:rgba(255,107,107,.45)}
  .badge.warn{color:var(--amber);border-color:rgba(240,180,41,.45)}
  .desc{margin:0;font-size:13px}
  .meta{margin:4px 0 0;font-size:12px;color:var(--dim)}
  .err{margin:4px 0 0;font-size:12px;color:var(--red)}
  footer{padding:28px 40px 48px;color:var(--dim);font-size:12px;border-top:1px solid var(--line);margin-top:28px}
</style>
</head>
<body>
<header>
  <h1>LokFeel 前端页面预览 <em>· ${rows.length} 个真实页面</em></h1>
  <div class="sub">抓取时间 ${ts()}　·　口径：${BASE}　·　无头浏览器 1440×900　·　三套真实登录态</div>
  <div class="stats">
    <div class="stat"><b>${rows.length}</b><span>页面总数</span></div>
    <div class="stat"><b>${okCount}</b><span>HTTP 2xx/3xx</span></div>
    <div class="stat"><b>${errCount}</b><span>抓取失败/5xx</span></div>
    <div class="stat"><b>${Object.keys(byGroup).length}</b><span>分层</span></div>
  </div>
</header>
<nav>
  ${Object.keys(byGroup)
    .map((k) => `<a href="#${k}">${GROUPS[k].title}</a>`)
    .join("")}
</nav>
${Object.keys(byGroup).map(section).join("")}
<footer>
  说明：截图取自生产站真实会话，非设计稿。307/重定向说明该页需要更高权限或前置条件；
  卡片显示的是抓取瞬间的状态，不代表功能已验收。逐页能力清单见 <code>docs/implementation/FEATURE_INVENTORY.md</code>。
</footer>
</body>
</html>`;
}

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });

  const groups = ONLY.length ? ONLY : Object.keys(GROUPS);
  console.log(`▶ 抓取 ${BASE}  分组：${groups.join(", ")}`);

  const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
  let rows = [];
  for (const g of groups) {
    console.log(`\n[${g}] ${GROUPS[g].title}`);
    rows.push(...(await runGroup(browser, g)));
  }
  await browser.close();

  // 分组增量跑时，把上次的结果并回来（同 slug 以本次为准），否则每跑一组就把别组冲掉。
  if (ONLY.length) {
    try {
      const prev = JSON.parse(await fs.readFile(path.join(OUT, "manifest.json"), "utf8"));
      const fresh = new Set(rows.map((r) => r.slug));
      rows = [...rows, ...(prev.rows || []).filter((r) => !fresh.has(r.slug))];
    } catch {
      /* 首次跑没有旧 manifest，忽略 */
    }
  }
  const order = new Map(PAGES.map((p, i) => [p.slug, i]));
  rows.sort((a, b) => (order.get(a.slug) ?? 99) - (order.get(b.slug) ?? 99));

  const manifest = { base: BASE, capturedAt: new Date().toISOString(), total: rows.length, rows };
  await fs.writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(path.join(OUT, "index.html"), renderHtml(rows), "utf8");

  console.log(`\n✅ ${rows.length} 页 → ${path.relative(ROOT, path.join(OUT, "index.html"))}`);
  const bad = rows.filter((r) => r.status === 0 || r.status >= 500);
  if (bad.length) {
    console.log(`⚠️  ${bad.length} 页抓取异常：`);
    bad.forEach((b) => console.log(`   ${b.status} ${b.path} ${b.errors[0] || ""}`));
  }
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
