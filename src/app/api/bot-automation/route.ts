/**
 * Bot Automation API
 * 
 * 用于管理和监控AI数字人自动化系统
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";
import { 
  botNeuralNetwork, 
  batchAssignTagsToAllBots,
  RELATIONSHIP_TAGS 
} from "@/lib/bot-automation";

export const dynamic = "force-dynamic";

/**
 * GET /api/bot-automation/status
 * 获取自动化系统状态
 * 支持两种方式认证：1) NextAuth session 2) Admin API Key
 */
export async function GET(request: NextRequest) {
  try {
    // 检查认证：session 或 admin key
    const session = await auth();
    const adminKey = request.headers.get("x-admin-key");
    const validAdminKey = process.env.ADMIN_API_KEY || "lokfeel-admin-2024";
    
    if (!session?.user?.id && adminKey !== validAdminKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 获取统计数据
    const totalBots = await prisma.botProfile.count();
    const activeBots = await prisma.botProfile.count({ where: { isActive: true } });
    const botsWithTags = await prisma.profile.count({
      where: {
        botProfile: { isNot: null },
        NOT: { relationshipGoal: undefined },
      },
    });

    const totalMatches = await prisma.match.count();
    const totalMessages = await prisma.message.count();

    const recentInteractions = await prisma.botInteractionLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return NextResponse.json({
      status: "active",
      stats: {
        totalBots,
        activeBots,
        botsWithTags,
        totalMatches,
        totalMessages,
        tagCoverage: totalBots > 0 ? Math.round((botsWithTags / totalBots) * 100) : 0,
      },
      recentInteractions,
      tags: RELATIONSHIP_TAGS,
    });
  } catch (error) {
    console.error("Bot automation status error:", error);
    return NextResponse.json(
      { error: "Failed to get status" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bot-automation
 * 执行自动化操作
 * 支持两种方式认证：1) NextAuth session 2) Admin API Key
 */
export async function POST(request: NextRequest) {
  try {
    // 检查认证：session 或 admin key
    const session = await auth();
    const adminKey = request.headers.get("x-admin-key");
    const validAdminKey = process.env.ADMIN_API_KEY || "lokfeel-admin-2024";
    
    if (!session?.user?.id && adminKey !== validAdminKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;

    switch (action) {
      case "start":
        await botNeuralNetwork.start();
        return NextResponse.json({ 
          success: true, 
          message: "Bot neural network started" 
        });

      case "stop":
        botNeuralNetwork.stop();
        return NextResponse.json({ 
          success: true, 
          message: "Bot neural network stopped" 
        });

      case "assign-tags":
        const tagResults = await batchAssignTagsToAllBots();
        return NextResponse.json({ 
          success: true, 
          message: `Assigned tags to ${tagResults.length} bots`,
          count: tagResults.length,
        });

      case "run-cycle":
        // 手动执行一个完整周期
        await botNeuralNetwork["executeCycle"]();
        return NextResponse.json({ 
          success: true, 
          message: "Cycle executed successfully" 
        });

      case "reset-learning":
        // 重置学习数据
        await prisma.botLearningRecord.deleteMany({});
        await prisma.botInteractionLog.deleteMany({});
        return NextResponse.json({ 
          success: true, 
          message: "Learning data reset" 
        });

      default:
        return NextResponse.json(
          { error: "Unknown action" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Bot automation action error:", error);
    return NextResponse.json(
      { error: "Failed to execute action", details: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
