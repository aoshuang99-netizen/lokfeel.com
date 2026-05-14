/**
 * LokFeel Admin Dashboard V3 — Production Browser Test
 * Tests all admin pages and API endpoints after withPermission RBAC fixes
 */

const { chromium } = require('playwright');

const BASE_URL = 'https://admin.lokfeel.com';
const API_BASE = 'https://admin.lokfeel.com/api/admin';

// Test credentials
const CREDENTIALS = {
  admin: { username: 'admin', password: 'Admin@2026!', role: 'SUPER_ADMIN' },
  moderator: { username: 'moderator', password: 'Mod@2026!', role: 'MODERATOR' },
  analyst: { username: 'analyst', password: 'Analyst@2026!', role: 'ANALYST' },
};

// All admin pages to test
const ADMIN_PAGES = [
  { path: '/admin', name: 'Dashboard Overview', expected: '仪表盘' },
  { path: '/admin/users', name: 'Users Management', expected: '用户管理' },
  { path: '/admin/analytics', name: 'Analytics', expected: '数据分析' },
  { path: '/admin/matches', name: 'Matches', expected: '匹配管理' },
  { path: '/admin/content', name: 'Content Management', expected: '内容管理' },
  { path: '/admin/audit', name: 'Audit Logs', expected: '审计日志' },
  { path: '/admin/rbac', name: 'RBAC Management', expected: '角色权限' },
  { path: '/admin/settings', name: 'Settings', expected: '系统设置' },
];

// API endpoints to test (withPermission protected)
const PROTECTED_APIS = [
  { method: 'GET', path: '/api/admin/users', name: 'Users List', permission: 'user.view' },
  { method: 'GET', path: '/api/admin/analytics', name: 'Analytics', permission: 'analytics.view' },
  { method: 'GET', path: '/api/admin/matches', name: 'Matches', permission: 'match.view' },
  { method: 'GET', path: '/api/admin/audit', name: 'Audit Logs', permission: 'audit.view' },
  { method: 'GET', path: '/api/admin/content', name: 'Content', permission: 'content.view' },
  { method: 'GET', path: '/api/admin/rbac/roles', name: 'RBAC Roles', permission: 'rbac.role.view' },
  { method: 'GET', path: '/api/admin/rbac/my-permissions', name: 'My Permissions', permission: 'rbac.role.view' },
  { method: 'GET', path: '/api/admin/session', name: 'Session Check', permission: 'none' },
];

// Unprotected APIs (BUG-03 candidates)
const UNPROTECTED_APIS = [
  { path: '/api/admin/import-users', name: 'Import Users' },
  { path: '/api/admin/subscriptions', name: 'Subscriptions' },
  { path: '/api/admin/subscriptions/test-id/refund', name: 'Subscription Refund' },
  { path: '/api/admin/generate-test-users', name: 'Generate Test Users' },
];

const results = {
  timestamp: new Date().toISOString(),
  login: [],
  pages: [],
  apis: [],
  unprotected: [],
  summary: { passed: 0, failed: 0, warnings: 0, total: 0 },
};

function log(emoji, category, name, status, detail = '') {
  const entry = { emoji, category, name, status, detail, time: new Date().toISOString() };
  if (status === 'PASS') results.summary.passed++;
  else if (status === 'FAIL') results.summary.failed++;
  else results.summary.warnings++;
  results.summary.total++;

  if (category === 'login') results.login.push(entry);
  else if (category === 'page') results.pages.push(entry);
  else if (category === 'api') results.apis.push(entry);
  else if (category === 'unprotected') results.unprotected.push(entry);

  console.log(`${emoji} [${status}] ${category.toUpperCase()}: ${name}${detail ? ' — ' + detail : ''}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('='.repeat(70));
  console.log('  LokFeel Admin Dashboard V3 — Production Verification Test');
  console.log('  Target: ' + BASE_URL);
  console.log('  Time: ' + new Date().toISOString());
  console.log('='.repeat(70));
  console.log('');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  // ==========================================================================
  // PHASE 1: Production Health Check (no auth)
  // ==========================================================================
  console.log('--- Phase 1: Production Health Check ---');
  const healthPage = await context.newPage();

  try {
    const response = await healthPage.goto(BASE_URL + '/admin', { waitUntil: 'networkidle', timeout: 30000 });
    const status = response.status();
    const finalUrl = healthPage.url();

    if (finalUrl.includes('/login') || finalUrl.includes('/admin/login')) {
      log('✅', 'page', 'Admin Login Redirect', 'PASS', `Status ${status}, redirects to ${finalUrl}`);
    } else {
      log('⚠️', 'page', 'Admin Home Access', 'WARN', `Status ${status}, URL: ${finalUrl}`);
    }
  } catch (e) {
    log('❌', 'page', 'Admin Home Access', 'FAIL', e.message.substring(0, 100));
  }
  await healthPage.close();

  // ==========================================================================
  // PHASE 2: Login Tests (all 3 roles)
  // ==========================================================================
  console.log('\n--- Phase 2: Login Tests ---');

  let adminCookies = null;

  for (const [roleName, creds] of Object.entries(CREDENTIALS)) {
    const page = await context.newPage();
    try {
      // Navigate to admin login
      const loginResp = await page.goto(BASE_URL + '/admin/login', { waitUntil: 'networkidle', timeout: 30000 });

      // Check if login page loads
      const loginPageUrl = page.url();
      if (!loginPageUrl.includes('login')) {
        log('❌', 'login', `${roleName} Login Page`, 'FAIL', `Expected login page, got: ${loginPageUrl}`);
        await page.close();
        continue;
      }

      // Wait for form elements
      await page.waitForSelector('input[type="text"], input[type="email"], input[name="username"], input[placeholder*="用户名"], input[placeholder*="邮箱"]', { timeout: 10000 }).catch(() => null);

      // Try to find and fill username
      const usernameInput = await page.$('input[name="username"], input[type="text"], input[placeholder*="用户名"], input[placeholder*="邮箱"]').catch(() => null);
      const passwordInput = await page.$('input[name="password"], input[type="password"]').catch(() => null);

      if (!usernameInput || !passwordInput) {
        // Maybe the page uses a different form structure - check for any visible input
        const allInputs = await page.$$('input');
        if (allInputs.length >= 2) {
          await allInputs[0].fill(creds.username);
          await allInputs[1].fill(creds.password);
        } else {
          log('❌', 'login', `${roleName} Login Form`, 'FAIL', `Could not find login form inputs (found ${allInputs.length} inputs)`);
          await page.close();
          continue;
        }
      } else {
        await usernameInput.fill(creds.username);
        await passwordInput.fill(creds.password);
      }

      // Click submit
      const submitBtn = await page.$('button[type="submit"], button:has-text("登录"), button:has-text("Login"), button:has-text("Sign")').catch(() => null);
      if (submitBtn) {
        await submitBtn.click();
      } else {
        // Try pressing Enter
        await page.keyboard.press('Enter');
      }

      // Wait for navigation or response
      await sleep(3000);
      const afterLoginUrl = page.url();

      // Check for error messages
      const errorMsg = await page.$eval('[class*="error"], [class*="Error"], [role="alert"]', el => el.textContent).catch(() => null);

      // Check cookies
      const cookies = await context.cookies();
      const adminSession = cookies.find(c => c.name === 'admin_session');

      if (afterLoginUrl.includes('/admin') && !afterLoginUrl.includes('/login') && adminSession) {
        log('✅', 'login', `${roleName} Login`, 'PASS', `Redirected to ${afterLoginUrl}, session cookie set`);
        if (roleName === 'admin') {
          adminCookies = cookies;
        }
      } else if (adminSession) {
        log('✅', 'login', `${roleName} Login`, 'PASS', `Session cookie set, URL: ${afterLoginUrl}`);
        if (roleName === 'admin') {
          adminCookies = cookies;
        }
      } else if (errorMsg) {
        log('❌', 'login', `${roleName} Login`, 'FAIL', `Error: ${errorMsg.substring(0, 80)}`);
      } else {
        log('❌', 'login', `${roleName} Login`, 'FAIL', `No session cookie, URL: ${afterLoginUrl}`);
      }

    } catch (e) {
      log('❌', 'login', `${roleName} Login`, 'FAIL', e.message.substring(0, 100));
    }
    await page.close();
  }

  // ==========================================================================
  // PHASE 3: API Tests (with admin session)
  // ==========================================================================
  console.log('\n--- Phase 3: API Endpoint Tests ---');

  // Use API directly with admin session cookie
  if (adminCookies) {
    const cookieStr = adminCookies.map(c => `${c.name}=${c.value}`).join('; ');

    for (const api of PROTECTED_APIS) {
      try {
        const url = `${BASE_URL}${api.path}`;
        const resp = await fetch(url, {
          method: api.method,
          headers: {
            'Cookie': cookieStr,
            'Content-Type': 'application/json',
          },
          redirect: 'manual',
        });

        const status = resp.status;
        const body = await resp.text().catch(() => '');
        let json = null;
        try { json = JSON.parse(body); } catch {}

        if (status === 200 || status === 201) {
          log('✅', 'api', api.name, 'PASS', `HTTP ${status}, ${json ? JSON.stringify(json).substring(0, 60) : 'ok'}`);
        } else if (status === 401) {
          log('❌', 'api', api.name, 'FAIL', `HTTP 401 Unauthorized — session may be invalid`);
        } else if (status === 403) {
          log('⚠️', 'api', api.name, 'WARN', `HTTP 403 Forbidden — permission: ${api.permission}`);
        } else if (status === 302 || status === 307) {
          log('⚠️', 'api', api.name, 'WARN', `HTTP ${status} Redirect`);
        } else {
          log('⚠️', 'api', api.name, 'WARN', `HTTP ${status}`);
        }
      } catch (e) {
        log('❌', 'api', api.name, 'FAIL', e.message.substring(0, 80));
      }
    }

    // Test unprotected APIs (without auth)
    console.log('\n--- Phase 3b: Unprotected API Check ---');
    for (const api of UNPROTECTED_APIS) {
      try {
        const url = `${BASE_URL}${api.path}`;
        const resp = await fetch(url, {
          method: api.path.includes('refund') || api.path.includes('import') || api.path.includes('generate') ? 'POST' : 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          redirect: 'manual',
        });

        const status = resp.status;
        if (status === 401) {
          log('✅', 'unprotected', api.name, 'PASS', `HTTP 401 — properly requires auth`);
        } else if (status === 403) {
          log('✅', 'unprotected', api.name, 'PASS', `HTTP 403 — properly blocked`);
        } else if (status === 405) {
          log('✅', 'unprotected', api.name, 'PASS', `HTTP 405 — method not allowed`);
        } else if (status === 200 || status === 201) {
          log('🔴', 'unprotected', api.name, 'FAIL', `HTTP ${status} — ACCESSIBLE WITHOUT AUTH! Security risk!`);
        } else {
          log('⚠️', 'unprotected', api.name, 'WARN', `HTTP ${status}`);
        }
      } catch (e) {
        log('⚠️', 'unprotected', api.name, 'WARN', e.message.substring(0, 80));
      }
    }

    // ==========================================================================
    // PHASE 4: Page Navigation Tests (logged in)
    // ==========================================================================
    console.log('\n--- Phase 4: Page Navigation Tests ---');

    const testPage = await context.newPage();
    for (const pageConfig of ADMIN_PAGES) {
      try {
        const resp = await testPage.goto(BASE_URL + pageConfig.path, { waitUntil: 'networkidle', timeout: 20000 });
        const status = resp.status();
        const url = testPage.url();
        const title = await testPage.title().catch(() => '');

        // Check if redirected to login
        if (url.includes('/login')) {
          log('❌', 'page', pageConfig.name, 'FAIL', `Redirected to login (auth expired?)`);
          // Try re-login
          break;
        }

        // Check for error pages
        const pageContent = await testPage.textContent('body').catch(() => '');
        const hasError = pageContent.includes('500') || pageContent.includes('Error') || pageContent.includes('错误');

        if (status === 200 && !url.includes('/login')) {
          log('✅', 'page', pageConfig.name, 'PASS', `HTTP ${status}, title: ${title}`);
        } else if (status === 404) {
          log('⚠️', 'page', pageConfig.name, 'WARN', `HTTP 404 — page not found`);
        } else {
          log('❌', 'page', pageConfig.name, 'FAIL', `HTTP ${status}`);
        }
      } catch (e) {
        log('❌', 'page', pageConfig.name, 'FAIL', e.message.substring(0, 80));
      }
    }
    await testPage.close();
  } else {
    log('❌', 'login', 'Admin Session', 'FAIL', 'No admin session cookie — cannot test APIs and pages');
  }

  // ==========================================================================
  // PHASE 5: Demo Admin Credentials in Production Check
  // ==========================================================================
  console.log('\n--- Phase 5: Security Checks ---');

  // Test demo admin login works in production (BUG-02 verification)
  const securityPage = await context.newPage();
  try {
    // Clear cookies
    await context.clearCookies();

    const loginResp = await securityPage.goto(BASE_URL + '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'Admin@2026!' }),
    });

    const status = loginResp.status();
    const body = await loginResp.json().catch(() => ({}));

    if (status === 200 && body.success) {
      const cookies = await context.cookies();
      const hasSession = cookies.some(c => c.name === 'admin_session');
      if (hasSession) {
        log('🔴', 'login', 'Demo Admin in Production', 'FAIL', `Demo admin login works in production! ADMIN_CREDENTIALS_ENABLED may not be "false"`);
      } else {
        log('⚠️', 'login', 'Demo Admin in Production', 'WARN', `Login returned success but no session cookie`);
      }
    } else if (status === 401) {
      log('✅', 'login', 'Demo Admin in Production', 'PASS', `Demo credentials disabled in production (HTTP 401)`);
    } else {
      log('⚠️', 'login', 'Demo Admin in Production', 'WARN', `HTTP ${status}, body: ${JSON.stringify(body).substring(0, 80)}`);
    }
  } catch (e) {
    log('⚠️', 'login', 'Demo Admin Security Check', 'WARN', e.message.substring(0, 80));
  }
  await securityPage.close();

  await browser.close();

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('  TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Total:   ${results.summary.total}`);
  console.log(`  Passed:  ${results.summary.passed} ✅`);
  console.log(`  Failed:  ${results.summary.failed} ❌`);
  console.log(`  Warning: ${results.summary.warnings} ⚠️`);
  console.log('='.repeat(70));

  // Print failures first
  if (results.summary.failed > 0) {
    console.log('\n🔴 FAILURES:');
    const allEntries = [...results.login, ...results.pages, ...results.apis, ...results.unprotected];
    for (const entry of allEntries) {
      if (entry.status === 'FAIL') {
        console.log(`  - [${entry.category}] ${entry.name}: ${entry.detail}`);
      }
    }
  }

  // Security findings
  console.log('\n🛡️ SECURITY FINDINGS:');
  const securityIssues = [...results.unprotected.filter(e => e.status === 'FAIL'),
                          ...results.login.filter(e => e.name.includes('Production') && e.status === 'FAIL')];
  if (securityIssues.length === 0) {
    console.log('  No critical security issues detected.');
  } else {
    for (const issue of securityIssues) {
      console.log(`  - 🔴 ${issue.name}: ${issue.detail}`);
    }
  }

  // Output results as JSON
  const fs = require('fs');
  const outputPath = '/Users/frankzhao/WorkBuddy/20260429150035/admin-production-test-results.json';
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n📄 Full results saved to: ${outputPath}`);

  // Exit with error code if any failures
  process.exit(results.summary.failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
