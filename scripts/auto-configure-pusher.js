const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');

(async () => {
  console.log('🚀 开始自动化配置 Pusher...');
  
  // 检查是否已有凭证
  const credFile = '/Users/frankzhao/WorkBuddy/20260402202519/nexus-app/.pusher-credentials.json';
  if (fs.existsSync(credFile)) {
    console.log('✅ 发现已保存的凭证，直接使用...');
    const creds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
    await addToVercel(creds);
    return;
  }
  
  console.log('🌐 正在使用 Playwright 自动化创建 Pusher 应用...');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // 访问 Pusher 登录页面
    console.log('📝 步骤 1: 访问 Pusher Dashboard...');
    await page.goto('https://dashboard.pusher.com/sign_in');
    await page.waitForLoadState('networkidle');
    
    console.log('⚠️  请在浏览器中手动登录 Pusher 账号...');
    console.log('登录完成后，脚本会自动继续（等待 60 秒）...');
    
    // 等待用户登录（检测是否跳转到 dashboard）
    await page.waitForURL('**/dashboard.pusher.com/**', { timeout: 60000 });
    
    console.log('✅ 登录成功！');
    
    // 创建新应用
    console.log('📝 步骤 2: 创建 Pusher 应用...');
    await page.click('text=Create App');
    await page.waitForLoadState('networkidle');
    
    // 填写应用信息
    await page.fill('input[name="app[name]"]', 'LokFeel Production');
    await page.selectOption('select[name="app[cluster]"]', 'us3');
    
    // 提交
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    
    console.log('✅ 应用创建成功！');
    
    // 获取凭证
    console.log('📝 步骤 3: 获取凭证...');
    
    // 等待页面加载完成
    await page.waitForTimeout(2000);
    
    // 获取 App ID
    const appId = await page.textContent('[data-testid="app-id"]') || 
                   await page.locator('text=/App ID.*/').first().textContent();
    
    // 获取 Key
    const key = await page.textContent('[data-testid="key"]') ||
                await page.locator('text=/Key.*/').first().textContent();
    
    // 获取 Secret
    const secret = await page.textContent('[data-testid="secret"]') ||
                   await page.locator('text=/Secret.*/').first().textContent();
    
    // 获取 Cluster
    const cluster = await page.textContent('[data-testid="cluster"]') ||
                   await page.locator('text=/Cluster.*/').first().textContent() ||
                   'us3';
    
    console.log('✅ 凭证获取成功：');
    console.log(`  App ID: ${appId}`);
    console.log(`  Key: ${key}`);
    console.log(`  Cluster: ${cluster}`);
    
    // 保存凭证
    const creds = {
      PUSHER_APP_ID: appId,
      PUSHER_KEY: key,
      PUSHER_SECRET: secret,
      PUSHER_CLUSTER: cluster
    };
    
    fs.writeFileSync(credFile, JSON.stringify(creds, null, 2));
    console.log('💾 凭证已保存到 .pusher-credentials.json');
    
    // 添加到 Vercel
    await addToVercel(creds);
    
  } catch (error) {
    console.error('❌ 错误：', error.message);
    console.log('');
    console.log('💡 手动配置指南：');
    console.log('1. 访问 https://dashboard.pusher.com/');
    console.log('2. 创建应用或选择现有应用');
    console.log('3. 复制 App ID, Key, Secret, Cluster');
    console.log('4. 运行: node scripts/add-pusher-to-vercel.js');
  } finally {
    await browser.close();
  }
})();

async function addToVercel(creds) {
  console.log('');
  console.log('🚀 正在添加到 Vercel...');
  
  const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
  if (!VERCEL_TOKEN) throw new Error('VERCEL_TOKEN env var is required to push Pusher env vars to Vercel');
  const PROJECT_ID = 'prj_QMkgqlqeJdqMb8Ky4IYyt4zHMJpK';
  
  const envVars = {
    'PUSHER_APP_ID': creds.PUSHER_APP_ID,
    'PUSHER_KEY': creds.PUSHER_KEY,
    'PUSHER_SECRET': creds.PUSHER_SECRET,
    'PUSHER_CLUSTER': creds.PUSHER_CLUSTER,
    'NEXT_PUBLIC_PUSHER_KEY': creds.PUSHER_KEY,
    'NEXT_PUBLIC_PUSHER_CLUSTER': creds.PUSHER_CLUSTER
  };
  
  for (const [key, value] of Object.entries(envVars)) {
    console.log(`  添加 ${key}...`);
    
    const data = JSON.stringify({
      key,
      value,
      type: 'encrypted',
      target: ['production']
    });
    
    const options = {
      hostname: 'api.vercel.com',
      path: `/v9/projects/${PROJECT_ID}/env`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };
    
    await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            console.log(`    ✅ ${key} 添加成功`);
            resolve();
          } else {
            console.log(`    ⚠️  ${key} 可能已存在（${res.statusCode}）`);
            resolve();
          }
        });
      });
      
      req.on('error', (error) => {
        console.log(`    ❌ ${key} 添加失败: ${error.message}`);
        resolve();
      });
      
      req.write(data);
      req.end();
    });
  }
  
  console.log('');
  console.log('✅ 环境变量已添加到 Vercel！');
  console.log('');
  console.log('🚀 正在重新部署（使环境变量生效）...');
  
  // 重新部署
  const { exec } = require('child_process');
  const deployCmd = `cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app && npx vercel deploy --prod --yes --force --token ${VERCEL_TOKEN} --scope team_mB47XaxLSdmchbYenno9qN5u`;
  
  exec(deployCmd, (error, stdout, stderr) => {
    if (error) {
      console.error('❌ 部署失败：', error.message);
      return;
    }
    console.log('✅ 部署完成！');
    console.log('');
    console.log('🌐 生产环境: https://app.lokfeel.com');
    console.log('');
    console.log('📋 下一步：');
    console.log('1. 访问 https://app.lokfeel.com/dashboard/chats');
    console.log('2. 发送测试消息，验证 Pusher 实时消息');
    console.log('3. 测试 WebRTC 视频通话功能');
  });
}
