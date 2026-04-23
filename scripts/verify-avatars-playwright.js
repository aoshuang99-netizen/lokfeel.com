/**
 * Playwright script: Verify avatar rendering on production
 * Logs in with test account and screenshots the Discover page
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    // 1. Navigate to login
    console.log('1. Navigating to login page...');
    await page.goto('https://app.lokfeel.com/login', { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: 'out/avatar-verify/01-login.png', fullPage: true });
    console.log('   ✅ Login page screenshot saved');

    // 2. Fill login form
    console.log('2. Filling login form...');
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    
    await emailInput.fill('testlogin2026@lokfeel.com');
    await passwordInput.fill('Test123456!');
    
    // Click login button
    const loginBtn = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log In"), button:has-text("Login")').first();
    await loginBtn.click();
    
    // Wait for navigation
    await page.waitForURL('**/dashboard/**', { timeout: 15000 }).catch(() => {
      console.log('   ⚠️ Dashboard redirect not detected, checking current URL...');
    });
    
    await page.waitForTimeout(3000);
    console.log('   Current URL:', page.url());
    await page.screenshot({ path: 'out/avatar-verify/02-after-login.png', fullPage: true });
    console.log('   ✅ After-login screenshot saved');

    // 3. Navigate to Discover page
    console.log('3. Navigating to Discover page...');
    await page.goto('https://app.lokfeel.com/dashboard/discover', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000); // Wait for avatars to load
    await page.screenshot({ path: 'out/avatar-verify/03-discover.png', fullPage: true });
    console.log('   ✅ Discover page screenshot saved');

    // 4. Navigate to Square page
    console.log('4. Navigating to Square page...');
    await page.goto('https://app.lokfeel.com/dashboard/square', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'out/avatar-verify/04-square.png', fullPage: true });
    console.log('   ✅ Square page screenshot saved');

    // 5. Navigate to Dashboard
    console.log('5. Navigating to Dashboard...');
    await page.goto('https://app.lokfeel.com/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'out/avatar-verify/05-dashboard.png', fullPage: true });
    console.log('   ✅ Dashboard screenshot saved');

    // 6. Check for avatar images on the page
    console.log('6. Checking avatar images on Discover page...');
    await page.goto('https://app.lokfeel.com/dashboard/discover', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);
    
    const avatarImages = await page.$$eval('img', imgs => 
      imgs.map(img => ({
        src: img.src?.substring(0, 80),
        alt: img.alt,
        naturalWidth: img.naturalWidth,
        loaded: img.complete && img.naturalWidth > 0,
      })).filter(img => img.src?.includes('randomuser') || img.src?.includes('avatar'))
    );
    
    console.log(`   Found ${avatarImages.length} avatar images`);
    avatarImages.slice(0, 5).forEach(img => {
      console.log(`   ${img.loaded ? '✅' : '❌'} ${img.src} (${img.naturalWidth}px)`);
    });

    console.log('\n🎉 Avatar verification complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: 'out/avatar-verify/error.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
