/**
 * Final verification: Login and screenshot Discover/Square pages
 */
const { chromium } = require('playwright');
const bcrypt = require('bcryptjs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    // 1. Login via API to get session
    console.log('1. Getting CSRF token...');
    await page.goto('https://app.lokfeel.com/api/auth/csrf', { waitUntil: 'networkidle' });
    const csrfContent = await page.textContent('body');
    const csrfData = JSON.parse(csrfContent);
    const csrfToken = csrfData.csrfToken;
    console.log('   CSRF token:', csrfToken?.substring(0, 20) + '...');

    // 2. Login via credentials
    console.log('2. Logging in...');
    const loginResponse = await page.request.post('https://app.lokfeel.com/api/auth/callback/credentials', {
      form: {
        email: 'testlogin2026@lokfeel.com',
        password: 'Test123456!',
        csrfToken,
        callbackUrl: 'https://app.lokfeel.com/dashboard',
        json: 'true',
      },
    });
    console.log('   Login response status:', loginResponse.status());

    // 3. Navigate to dashboard
    console.log('3. Navigating to dashboard...');
    await page.goto('https://app.lokfeel.com/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    console.log('   URL:', page.url());
    await page.screenshot({ path: 'out/avatar-verify/06-dashboard-loggedin.png', fullPage: true });

    // 4. Discover page
    console.log('4. Navigating to Discover...');
    await page.goto('https://app.lokfeel.com/dashboard/discover', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'out/avatar-verify/07-discover-loggedin.png', fullPage: true });

    // Count avatar images
    const avatars = await page.$$eval('img[src*="randomuser"]', imgs => imgs.length);
    console.log(`   Found ${avatars} RandomUser avatar images on Discover`);

    // 5. Square page
    console.log('5. Navigating to Square...');
    await page.goto('https://app.lokfeel.com/dashboard/square', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'out/avatar-verify/08-square-loggedin.png', fullPage: true });

    const squareAvatars = await page.$$eval('img[src*="randomuser"]', imgs => imgs.length);
    console.log(`   Found ${squareAvatars} RandomUser avatar images on Square`);

    console.log('\n🎉 Verification complete!');
    console.log('Screenshots saved to out/avatar-verify/');

  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: 'out/avatar-verify/error-final.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
