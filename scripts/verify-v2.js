/**
 * Final verification via Playwright - login then screenshot
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    // 1. Go to login page
    console.log('1. Loading login page...');
    await page.goto('https://app.lokfeel.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'out/avatar-verify/10-login.png', fullPage: true });

    // 2. Fill in credentials and submit
    console.log('2. Filling credentials...');
    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    
    if (await emailInput.count() > 0) {
      await emailInput.fill('testlogin2026@lokfeel.com');
      await passwordInput.fill('Test123456!');
      
      // Click submit
      const submitBtn = page.locator('button[type="submit"]').first();
      await submitBtn.click();
      console.log('   Clicked submit');
      
      // Wait for redirect
      await page.waitForTimeout(5000);
    }
    
    console.log('   URL after login attempt:', page.url());
    await page.screenshot({ path: 'out/avatar-verify/11-after-login.png', fullPage: true });

    // 3. Try direct dashboard access
    console.log('3. Accessing dashboard directly...');
    await page.goto('https://app.lokfeel.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    console.log('   URL:', page.url());
    await page.screenshot({ path: 'out/avatar-verify/12-dashboard.png', fullPage: true });

    // 4. Try Discover page
    console.log('4. Accessing Discover...');
    await page.goto('https://app.lokfeel.com/dashboard/discover', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    console.log('   URL:', page.url());
    await page.screenshot({ path: 'out/avatar-verify/13-discover.png', fullPage: true });

    // Count images
    const allImages = await page.$$eval('img', imgs => 
      imgs.map(img => ({ src: img.src?.substring(0, 80), loaded: img.complete && img.naturalWidth > 0 }))
        .filter(img => img.src && (img.src.includes('randomuser') || img.src.includes('avatar') || img.src.includes('dicebear')))
    );
    console.log(`   Avatar images found: ${allImages.length}`);
    allImages.slice(0, 5).forEach(img => console.log(`   ${img.loaded ? '✅' : '❌'} ${img.src}`));

    // 5. Mobile viewport test
    console.log('5. Testing mobile viewport...');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('https://app.lokfeel.com/dashboard/discover', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'out/avatar-verify/14-discover-mobile.png', fullPage: true });

    console.log('\n✅ Screenshots saved to out/avatar-verify/');

  } catch (error) {
    console.error('❌ Error:', error.message?.substring(0, 200));
  } finally {
    await browser.close();
  }
})();
