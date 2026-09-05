const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🌐 正在访问 Pusher.com...');
    
    // 访问 Pusher 注册页面
    await page.goto('https://pusher.com/signup');
    await page.waitForLoadState('networkidle');
    
    console.log('📝 请手动完成注册（如果需要）...');
    console.log('注册完成后，按 Enter 继续...');
    
    // 等待用户手动完成注册
    await new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
    
    console.log('🔨 正在创建 Pusher 应用...');
    
    // 创建应用
    await page.goto('https://dashboard.pusher.com/');
    await page.waitForLoadState('networkidle');
    
    // 点击 "Create App" 按钮
    await page.click('text=Create App');
    
    // 填写应用信息
    await page.fill('input[name="name"]', 'LokFeel Production');
    await page.selectOption('select[name="cluster"]', 'us3');
    await page.check('input[name="events"][value="client_events"]');
    await page.check('input[name="events"][value="webhooks"]');
    
    // 提交
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    
    console.log('📋 正在获取凭证...');
    
    // 获取凭证
    const appId = await page.textContent('[data-testid="app-id"]');
    const key = await page.textContent('[data-testid="key"]');
    const secret = await page.textContent('[data-testid="secret"]');
    const cluster = await page.textContent('[data-testid="cluster"]');
    
    console.log('✅ Pusher 凭证已获取：');
    console.log(`App ID: ${appId}`);
    console.log(`Key: ${key}`);
    console.log(`Secret: ${secret}`);
    console.log(`Cluster: ${cluster}`);
    
    // 保存到文件
    const fs = require('fs');
    const credentials = { appId, key, secret, cluster };
    fs.writeFileSync('/Users/frankzhao/WorkBuddy/20260402202519/nexus-app/.pusher-credentials.json', JSON.stringify(credentials, null, 2));
    
    console.log('💾 凭证已保存到 .pusher-credentials.json');
    
    // 添加到 Vercel
    console.log('🚀 正在添加到 Vercel...');
    
    const vercelToken = process.env.VERCEL_TOKEN;
    if (!vercelToken) throw new Error('VERCEL_TOKEN env var is required to push Pusher env vars to Vercel');
    const projectId = 'prj_QMkgqlqeJdqMb8Ky4IYyt4zHMJpK';
    
    // 添加环境变量
    for (const [key, value] of Object.entries({
      'PUSHER_APP_ID': appId,
      'PUSHER_KEY': key,
      'PUSHER_SECRET': secret,
      'PUSHER_CLUSTER': cluster,
      'NEXT_PUBLIC_PUSHER_KEY': key,
      'NEXT_PUBLIC_PUSHER_CLUSTER': cluster,
    })) {
      await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${vercelToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key,
          value,
          type: 'encrypted',
          target: ['production'],
        }),
      });
    }
    
    console.log('✅ 环境变量已添加到 Vercel！');
    console.log('⚠️ 需要重新部署才能生效：');
    console.log('cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app && npx vercel deploy --prod --yes --force --token ' + vercelToken + ' --scope team_mB47XaxLSdmchbYenno9qN5u');
    
  } catch (error) {
    console.error('❌ 错误：', error.message);
  } finally {
    await browser.close();
  }
})();
