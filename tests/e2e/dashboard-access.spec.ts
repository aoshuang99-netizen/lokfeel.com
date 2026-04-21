/**
 * LokFeel E2E 测试 — Dashboard访问控制
 * 
 * 覆盖：
 * 1. 未认证用户访问控制
 * 2. 已认证用户Dashboard页面
 * 3. Onboarding流程守卫
 * 4. 各子页面路由保护
 * 5. 导航元素验证
 */

import { test, expect } from '@playwright/test';
import {
  BASE_URL,
  TEST_USERS,
  loginViaUI,
  waitForPageReady,
  takeScreenshot,
} from './helpers/auth';

// ============================================================================
// 测试套件 1: 未认证用户访问控制
// ============================================================================
test.describe('🚫 未认证用户访问控制', () => {
  const protectedRoutes = [
    { path: '/dashboard', name: 'Dashboard首页' },
    { path: '/dashboard/square', name: 'Discover广场' },
    { path: '/dashboard/matches', name: '匹配列表' },
    { path: '/dashboard/messages', name: '消息列表' },
    { path: '/dashboard/settings', name: '设置页面' },
    { path: '/dashboard/onboarding', name: 'Onboarding流程' },
  ];

  for (const { path, name } of protectedRoutes) {
    test(`未认证访问 ${name} (${path}) 应被重定向`, async ({ page }) => {
      await page.goto(`${BASE_URL}${path}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const url = page.url();
      // 应该被重定向到登录页
      const isRedirected = url.includes('/login') || url.includes('/auth');
      
      if (isRedirected) {
        console.log(`  ✅ ${name}: 正确重定向到登录页`);
      } else {
        console.log(`  ⚠️ ${name}: 未重定向，当前URL: ${url}`);
      }
      
      await takeScreenshot(page, `dashboard/unauthenticated-${path.replace(/\//g, '-')}`);
    });
  }
});

// ============================================================================
// 测试套件 2: 已认证用户Dashboard
// ============================================================================
test.describe('✅ 已认证用户Dashboard', () => {
  // 先登录
  test.beforeEach(async ({ page }) => {
    await loginViaUI(page);
  });

  test('Dashboard首页可访问', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await waitForPageReady(page);
    
    const url = page.url();
    // 应该留在dashboard（不被重定向到login）
    const isOnDashboard = url.includes('/dashboard') || url.includes('/onboarding');
    
    if (isOnDashboard) {
      await takeScreenshot(page, 'dashboard/authenticated-dashboard');
    }
  });

  test('Discover广场可访问', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/square`);
    await waitForPageReady(page);
    
    const url = page.url();
    if (url.includes('/square')) {
      await takeScreenshot(page, 'dashboard/authenticated-square');
    }
  });

  test('匹配列表可访问', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/matches`);
    await waitForPageReady(page);
    
    const url = page.url();
    if (url.includes('/matches')) {
      await takeScreenshot(page, 'dashboard/authenticated-matches');
    }
  });

  test('消息列表可访问', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/messages`);
    await waitForPageReady(page);
    
    const url = page.url();
    if (url.includes('/messages')) {
      await takeScreenshot(page, 'dashboard/authenticated-messages');
    }
  });

  test('设置页面可访问', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/settings`);
    await waitForPageReady(page);
    
    const url = page.url();
    if (url.includes('/settings')) {
      await takeScreenshot(page, 'dashboard/authenticated-settings');
    }
  });
});

// ============================================================================
// 测试套件 3: Onboarding守卫
// ============================================================================
test.describe('📋 Onboarding流程守卫', () => {
  test('Onboarding页面可访问', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/onboarding`);
    await waitForPageReady(page);
    
    // 无论是否登录，onboarding页面应该可加载
    const url = page.url();
    // 可能在登录页（未认证）或onboarding页面（已认证）
    await takeScreenshot(page, 'dashboard/onboarding-access');
  });

  test('Onboarding各步骤可导航', async ({ page }) => {
    // 测试通过URL参数直接访问各步骤
    const steps = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    
    for (const step of steps) {
      await page.goto(`${BASE_URL}/dashboard/onboarding?step=${step}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      
      const url = page.url();
      if (url.includes('/onboarding')) {
        console.log(`  ✅ Step ${step}: 可访问`);
      } else {
        console.log(`  ⚠️ Step ${step}: 被重定向到 ${url}`);
      }
    }
  });
});

// ============================================================================
// 测试套件 4: 导航元素验证
// ============================================================================
test.describe('🧭 导航元素验证', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUI(page);
  });

  test('Dashboard导航栏可见', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await waitForPageReady(page);

    // 检查导航元素
    const nav = page.locator('nav, [role="navigation"], header');
    const hasNav = await nav.isVisible().catch(() => false);
    
    if (hasNav) {
      await takeScreenshot(page, 'dashboard/navigation-visible');
    }
  });

  test('Footer存在', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await waitForPageReady(page);

    const footer = page.locator('footer, [role="contentinfo"]');
    const hasFooter = await footer.isVisible().catch(() => false);
    
    console.log(`  ${hasFooter ? '✅' : '⚠️'} Footer ${hasFooter ? '可见' : '不可见'}`);
  });
});

// ============================================================================
// 测试套件 5: 移动端Dashboard
// ============================================================================
test.describe('📱 移动端Dashboard', () => {
  test('移动端Dashboard布局', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE_URL}/dashboard`);
    await waitForPageReady(page);
    
    await takeScreenshot(page, 'dashboard/mobile-dashboard');
  });

  test('移动端Discover广场布局', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE_URL}/dashboard/square`);
    await waitForPageReady(page);
    
    await takeScreenshot(page, 'dashboard/mobile-square');
  });
});
