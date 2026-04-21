/**
 * LokFeel E2E 测试 - 认证辅助工具
 * 
 * 提供登录、注册、登出等常用操作的封装函数，
 * 避免在每个测试文件中重复编写认证逻辑。
 */

import { Page, expect } from '@playwright/test';

// 测试用户凭证 — 使用生产环境中已注册的用户
// 如需修改，请在此处统一更新
export const TEST_USERS = {
  existing: {
    email: 'test@example.com',
    password: 'Test123!',
  },
  // 新注册测试用户（每次运行使用随机后缀避免冲突）
  newRegistration: () => ({
    name: 'E2E Test User',
    email: `e2e-test-${Date.now()}@example.com`,
    password: 'E2eTest123!',
    gender: 'woman',
    sexuality: 'straight',
  }),
};

// 基础URL
export const BASE_URL = process.env.E2E_BASE_URL || 'https://app.lokfeel.com';

/**
 * 通过UI完成登录流程
 */
export async function loginViaUI(
  page: Page,
  email: string = TEST_USERS.existing.email,
  password: string = TEST_USERS.existing.password
): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');

  // 填写邮箱
  const emailInput = page.locator('#login-email');
  await emailInput.fill(email);

  // 填写密码
  const passwordInput = page.locator('#login-password');
  await passwordInput.fill(password);

  // 点击登录按钮
  const submitButton = page.locator('button[type="submit"]');
  await submitButton.click();

  // 等待页面跳转（登录成功后会跳转到dashboard或callbackUrl）
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30000 }).catch(() => {
    // 如果没跳转，可能是登录失败了，检查是否有错误信息
  });
}

/**
 * 通过UI完成注册流程（仅到发送验证码步骤）
 * 注意：完整注册需要验证码，E2E测试中验证码会通过API返回
 */
export async function registerViaUI(
  page: Page,
  userData: {
    name: string;
    email: string;
    password: string;
    gender: string;
    sexuality: string;
  }
): Promise<{ verificationCode?: string }> {
  await page.goto(`${BASE_URL}/register`);
  await page.waitForLoadState('networkidle');

  // 填写表单
  await page.locator('#reg-name').fill(userData.name);
  await page.locator('#reg-email').fill(userData.email);
  await page.locator('#reg-gender').selectOption(userData.gender);
  await page.locator('#reg-sexuality').selectOption(userData.sexuality);
  await page.locator('#reg-password').fill(userData.password);
  await page.locator('#reg-confirm-pwd').fill(userData.password);

  // 勾选同意条款
  await page.locator('#agreeToTerms').check();

  // 拦截注册API请求以获取验证码
  let verificationCode: string | undefined;
  const registerPromise = page.waitForResponse(
    (resp) => resp.url().includes('/api/auth/register') && resp.status() === 200
  );

  // 点击发送验证码
  await page.locator('button[type="submit"]').click();

  // 从API响应中获取验证码
  try {
    const response = await registerPromise;
    const data = await response.json();
    verificationCode = data.code;
  } catch {
    // 如果无法获取验证码，测试会在验证步骤跳过
  }

  return { verificationCode };
}

/**
 * 完成验证码输入并创建账户
 */
export async function verifyAndCreateAccount(
  page: Page,
  code: string
): Promise<void> {
  // 输入6位验证码
  const digits = code.split('');
  for (let i = 0; i < 6 && i < digits.length; i++) {
    await page.locator(`#code-${i}`).fill(digits[i]);
  }

  // 点击验证并创建账户
  await page.locator('button:has-text("Verify & Create")').click();

  // 等待跳转
  await page.waitForURL(/\/(dashboard|onboarding|login)/, { timeout: 30000 });
}

/**
 * 通过UI完成登出
 */
export async function logoutViaUI(page: Page): Promise<void> {
  // 访问API登出端点
  await page.goto(`${BASE_URL}/api/auth/signout`);
  
  // 确认登出（NextAuth的signout页面可能需要确认）
  const confirmButton = page.locator('button:has-text("Sign out")');
  if (await confirmButton.isVisible().catch(() => false)) {
    await confirmButton.click();
  }

  // 等待跳转到登录页
  await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {
    // 可能已经跳转到首页
  });
}

/**
 * 验证用户已登录（检查dashboard可访问性）
 */
export async function verifyLoggedIn(page: Page): Promise<boolean> {
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle');
  const url = page.url();
  return url.includes('/dashboard') && !url.includes('/login');
}

/**
 * 验证用户未登录（应被重定向到登录页）
 */
export async function verifyLoggedOut(page: Page): Promise<boolean> {
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle');
  const url = page.url();
  return url.includes('/login');
}

/**
 * 等待页面加载完成
 */
export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500); // 额外等待确保JS执行完毕
}

/**
 * 截图辅助
 */
export async function takeScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: `test-results/artifacts/${name}.png`,
    fullPage: true,
  });
}
