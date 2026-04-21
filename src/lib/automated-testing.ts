/**
 * 自动化浏览器测试监控系统
 * 
 * 功能：
 * 1. 模拟真实用户登录
 * 2. 测试核心功能流程
 * 3. 自动发现问题并记录
 * 4. 生成报告通知产品/开发团队
 */

import { chromium, Browser, Page } from "playwright";
import { db as prisma } from "@/lib/db";

// 测试配置
const TEST_CONFIG = {
  baseUrl: process.env.NEXT_PUBLIC_APP_URL || "https://app.lokfeel.com",
  headless: true,
  timeout: 30000,
  viewport: { width: 1280, height: 720 },
};

// 测试结果类型
interface TestResult {
  testId: string;
  testName: string;
  status: "passed" | "failed" | "skipped";
  duration: number;
  error?: string;
  screenshot?: string;
  logs: string[];
  timestamp: Date;
}

// 测试套件
interface TestSuite {
  suiteId: string;
  suiteName: string;
  results: TestResult[];
  startTime: Date;
  endTime?: Date;
}

/**
 * 自动化测试运行器
 */
export class AutomatedTestRunner {
  private browser: Browser | null = null;
  private currentSuite: TestSuite | null = null;
  private results: TestSuite[] = [];

  /**
   * 初始化浏览器
   */
  async init() {
    console.log("[Test Runner] Initializing browser...");
    this.browser = await chromium.launch({
      headless: TEST_CONFIG.headless,
    });
    console.log("[Test Runner] Browser initialized");
  }

  /**
   * 关闭浏览器
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log("[Test Runner] Browser closed");
    }
  }

  /**
   * 创建新页面
   */
  private async createPage(): Promise<Page> {
    if (!this.browser) throw new Error("Browser not initialized");
    
    const context = await this.browser.newContext({
      viewport: TEST_CONFIG.viewport,
    });
    
    return context.newPage();
  }

  /**
   * 开始测试套件
   */
  startSuite(suiteName: string): TestSuite {
    const suite: TestSuite = {
      suiteId: `suite_${Date.now()}`,
      suiteName,
      results: [],
      startTime: new Date(),
    };
    
    this.currentSuite = suite;
    this.results.push(suite);
    
    console.log(`[Test Runner] Starting suite: ${suiteName}`);
    return suite;
  }

  /**
   * 结束测试套件
   */
  endSuite() {
    if (this.currentSuite) {
      this.currentSuite.endTime = new Date();
      console.log(`[Test Runner] Suite completed: ${this.currentSuite.suiteName}`);
      this.currentSuite = null;
    }
  }

  /**
   * 执行单个测试
   */
  private async runTest(
    testName: string,
    testFn: (page: Page) => Promise<void>
  ): Promise<TestResult> {
    const testId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    const logs: string[] = [];
    
    const result: TestResult = {
      testId,
      testName,
      status: "skipped",
      duration: 0,
      logs,
      timestamp: new Date(),
    };

    let page: Page | null = null;

    try {
      console.log(`[Test] Running: ${testName}`);
      page = await this.createPage();
      
      // 监听console日志
      page.on("console", (msg) => {
        logs.push(`[${msg.type()}] ${msg.text()}`);
      });

      // 执行测试
      await testFn(page);
      
      result.status = "passed";
      console.log(`[Test] ✓ Passed: ${testName}`);
    } catch (error) {
      result.status = "failed";
      result.error = error instanceof Error ? error.message : String(error);
      
      // 截图保存
      if (page) {
        const screenshotPath = `./test-screenshots/${testId}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        result.screenshot = screenshotPath;
      }
      
      console.error(`[Test] ✗ Failed: ${testName}`, result.error);
    } finally {
      result.duration = Date.now() - startTime;
      
      if (page) {
        await page.close();
      }
      
      // 添加到当前套件
      if (this.currentSuite) {
        this.currentSuite.results.push(result);
      }
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // 核心功能测试
  // ═══════════════════════════════════════════════════════════════

  /**
   * 测试1: 登录流程
   */
  async testLogin() {
    return this.runTest("Login Flow", async (page) => {
      // 获取测试用户
      const testUser = await prisma.user.findFirst({
        where: { email: { contains: "test" } },
        include: { profile: true },
      });

      if (!testUser) {
        throw new Error("No test user found");
      }

      // 导航到登录页
      await page.goto(`${TEST_CONFIG.baseUrl}/login`);
      
      // 等待页面加载
      await page.waitForSelector('input[type="email"]', { timeout: 10000 });
      
      // 填写登录表单
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', "testpassword123");
      
      // 点击登录按钮
      await page.click('button[type="submit"]');
      
      // 等待跳转
      await page.waitForURL(/\/dashboard/, { timeout: 15000 });
      
      // 验证登录成功
      const dashboardElement = await page.locator('text=Dashboard').first();
      if (!dashboardElement) {
        throw new Error("Dashboard not found after login");
      }
    });
  }

  /**
   * 测试2: Discover页面
   */
  async testDiscover() {
    return this.runTest("Discover Page", async (page) => {
      // 先登录
      await this.performLogin(page);
      
      // 导航到discover
      await page.goto(`${TEST_CONFIG.baseUrl}/dashboard/discover`);
      
      // 等待加载
      await page.waitForTimeout(3000);
      
      // 检查是否有用户卡片或空状态
      const hasCards = await page.locator('[data-testid="user-card"]').count() > 0;
      const hasEmptyState = await page.locator('text=No more profiles').count() > 0;
      const hasError = await page.locator('text=Failed to load').count() > 0;
      
      if (hasError) {
        throw new Error("Discover page shows error");
      }
      
      if (!hasCards && !hasEmptyState) {
        throw new Error("Discover page neither shows cards nor empty state");
      }
      
      console.log(`[Test] Discover: cards=${hasCards}, empty=${hasEmptyState}`);
    });
  }

  /**
   * 测试3: Matching Square
   */
  async testMatchingSquare() {
    return this.runTest("Matching Square", async (page) => {
      await this.performLogin(page);
      
      await page.goto(`${TEST_CONFIG.baseUrl}/dashboard/square`);
      await page.waitForTimeout(3000);
      
      // 检查页面元素
      const hasUsers = await page.locator('.glass-card').count() > 0;
      const hasEmpty = await page.locator('text=No users found').count() > 0;
      
      if (!hasUsers && !hasEmpty) {
        throw new Error("Matching Square not loading properly");
      }
    });
  }

  /**
   * 测试4: 消息功能
   */
  async testMessages() {
    return this.runTest("Messages Page", async (page) => {
      await this.performLogin(page);
      
      await page.goto(`${TEST_CONFIG.baseUrl}/dashboard/messages`);
      await page.waitForTimeout(3000);
      
      // 检查消息列表
      const hasMessages = await page.locator('text=Messages').count() > 0;
      
      if (!hasMessages) {
        throw new Error("Messages page not loading");
      }
    });
  }

  /**
   * 测试5: 聊天对话框
   */
  async testChatDialog() {
    return this.runTest("Chat Dialog", async (page) => {
      await this.performLogin(page);
      
      // 获取一个有聊天的用户
      const chatRoom = await prisma.chatRoom.findFirst({
        include: { messages: true },
      });
      
      if (!chatRoom) {
        console.log("[Test] No chat room found, skipping chat dialog test");
        return;
      }
      
      await page.goto(`${TEST_CONFIG.baseUrl}/dashboard/chat/${chatRoom.id}`);
      await page.waitForTimeout(3000);
      
      // 检查聊天界面
      const hasInput = await page.locator('input[placeholder*="message"], textarea').count() > 0;
      
      if (!hasInput) {
        throw new Error("Chat dialog not showing message input");
      }
    });
  }

  /**
   * 测试6: Onboarding流程
   */
  async testOnboarding() {
    return this.runTest("Onboarding Flow", async (page) => {
      await this.performLogin(page);
      
      await page.goto(`${TEST_CONFIG.baseUrl}/dashboard/onboarding`);
      await page.waitForTimeout(3000);
      
      // 检查onboarding步骤
      const hasStepIndicator = await page.locator('text=Step').count() > 0;
      const hasRadarChart = await page.locator('canvas, svg').count() > 0;
      
      if (!hasStepIndicator) {
        throw new Error("Onboarding step indicator not found");
      }
    });
  }

  /**
   * 测试7: 导航跳转
   */
  async testNavigation() {
    return this.runTest("Navigation Flow", async (page) => {
      await this.performLogin(page);
      
      // 测试各个页面的导航
      const pages = [
        '/dashboard',
        '/dashboard/discover',
        '/dashboard/square',
        '/dashboard/messages',
        '/dashboard/profile',
      ];
      
      for (const path of pages) {
        await page.goto(`${TEST_CONFIG.baseUrl}${path}`);
        await page.waitForTimeout(2000);
        
        // 检查是否有错误页面
        const hasError = await page.locator('text=404, text=Error, text=Failed').count() > 0;
        
        if (hasError) {
          throw new Error(`Navigation to ${path} failed`);
        }
      }
    });
  }

  /**
   * 辅助方法：执行登录
   */
  private async performLogin(page: Page) {
    const testUser = await prisma.user.findFirst({
      where: { email: { contains: "test" } },
    });

    if (!testUser) {
      throw new Error("No test user available");
    }

    await page.goto(`${TEST_CONFIG.baseUrl}/login`);
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.fill('input[type="email"]', testUser.email);
    await page.fill('input[type="password"]', "testpassword123");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  }

  // ═══════════════════════════════════════════════════════════════
  // 报告生成
  // ═══════════════════════════════════════════════════════════════

  /**
   * 生成测试报告
   */
  generateReport(): string {
    const report: string[] = [];
    
    report.push("# LokFeel 自动化测试报告\n");
    report.push(`生成时间: ${new Date().toLocaleString()}\n`);
    report.push(`测试环境: ${TEST_CONFIG.baseUrl}\n\n`);
    
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    
    for (const suite of this.results) {
      report.push(`## ${suite.suiteName}\n`);
      report.push(`开始时间: ${suite.startTime.toLocaleString()}\n`);
      report.push(`结束时间: ${suite.endTime?.toLocaleString() || "N/A"}\n\n`);
      
      report.push("| 测试 | 状态 | 耗时 | 错误 |\n");
      report.push("|------|------|------|------|\n");
      
      for (const result of suite.results) {
        totalTests++;
        if (result.status === "passed") passedTests++;
        if (result.status === "failed") failedTests++;
        
        const statusEmoji = result.status === "passed" ? "✅" : result.status === "failed" ? "❌" : "⏭️";
        const error = result.error ? result.error.substring(0, 50) + "..." : "-";
        
        report.push(`| ${result.testName} | ${statusEmoji} ${result.status} | ${result.duration}ms | ${error} |\n`);
      }
      
      report.push("\n");
    }
    
    // 汇总
    report.push("## 汇总\n\n");
    report.push(`- 总测试数: ${totalTests}\n`);
    report.push(`- 通过: ${passedTests} (${Math.round((passedTests / totalTests) * 100)}%)\n`);
    report.push(`- 失败: ${failedTests} (${Math.round((failedTests / totalTests) * 100)}%)\n\n`);
    
    // 失败详情
    const failedResults = this.results
      .flatMap(s => s.results)
      .filter(r => r.status === "failed");
    
    if (failedResults.length > 0) {
      report.push("## 失败详情\n\n");
      
      for (const result of failedResults) {
        report.push(`### ${result.testName}\n\n`);
        report.push(`错误: ${result.error}\n\n`);
        report.push(`截图: ${result.screenshot || "N/A"}\n\n`);
        
        if (result.logs.length > 0) {
          report.push("日志:\n");
          report.push("```\n");
          report.push(result.logs.join("\n"));
          report.push("\n```\n\n");
        }
      }
    }
    
    return report.join("");
  }

  /**
   * 保存报告到文件
   */
  async saveReport(filename?: string) {
    const report = this.generateReport();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filepath = filename || `./test-reports/automated-test-report-${timestamp}.md`;
    
    const fs = require("fs");
    const path = require("path");
    
    // 确保目录存在
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filepath, report);
    console.log(`[Test Runner] Report saved to ${filepath}`);
    
    return filepath;
  }

  /**
   * 保存测试结果到数据库
   */
  async saveResultsToDB() {
    for (const suite of this.results) {
      for (const result of suite.results) {
        await prisma.botInteractionLog.create({
          data: {
            botUserId: "system_test_runner",
            interactionType: "automated_test",
            action: result.status,
            outcome: result.status === "passed" ? "success" : "failed",
            context: JSON.stringify({
              testName: result.testName,
              duration: result.duration,
              error: result.error,
              logs: result.logs,
            }),
          },
        });
      }
    }
    
    console.log("[Test Runner] Results saved to database");
  }
}

/**
 * 运行完整测试套件
 */
export async function runFullTestSuite() {
  const runner = new AutomatedTestRunner();
  
  try {
    await runner.init();
    
    // 开始测试套件
    runner.startSuite("Core Functionality Tests");
    
    // 运行所有测试
    await runner.testLogin();
    await runner.testDiscover();
    await runner.testMatchingSquare();
    await runner.testMessages();
    await runner.testChatDialog();
    await runner.testOnboarding();
    await runner.testNavigation();
    
    runner.endSuite();
    
    // 生成并保存报告
    const reportPath = await runner.saveReport();
    await runner.saveResultsToDB();
    
    console.log("[Test Runner] Full test suite completed");
    console.log(`[Test Runner] Report: ${reportPath}`);
    
    return {
      success: true,
      reportPath,
    };
  } catch (error) {
    console.error("[Test Runner] Test suite failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await runner.close();
  }
}


