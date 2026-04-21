/**
 * AI数字人自动化系统启动脚本
 * 直接在服务器端执行，绕过API认证
 */

import { db as prisma } from "@/lib/db";
import { 
  botNeuralNetwork, 
  batchAssignTagsToAllBots 
} from "@/lib/bot-automation";

async function main() {
  console.log("🤖 AI数字人自动化系统启动中...\n");

  try {
    // 1. 检查当前状态
    const totalBots = await prisma.botProfile.count();
    const activeBots = await prisma.botProfile.count({ where: { isActive: true } });
    
    console.log(`📊 当前状态:`);
    console.log(`   - 总数字人: ${totalBots}`);
    console.log(`   - 活跃数字人: ${activeBots}`);
    console.log();

    // 2. 分配标签
    console.log("🏷️  步骤1: 分配关系标签...");
    const tagResults = await batchAssignTagsToAllBots();
    console.log(`   ✅ 已为 ${tagResults.length} 个数字人分配标签\n`);

    // 3. 启动神经网络
    console.log("🧠 步骤2: 启动神经网络...");
    await botNeuralNetwork.start();
    console.log("   ✅ 神经网络已启动\n");

    // 4. 最终状态
    const finalActiveBots = await prisma.botProfile.count({ where: { isActive: true } });
    console.log("🎉 系统启动完成!");
    console.log(`   - 活跃数字人: ${finalActiveBots}`);
    console.log(`   - 系统状态: RUNNING`);
    console.log();
    console.log("📋 可用操作:");
    console.log("   - 查看状态: GET /api/bot-automation");
    console.log("   - 停止系统: POST /api/bot-automation { action: 'stop' }");
    console.log("   - 执行周期: POST /api/bot-automation { action: 'run-cycle' }");

  } catch (error) {
    console.error("❌ 启动失败:", error);
    process.exit(1);
  }
}

main();
