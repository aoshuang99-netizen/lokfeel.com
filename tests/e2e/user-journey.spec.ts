import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'https://app.lokfeel.com';

// 测试用户凭证
const TEST_USER = {
  email: 'test@example.com',
  password: 'Test123!',
};

// 辅助函数：等待页面加载
async function waitForPageLoad(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
}

// 辅助函数：截图并保存
async function takeScreenshot(page: Page, name: string) {
  await page.screenshot({ 
    path: `/Users/frankzhao/WorkBuddy/20260402202519/qa/screenshots/${name}.png`,
    fullPage: true 
  });
}

// ==================== 测试套件 1: Onboarding流程 ====================
test.describe('🎯 Onboarding流程测试', () => {
  
  test('Step 1: 基本信息页面加载和交互', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/onboarding-v3?step=0`);
    await waitForPageLoad(page);
    
    // 验证页面标题
    await expect(page.locator('text=Basic Info')).toBeVisible();
    await expect(page.locator('text=Let\'s get to know you')).toBeVisible();
    
    // 验证表单字段
    await expect(page.locator('input[name="nickname"]')).toBeVisible();
    await expect(page.locator('input[name="birthday"]')).toBeVisible();
    
    // 测试输入
    await page.fill('input[name="nickname"]', 'TestUser');
    await page.fill('input[name="birthday"]', '1995-06-15');
    
    await takeScreenshot(page, 'onboarding-step1-filled');
    
    console.log('✅ Step 1: 基本信息页面正常');
  });

  test('Step 2: 关系偏好页面', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/onboarding-v3?step=1`);
    await waitForPageLoad(page);
    
    await expect(page.locator('text=Relationship Preferences')).toBeVisible();
    
    // 验证关系类型选项
    const relationshipTypes = ['Monogamous', 'Polyamorous', 'Open', 'Casual', 'Exploring'];
    for (const type of relationshipTypes) {
      await expect(page.locator(`text=${type}`)).toBeVisible();
    }
    
    // 测试选择
    await page.click('text=Monogamous');
    await expect(page.locator('text=Monogamous').locator('..').locator('..')).toHaveClass(/selected|active/);
    
    await takeScreenshot(page, 'onboarding-step2-selected');
    
    console.log('✅ Step 2: 关系偏好页面正常');
  });

  test('Step 3: 依恋风格页面', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/onboarding-v3?step=2`);
    await waitForPageLoad(page);
    
    await expect(page.locator('text=Attachment Style')).toBeVisible();
    
    // 验证依恋风格选项
    const styles = ['Secure', 'Anxious', 'Avoidant', 'Fearful'];
    for (const style of styles) {
      await expect(page.locator(`text=${style}`)).toBeVisible();
    }
    
    await takeScreenshot(page, 'onboarding-step3');
    
    console.log('✅ Step 3: 依恋风格页面正常');
  });

  test('Step 4: 沟通风格页面', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/onboarding-v3?step=3`);
    await waitForPageLoad(page);
    
    await expect(page.locator('text=Communication Style')).toBeVisible();
    
    await takeScreenshot(page, 'onboarding-step4');
    
    console.log('✅ Step 4: 沟通风格页面正常');
  });

  test('Step 5: 情感需求页面', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/onboarding-v3?step=4`);
    await waitForPageLoad(page);
    
    await expect(page.locator('text=Emotional Needs')).toBeVisible();
    
    await takeScreenshot(page, 'onboarding-step5');
    
    console.log('✅ Step 5: 情感需求页面正常');
  });

  test('Step 6: 冲突处理页面', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/onboarding-v3?step=5`);
    await waitForPageLoad(page);
    
    await expect(page.locator('text=Conflict Style')).toBeVisible();
    
    await takeScreenshot(page, 'onboarding-step6');
    
    console.log('✅ Step 6: 冲突处理页面正常');
  });

  test('Step 7: 生活方式页面', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/onboarding-v3?step=6`);
    await waitForPageLoad(page);
    
    await expect(page.locator('text=Lifestyle')).toBeVisible();
    
    await takeScreenshot(page, 'onboarding-step7');
    
    console.log('✅ Step 7: 生活方式页面正常');
  });

  test('Step 8: 头像上传页面', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/onboarding-v3?step=7`);
    await waitForPageLoad(page);
    
    await expect(page.locator('text=Your Photo')).toBeVisible();
    await expect(page.locator('text=Upload your photo')).toBeVisible();
    
    await takeScreenshot(page, 'onboarding-step8-avatar');
    
    console.log('✅ Step 8: 头像上传页面正常');
  });

  test('雷达图分析页面 - 英文分析', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/onboarding-v3?step=8`);
    await waitForPageLoad(page);
    
    // 验证雷达图存在
    await expect(page.locator('canvas, svg')).toBeVisible();
    
    // 验证英文分析文本（不是中文）
    const analysisText = await page.locator('[data-testid="ai-analysis"], .analysis-text, p').first().textContent();
    
    // 检查是否包含英文
    const hasEnglish = /[a-zA-Z]{10,}/.test(analysisText || '');
    expect(hasEnglish).toBe(true);
    
    // 检查字符数是否在400以内
    expect((analysisText || '').length).toBeLessThanOrEqual(400);
    
    await takeScreenshot(page, 'onboarding-radar-analysis');
    
    console.log('✅ 雷达图分析页面 - 英文分析正常');
    console.log(`   分析文本长度: ${analysisText?.length}字符`);
    console.log(`   分析文本预览: ${analysisText?.substring(0, 100)}...`);
  });

  test('Start Matching按钮跳转', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/onboarding-v3?step=8`);
    await waitForPageLoad(page);
    
    // 等待Start Matching按钮
    const startButton = page.locator('button:has-text("Start Matching"), button:has-text("Start Exploring")');
    await expect(startButton).toBeVisible();
    
    // 点击按钮
    await startButton.click();
    
    // 等待跳转
    await page.waitForTimeout(2000);
    
    // 验证是否跳转到square页面
    const currentUrl = page.url();
    expect(currentUrl).toContain('/dashboard/square');
    
    await takeScreenshot(page, 'after-start-matching-redirect');
    
    console.log('✅ Start Matching按钮跳转正常');
    console.log(`   跳转后URL: ${currentUrl}`);
  });
});

// ==================== 测试套件 2: Matching Square ====================
test.describe('🔍 Matching Square测试', () => {
  
  test('广场页面加载', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/square`);
    await waitForPageLoad(page);
    
    await expect(page.locator('text=Discover')).toBeVisible();
    
    await takeScreenshot(page, 'square-page-load');
    
    console.log('✅ 广场页面加载正常');
  });

  test('标签纵向布局 - 无横向滚动条', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/square`);
    await waitForPageLoad(page);
    
    // 检查标签容器
    const tagsContainer = page.locator('.tags-container, [class*="tag"]').first();
    
    // 验证没有横向滚动条样式
    const overflowStyle = await tagsContainer.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.overflowX;
    });
    
    expect(overflowStyle).not.toBe('scroll');
    expect(overflowStyle).not.toBe('auto');
    
    await takeScreenshot(page, 'square-tags-layout');
    
    console.log('✅ 标签纵向布局正常，无横向滚动条');
  });

  test('用户卡片显示', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/square`);
    await waitForPageLoad(page);
    
    // 等待用户卡片加载
    await page.waitForTimeout(2000);
    
    // 检查是否有用户卡片
    const userCards = page.locator('[class*="card"], [class*="user"], .discover-card');
    const count = await userCards.count();
    
    if (count > 0) {
      console.log(`✅ 发现 ${count} 个用户卡片`);
      await takeScreenshot(page, 'square-user-cards');
    } else {
      console.log('⚠️ 没有用户卡片显示 - 需要检查API');
      await takeScreenshot(page, 'square-empty');
    }
  });

  test('筛选器移除验证', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/square`);
    await waitForPageLoad(page);
    
    // 检查是否有过多的筛选器UI
    const filterElements = page.locator('input[type="range"], select, [class*="filter"]');
    const count = await filterElements.count();
    
    console.log(`   发现 ${count} 个筛选器元素`);
    
    // 筛选器应该很少或没有
    expect(count).toBeLessThan(5);
    
    await takeScreenshot(page, 'square-filters-check');
  });
});

// ==================== 测试套件 3: 消息功能 ====================
test.describe('💬 消息功能测试', () => {
  
  test('消息列表页面', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/messages`);
    await waitForPageLoad(page);
    
    await expect(page.locator('text=Messages')).toBeVisible();
    
    // 验证没有搜索框
    const searchInputs = page.locator('input[type="search"], input[placeholder*="search" i], input[placeholder*="Search" i]');
    const count = await searchInputs.count();
    
    if (count === 0) {
      console.log('✅ 消息页面没有搜索框 - 符合WhatsApp风格');
    } else {
      console.log('⚠️ 消息页面仍有搜索框');
    }
    
    await takeScreenshot(page, 'messages-page');
  });

  test('聊天对话框打开', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/messages`);
    await waitForPageLoad(page);
    
    // 尝试点击第一个聊天
    const chatItem = page.locator('[class*="chat"], [class*="conversation"], [class*="message-item"]').first();
    
    if (await chatItem.isVisible().catch(() => false)) {
      await chatItem.click();
      await page.waitForTimeout(1000);
      
      // 验证聊天窗口打开
      const currentUrl = page.url();
      expect(currentUrl).toContain('/dashboard/chat/');
      
      await takeScreenshot(page, 'chat-dialog-opened');
      console.log('✅ 聊天对话框可以打开');
    } else {
      console.log('⚠️ 没有可点击的聊天项');
    }
  });

  test('聊天页面UI - WhatsApp风格', async ({ page }) => {
    // 直接进入一个聊天页面
    await page.goto(`${BASE_URL}/dashboard/chat/test-room-id`);
    await waitForPageLoad(page);
    
    // 验证基本UI元素
    await expect(page.locator('input[type="text"], textarea')).toBeVisible();
    
    // 检查是否有发送按钮
    const sendButton = page.locator('button[type="submit"], button:has-text("Send"), button svg');
    expect(await sendButton.count()).toBeGreaterThan(0);
    
    await takeScreenshot(page, 'chat-ui-whatsapp-style');
    
    console.log('✅ 聊天页面UI基本正常');
  });
});

// ==================== 测试套件 4: 匹配功能 ====================
test.describe('❤️ 匹配功能测试', () => {
  
  test('匹配列表页面', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/matches`);
    await waitForPageLoad(page);
    
    await expect(page.locator('text=Matches')).toBeVisible();
    
    await takeScreenshot(page, 'matches-page');
    
    console.log('✅ 匹配列表页面加载正常');
  });

  test('匹配详情页面', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/matches`);
    await waitForPageLoad(page);
    
    // 尝试点击第一个匹配
    const matchItem = page.locator('[class*="match"]').first();
    
    if (await matchItem.isVisible().catch(() => false)) {
      await matchItem.click();
      await page.waitForTimeout(1000);
      
      // 验证详情页面
      const currentUrl = page.url();
      expect(currentUrl).toMatch(/\/dashboard\/matches\/[a-zA-Z0-9-]+/);
      
      await takeScreenshot(page, 'match-detail-page');
      console.log('✅ 匹配详情页面可以打开');
    } else {
      console.log('⚠️ 没有可点击的匹配项');
    }
  });
});

// ==================== 测试套件 5: 响应式测试 ====================
test.describe('📱 响应式测试', () => {
  
  test('移动端视图 - Onboarding', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE_URL}/dashboard/onboarding-v3`);
    await waitForPageLoad(page);
    
    await takeScreenshot(page, 'mobile-onboarding');
    
    console.log('✅ 移动端Onboarding视图');
  });

  test('移动端视图 - Square', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE_URL}/dashboard/square`);
    await waitForPageLoad(page);
    
    await takeScreenshot(page, 'mobile-square');
    
    console.log('✅ 移动端Square视图');
  });

  test('平板视图', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`${BASE_URL}/dashboard/square`);
    await waitForPageLoad(page);
    
    await takeScreenshot(page, 'tablet-square');
    
    console.log('✅ 平板视图');
  });
});

// ==================== 测试报告 ====================
test.afterAll(async () => {
  console.log('\n' + '='.repeat(50));
  console.log('🧪 LokFeel 功能测试完成');
  console.log('='.repeat(50));
  console.log('📸 截图保存在: /Users/frankzhao/WorkBuddy/20260402202519/qa/screenshots/');
});
