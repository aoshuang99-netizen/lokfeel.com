#!/usr/bin/env node
/**
 * V20.4 · 生产提交漂移核查（回答一个被反复答错的问题：线上到底跑的是哪个 commit？）
 *
 * 为什么要这个脚本：
 *   本项目同时存在两套"看起来像生产"的东西：
 *     · Cloudflare Worker `lokfeel-app`（有 workers.dev 域名，但**零绑定、动态路由全 500**）
 *     · Netlify 站点 `app.lokfeel.com`（真正的承载面，`x-nf-request-id` 可证）
 *   只看 Cloudflare 的 `modified_on` 会得出"生产已更新"的错误结论。**权威来源是
 *   Netlify 的 published_deploy.commit_ref**，不是部署时间戳，也不是 CI 是否绿。
 *
 * 用法：
 *   node scripts/qa/prod-commit-drift.mjs              # 对 app.lokfeel.com
 *   node scripts/qa/prod-commit-drift.mjs --json
 *
 * 输出：生产提交 / 本地 HEAD / 落后提交数 / src 下差异文件
 * 退出码：0 = 无应用代码漂移；1 = 有 src 漂移；2 = 环境缺失或 API 失败
 *
 * 只读：只调 GET，绝不调用 restore / deploy。
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { values } = parseArgs({ options: { json: { type: "boolean", default: false } } });
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function loadToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
  for (const f of [".env.local", ".env.production", ".env"]) {
    const p = join(REPO, f);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, "utf8").match(/^NETLIFY_AUTH_TOKEN=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: "utf8" }).trim();

async function nl(token, path) {
  const res = await fetch(`https://api.netlify.com/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Netlify ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

const token = loadToken();
if (!token) {
  console.error("找不到 NETLIFY_AUTH_TOKEN（env 或 .env.local）");
  process.exit(2);
}

let sites;
try {
  sites = await nl(token, "/sites?per_page=100");
} catch (e) {
  console.error(String(e.message || e));
  process.exit(2);
}

const site = sites.find((s) => s.custom_domain === "app.lokfeel.com" || s.name === "lokfeel");
if (!site) {
  console.error("在账号下找不到 custom_domain=app.lokfeel.com 的站点");
  process.exit(2);
}

const full = await nl(token, `/sites/${site.id}`);
const pub = full.published_deploy || {};
const prodSha = pub.commit_ref || "";
const head = sh("git rev-parse HEAD");

let behind = null;
if (prodSha) {
  try {
    behind = Number(sh(`git rev-list --count ${prodSha}..${head}`));
  } catch {
    behind = null; // 本地没这个对象（浅克隆），不硬编结论
  }
}

let srcDiff = [];
if (prodSha) {
  try {
    const out = sh(`git diff --name-status ${prodSha}..${head} -- src/`);
    srcDiff = out ? out.split("\n").filter(Boolean) : [];
  } catch {
    srcDiff = [];
  }
}

const report = {
  site: site.custom_domain || site.name,
  siteId: site.id,
  publishedDeploy: pub.id,
  publishedState: pub.state,
  publishedAt: pub.published_at,
  productionCommit: prodSha || "(unknown)",
  productionTitle: (pub.title || "").slice(0, 70),
  localHead: head,
  commitsBehind: behind,
  srcChangedFiles: srcDiff.length,
  srcDiff,
};

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`站点          : ${report.site}  (${report.siteId})`);
  console.log(`已发布部署    : ${report.publishedDeploy}  state=${report.publishedState}`);
  console.log(`发布时间      : ${report.publishedAt}`);
  console.log(`生产提交      : ${report.productionCommit}`);
  console.log(`  提交标题    : ${report.productionTitle}`);
  console.log(`本地 HEAD     : ${head}`);
  console.log(`落后提交数    : ${behind === null ? "未知（本地缺该对象）" : behind}`);
  console.log(`src 差异文件  : ${srcDiff.length}`);
  for (const line of srcDiff) console.log(`  ${line}`);
}

if (srcDiff.length > 0) {
  console.log("\n⚠️  生产落后于本地 HEAD，且差异含 src/ 应用代码 —— 发布是实质变更，不是空跑。");
  process.exit(1);
}
console.log("\n✅ src/ 无漂移（生产与 HEAD 的应用代码一致）。");
