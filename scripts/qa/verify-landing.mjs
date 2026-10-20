#!/usr/bin/env node
/**
 * 落地页叙事门禁 + 交互取证
 *
 * 为什么需要它：落地页曾被整段写成交友叙事（"AI matches what swiping can't"），
 * 与产品定位（Connection OS / SaaS 生成式平台）完全不符，而**所有既有门禁都没发现**——
 * 因为没人断言过"首页文案必须属于这个产品"。
 *
 * 本脚本断言三件事：
 *   1. 叙事：必须出现 Connection OS 的关键词；不得出现 dating/swiping/premium for women 等 legacy 词；
 *   2. 元信息：<title> 与 description 不得回到 "Relationship Matching Engine"；
 *   3. 交互：Hero 的「Compile workspace」真的能在浏览器里跑出三张结果卡（不是静态图）。
 *
 * 用法：
 *   node scripts/qa/verify-landing.mjs                  # 打生产
 *   node scripts/qa/verify-landing.mjs --base=http://localhost:3099
 *   node scripts/qa/verify-landing.mjs --self-test      # 反向对照：注入 legacy 文案，必须判红
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = argOf("base", "https://app.lokfeel.com").replace(/\/$/, "");
const SELF_TEST = argv.includes("--self-test");

const MUST_HAVE = [
  "Describe the outcome",
  "Connection OS",
  "Compile workspace",
  "WorkspaceSpec",
  "disclosure",
];

const MUST_NOT_HAVE = [
  "swiping",
  "dating app",
  "Ladies Never Pay",
  "curated matches",
  "premium free forever",
  "Relationship Matching Engine",
];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  let status = 0;
  let html = "";
  let text = "";
  try {
    const resp = await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
    status = resp?.status() ?? 0;
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    html = await page.content();
    text = await page.locator("body").innerText();
  } catch (e) {
    check("首页可达", false, String(e).slice(0, 120));
  }

  // 自证：注入 legacy 文案后，同一套断言必须判红（证明门禁不是恒真）。
  // 注入只进 body 文本（与 body-text 断言同通道）；title/description 走真实值，不掺假。
  if (SELF_TEST) {
    text =
      text +
      "\nAI matches what swiping can't. Ladies Never Pay. Relationship Matching Engine. curated matches premium free forever. dating app.";
    html = html + "Relationship Matching Engine";
    console.log("\n[self-test] 已注入 legacy 文案，下面应出现 FAIL：\n");
  }

  check("GET / 200", status === 200, `status=${status}`);

  const hay = text.toLowerCase();
  for (const kw of MUST_HAVE) {
    check(`必须包含「${kw}」`, hay.includes(kw.toLowerCase()));
  }
  for (const kw of MUST_NOT_HAVE) {
    check(`不得包含「${kw}」`, !hay.includes(kw.toLowerCase()));
  }

  // 元信息单独取，避免被 body 文本掩盖
  const title = await page.title();
  check(
    "title 不是交友定位",
    !/relationship matching|dating/i.test(title),
    `title="${title}"`,
  );
  check("title 含 Connection OS", /connection os/i.test(title), `title="${title}"`);

  const metaDesc = await page
    .locator('meta[name="description"]')
    .getAttribute("content")
    .catch(() => "");
  check(
    "description 不是交友定位",
    !/relationship matching|dating|curated matches/i.test(metaDesc || ""),
    (metaDesc || "").slice(0, 80),
  );

  // ── 交互取证：点「Compile workspace」→ 应出现三张结果卡 ──
  let compiled = false;
  let cardCount = 0;
  let shotPath = "";
  try {
    const btn = page.locator('button:has-text("Compile workspace")').first();
    await btn.click({ timeout: 8000 });
    await page.waitForTimeout(1400);
    cardCount = await page.locator("text=Goal & criteria").count();
    compiled = cardCount > 0;
  } catch (e) {
    check("编译按钮可点击", false, String(e).slice(0, 120));
  }
  check("点击「Compile workspace」后渲染结果卡", compiled, `cards=${cardCount}`);

  try {
    const dir = path.join(ROOT, "reports/ui-gallery/shots");
    await fs.mkdir(dir, { recursive: true });
    shotPath = path.join(dir, SELF_TEST ? "_selftest-landing.png" : "landing-v2.png");
    await page.screenshot({ path: shotPath, fullPage: true });
  } catch {
    /* 截图失败不影响断言结论 */
  }

  await browser.close();

  const fails = results.filter((r) => !r.ok).length;
  const passes = results.length - fails;
  console.log(`\n${passes} PASS / ${fails} FAIL / ${results.length} 断言`);
  if (shotPath) console.log(`截图：${path.relative(ROOT, shotPath)}`);

  // 自证模式：期望恰好"应该失败"的断言失败（≥3 条）
  if (SELF_TEST) {
    const expected = fails >= 3;
    console.log(expected ? "✅ 自证通过：注入 legacy 文案后门禁判红" : "❌ 自证失败：门禁对 legacy 文案无感（恒真）");
    process.exit(expected ? 0 : 1);
  }

  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
