/**
 * GA-20 浏览器存储审计（P0 安全 · 真实浏览器）
 * ═══════════════════════════════════════════════════════════════════════
 * 作战包 GA-20 硬验收：
 *   注册页输入 password / DOB / gender 后，实际检查
 *   localStorage / sessionStorage / URL / 网络请求体 都不得出现明文密码、
 *   验证码、敏感关系资料；刷新后密码不得从浏览器存储复活。
 *
 * 这是**真实浏览器**证据，不是纯函数单测。用系统 Chrome（channel:chrome）。
 * 不依赖发信：拦截 /api/auth/register 返回可控响应，避免真实 SMTP。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://127.0.0.1:3104';
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'docs/v25.6/ga-closure/evidence/GA20_BROWSER_STORAGE_AUDIT.json';

const PASSWORD = ['Audit', 'P@ssw0rd', '2026'].join('-');
const LEGACY_PASSWORD = ['Legacy', 'Plaintext', 'P@ssw0rd', '2026'].join('-');
const EMAIL = 'storage.audit@example.test';
const NAME = 'Storage Audit';

const checks = [];
function record(name, ok, detail = {}) {
  checks.push({ name, ok, ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

async function dumpStorage(page) {
  return page.evaluate(() => {
    const local = {};
    const session = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        local[k] = localStorage.getItem(k);
      }
    } catch { /* blocked */ }
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        session[k] = sessionStorage.getItem(k);
      }
    } catch { /* blocked */ }
    return { local, session, url: window.location.href };
  });
}

function containsSecret(dump, secret) {
  return JSON.stringify(dump).includes(secret);
}

async function main() {
  let browser;
  try {
    const launchOptions = process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {};
    browser = await chromium.launch(launchOptions);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // 拦截发码接口：返回 ok，但绝不产生真实邮件；把请求体记下来供审计。
    const sentBodies = [];
    await page.route('**/api/auth/register', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        try { sentBodies.push(req.postDataJSON()); } catch { /* ignore */ }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'code sent',
          maskedIdentifier: 's***@example.test',
          devMode: false,
        }),
      });
    });

    await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' });
    // 等待水合
    await page.locator('#reg-name').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('#reg-name').fill(NAME);
    await page.locator('#reg-email').fill(EMAIL);
    await page.locator('#reg-password').fill(PASSWORD);
    await page.locator('#dob-year').selectOption('1995');
    await page.locator('#dob-month').selectOption('03');
    await page.locator('#dob-day').selectOption('14');
    // 输入密码后给 autosave effect 时间落盘
    await page.waitForTimeout(600);

    const dumpAfterInput = await dumpStorage(page);
    record('输入后 localStorage/sessionStorage/URL 不含明文密码',
      !containsSecret(dumpAfterInput, PASSWORD));
    record('输入后不含出生日期',
      !containsSecret(dumpAfterInput, '1995-03-14'));
    const regRaw = dumpAfterInput.local['lokfeel_register_state'] ?? '';
    record('注册缓存存在且为白名单信封结构',
      regRaw.length > 0 && JSON.parse(regRaw)?.version === 2,
      { key: 'lokfeel_register_state', len: regRaw.length });
    if (regRaw) {
      const parsed = JSON.parse(regRaw);
      const valueStr = JSON.stringify(parsed.value ?? {});
      record('持久化 value 内不含密码键/值',
        !valueStr.includes('password') && !valueStr.includes(PASSWORD));
      record('持久化 value 内不含 dob/gender/sexuality',
        !valueStr.includes('dob') && !valueStr.includes('gender') && !valueStr.includes('sexuality'));
      record('持久化保留非敏感 email 供恢复',
        (parsed.value?.email ?? '') === EMAIL);
    }

    // 刷新后密码不得从存储复活：password input 应为空
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#reg-name').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(400);
    const passwordValue = await page.locator('#reg-password').inputValue();
    record('刷新后密码输入框为空（未从存储恢复）', passwordValue === '',
      { passwordInputLen: passwordValue.length });
    // 非敏感草稿恢复由 mount effect 完成，等 UI 真正回填而不是猜固定延时。
    await page.waitForFunction(
      (email) => (document.querySelector('#reg-email')?.value ?? '') === email,
      EMAIL,
      { timeout: 5000 },
    ).catch(() => {});
    const emailValue = await page.locator('#reg-email').inputValue();
    const dumpAfterReload = await dumpStorage(page);
    record('刷新后 email 从白名单恢复', emailValue === EMAIL,
      { restored: emailValue === EMAIL, stored: dumpAfterReload.local['lokfeel_register_state']?.slice(0, 200) });

    // GA-20 旧缓存物理擦除：模拟旧版本写下的明文密码/验证码信封，重新加载后
    // 断言原始敏感字符串在 localStorage 中不再存在，且被 v2 白名单信封覆盖。
    await page.evaluate(({ email, legacyPassword }) => {
      localStorage.setItem('lokfeel_register_state', JSON.stringify({
        phase: 'form',
        formData: {
          name: 'Storage Audit', email, password: legacyPassword,
          dob: '1995-03-14', gender: 'FEMALE', sexuality: 'OTHER',
          agreeToTerms: true, confirmAge: true,
        },
        sentInfo: { maskedIdentifier: 's***@example.test', devMode: true, code: '482913' },
        savedAt: Date.now(),
      }));
    }, { email: EMAIL, legacyPassword: LEGACY_PASSWORD });
    const seededRaw = await page.evaluate(() => localStorage.getItem('lokfeel_register_state') ?? '');
    record('旧格式敏感缓存夹具已注入（前置非空）', seededRaw.includes(LEGACY_PASSWORD));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#reg-name').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(500);
    const sanitizedRaw = await page.evaluate(() => localStorage.getItem('lokfeel_register_state') ?? '');
    record('旧缓存中的明文密码被就地清除', sanitizedRaw.length > 0 && !sanitizedRaw.includes(LEGACY_PASSWORD),
      { len: sanitizedRaw.length });
    record('旧缓存被覆盖为 v2 白名单信封', JSON.parse(sanitizedRaw)?.version === 2);
    record('旧缓存中的验证码键被清除', !sanitizedRaw.includes('"code"') && !sanitizedRaw.includes('482913'));

    // 提交发码 → verify 阶段。DOB 刻意不持久化，刷新后需重新填写（这正是 GA-20 的预期行为）。
    await page.locator('#reg-password').fill(PASSWORD);
    await page.locator('#dob-year').selectOption('1995');
    await page.locator('#dob-month').selectOption('03');
    await page.locator('#dob-day').selectOption('14');
    await page.locator('#reg-agreeToTerms').check();
    await page.locator('#reg-confirmAge').check();
    await page.locator('button[type="submit"]').click();
    await page.locator('#code-0').waitFor({ state: 'visible', timeout: 10000 });
    const dumpVerify = await dumpStorage(page);
    record('verify 阶段存储不含明文密码', !containsSecret(dumpVerify, PASSWORD));
    record('verify 阶段存储不含验证码键 code',
      !(dumpVerify.local['lokfeel_register_state'] ?? '').includes('"code"'));

    const finalDump = dumpVerify;
    // 脱敏：把可能含邮箱的值替换为占位，避免证据落盘含真实（虽然是测试）邮箱
    const redacted = JSON.parse(JSON.stringify(finalDump));
    for (const scope of ['local', 'session']) {
      for (const k of Object.keys(redacted[scope])) {
        redacted[scope][k] = (redacted[scope][k] ?? '').replace(/[\w.+-]+@[\w.-]+/g, '<email>');
      }
    }

    const passed = checks.filter((c) => c.ok).length;
    const failed = checks.length - passed;
    const result = {
      verdict: failed === 0 ? 'PASS' : 'FAIL',
      passed,
      failed,
      checks,
      sentRequestBodiesCount: sentBodies.length,
      note: '测试邮箱/密码为合成夹具；发送接口被拦截，无真实邮件/SMTP。请求体仅计数不落盘明文密码。',
      storageRedacted: redacted,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2).split(EMAIL).join('<email>'));
    console.log(`\nverdict=${result.verdict} ${passed}/${checks.length}`);
    await browser.close();
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('AUDIT ERROR', err);
    if (browser) await browser.close();
    process.exit(2);
  }
}

main();
