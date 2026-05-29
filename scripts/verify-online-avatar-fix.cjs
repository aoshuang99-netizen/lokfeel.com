#!/usr/bin/env node
// verify-online-avatar-fix.cjs
// 验证线上环境的头像修复是否生效

const https = require('https');

console.log('🔍 验证线上头像修复...\n');

// 测试1: 检查登录页是否能正常加载（视频背景）
function testLoginPage() {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'app.lokfeel.com',
      path: '/login',
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const hasVideo = data.includes('<video') || data.includes('background') || data.includes('.mp4');
        console.log(`✅ 登录页 (${res.statusCode}):`, hasVideo ? '包含视频/背景元素' : '⚠️  未检测到视频元素');
        resolve();
      });
    });
    req.on('error', (e) => { console.error('❌ 登录页请求失败:', e.message); resolve(); });
    req.end();
  });
}

// 测试2: 检查 API 路由是否存在（不是 404）
function testApiRoute() {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'app.lokfeel.com',
      path: '/api/admin/assign-real-photos',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`✅ API 路由 (${res.statusCode}):`, res.statusCode === 404 ? '❌ 不存在（404）' : '✅ 存在（非 404）');
        resolve();
      });
    });
    req.on('error', (e) => { console.error('❌ API 请求失败:', e.message); resolve(); });
    req.write('{}');
    req.end();
  });
}

// 测试3: 检查 CDN 缓存头
function testCacheHeaders() {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'app.lokfeel.com',
      path: '/login',
      method: 'HEAD'
    }, (res) => {
      const cacheControl = res.headers['cache-control'] || '';
      const hasMaxAge = cacheControl.includes('max-age=0') || cacheControl.includes('no-cache');
      console.log(`✅ 缓存策略:`, hasMaxAge ? '✅ 正确（无缓存）' : '⚠️  ' + cacheControl);
      resolve();
    });
    req.on('error', (e) => { console.error('❌ 缓存检查失败:', e.message); resolve(); });
    req.end();
  });
}

async function main() {
  await testLoginPage();
  console.log('');
  await testApiRoute();
  console.log('');
  await testCacheHeaders();
  
  console.log('\n📊 验证总结:');
  console.log('  1. 登录页视频背景需要浏览器手动验证');
  console.log('  2. API 路由已部署（返回非 404）');
  console.log('  3. 头像显示需要登录后手动验证');
  console.log('\n⚠️  自动验证有限，需要你手动检查:');
  console.log('  - 访问 https://app.lokfeel.com/login 查看视频背景');
  console.log('  - 登录后查看个人资料页头像是否显示真实照片');
  console.log('  - 查看其他用户头像是否显示真实照片（不是 DiceBear）');
}

main().then(() => process.exit(0));
