import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3214';
const out = process.argv[3] || '/tmp/workspace-now.png';
const email = process.env.E2E_AUTHED_EMAIL;
const password = process.env.E2E_AUTHED_PASSWORD;

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => {
    const el = document.querySelector('#login-email');
    return !!el && Object.keys(el).some((k) => k.startsWith('__reactFiber'));
  },
  { timeout: 20000 },
);
await page.fill('#login-email', email);
await page.fill('#login-password', password);
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });

await page.goto(`${base}/workspace`, { waitUntil: 'networkidle' });
await page.screenshot({ path: out, fullPage: false });

const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
console.log('MAIN:', text.slice(0, 420));
const visible = await page.locator('body').innerText();
console.log('visible has /api/ =', /\/api\//.test(visible));
console.log('h1 =', await page.locator('main h1').first().innerText());
console.log('seeds =', await page.getByTestId('now-seed').count());
console.log('details open =', await page.locator('aside details').first().evaluate((el) => el.open));
console.log('shot =', out);

await browser.close();
