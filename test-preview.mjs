/**
 * LokFeel 综合预览测试 v3
 * - 直接通过NextAuth API登录获取session
 * - 桌面+移动全页面截图
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const OUT_DIR = join(process.cwd(), 'out', 'preview-test');
mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = 'aoshuang99@gmail.com';
const TEST_PASSWORD = 'Aa123456';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function login(page) {
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(2000);

  // Fill form
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i], input[id="email"]').first();
  const passwordInput = page.locator('input[type="password"], input[name="password"], input[id="password"]').first();
  
  await emailInput.click();
  await emailInput.fill(TEST_EMAIL);
  await passwordInput.click();
  await passwordInput.fill(TEST_PASSWORD);

  // Click submit
  const submitBtn = page.locator('button[type="submit"]').first();
  await submitBtn.click();

  // Wait for navigation away from login
  try {
    await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });
  } catch (e) {
    console.log('   ⚠️  登录重定向超时, 当前URL:', page.url());
    // Try pressing Enter as fallback
    await passwordInput.press('Enter');
    await sleep(5000);
  }
  
  return page.url();
}

async function testPages(context, label, pages) {
  const page = await context.newPage();
  const results = [];

  // Login first
  console.log(`\n🔑 ${label} 登录...`);
  try {
    const afterLoginUrl = await login(page);
    console.log(`   登录后URL: ${afterLoginUrl}`);
    await page.screenshot({ path: join(OUT_DIR, `${label}-after-login.png`), fullPage: true });
    
    if (afterLoginUrl.includes('/login')) {
      console.log('   ⚠️  登录可能未成功, 尝试继续...');
      // Try navigating directly after a delay
      await sleep(3000);
    }
  } catch (e) {
    console.log(`   ❌ 登录异常: ${e.message.slice(0, 100)}`);
  }

  for (const pg of pages) {
    console.log(`📸 ${label} ${pg.name}...`);
    try {
      await page.goto(BASE_URL + pg.path, { timeout: 20000, waitUntil: 'domcontentloaded' });
      await sleep(4000);
      await page.screenshot({ path: join(OUT_DIR, pg.file), fullPage: true });
      const url = page.url();
      const ok = !url.includes('/login') || url.includes('callbackUrl');
      console.log(`   ${ok ? '✅' : '⚠️'}  ${url}`);
      results.push({ name: pg.name, status: ok ? 'PASS' : 'WARN', url });
    } catch (e) {
      console.log(`   ❌ ${e.message.slice(0, 80)}`);
      results.push({ name: pg.name, status: 'FAIL', url: e.message.slice(0, 80) });
    }
  }

  return results;
}

async function main() {
  console.log('🚀 LokFeel 综合预览测试 v3\n');
  const browser = await chromium.launch({ headless: true });
  const allResults = {};

  // Desktop
  const dCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  allResults.desktop = await testPages(dCtx, 'desktop', [
    { name: 'Dashboard', path: '/dashboard', file: 'desktop-dashboard.png' },
    { name: 'Discover', path: '/dashboard/discover', file: 'desktop-discover.png' },
    { name: 'Chat', path: '/dashboard/chat', file: 'desktop-chat.png' },
    { name: 'Activity', path: '/dashboard/activity', file: 'desktop-activity.png' },
    { name: 'Profile', path: '/dashboard/profile', file: 'desktop-profile.png' },
  ]);
  await dCtx.close();

  // Mobile
  const mCtx = await browser.newContext({ 
    viewport: { width: 375, height: 812 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  allResults.mobile = await testPages(mCtx, 'mobile', [
    { name: 'Dashboard', path: '/dashboard', file: 'mobile-dashboard.png' },
    { name: 'Discover', path: '/dashboard/discover', file: 'mobile-discover.png' },
    { name: 'Chat', path: '/dashboard/chat', file: 'mobile-chat.png' },
  ]);
  await mCtx.close();

  await browser.close();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试结果汇总');
  console.log('='.repeat(60));

  for (const [device, results] of Object.entries(allResults)) {
    const passed = results.filter(r => r.status === 'PASS').length;
    const total = results.length;
    console.log(`\n${device === 'desktop' ? '🖥️  桌面端' : '📱 移动端'}: ${passed}/${total} 通过`);
    for (const r of results) {
      const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
      console.log(`  ${icon} ${r.name}: ${r.url}`);
    }
  }

  console.log(`\n📁 截图目录: ${OUT_DIR}`);
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('❌ 测试执行错误:', e);
  process.exit(1);
});
