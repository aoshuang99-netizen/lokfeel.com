/**
 * Automated Test API
 * 
 * 触发自动化测试并获取结果
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";
import { runFullTestSuite } from "@/lib/automated-testing";

export const dynamic = "force-dynamic";

/**
 * GET /api/automated-test
 * 获取最近的测试结果
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 获取最近的测试结果
    const recentTests = await prisma.botInteractionLog.findMany({
      where: {
        interactionType: "automated_test",
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    // 统计
    const passed = recentTests.filter(t => t.action === "passed").length;
    const failed = recentTests.filter(t => t.action === "failed").length;

    return NextResponse.json({
      recentTests,
      summary: {
        total: recentTests.length,
        passed,
        failed,
        passRate: recentTests.length > 0 ? Math.round((passed / recentTests.length) * 100) : 0,
      },
    });
  } catch (error) {
    console.error("Automated test API error:", error);
    return NextResponse.json(
      { error: "Failed to get test results" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/automated-test
 * 触发新的测试运行
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;

    if (action === "run") {
      // 在后台运行测试
      // 注意：实际生产环境应该使用队列系统
      const result = await runFullTestSuite();
      
      return NextResponse.json({
        success: result.success,
        message: result.success ? "Test suite completed" : "Test suite failed",
        reportPath: result.reportPath,
        error: result.error,
      });
    }

    return NextResponse.json(
      { error: "Unknown action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Automated test trigger error:", error);
    return NextResponse.json(
      { error: "Failed to run tests", details: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
