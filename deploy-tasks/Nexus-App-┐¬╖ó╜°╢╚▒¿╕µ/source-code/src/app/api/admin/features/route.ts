export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/with-permission";
import { success, badRequest, serverError } from "@/lib/api-response";
import { auditSystemChange } from "@/lib/admin-audit";

// 功能开关定义
export interface Feature {
  id: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  category: string;
  lastModified: string;
  modifiedBy?: string;
}

// 内存中的功能配置（生产环境应存储在数据库）
let features: Feature[] = [
  { id: "1", code: "MATCHING_ENABLED", name: "匹配功能", description: "启用/禁用用户匹配功能", enabled: true, category: "core", lastModified: new Date().toISOString() },
  { id: "2", code: "CHAT_ENABLED", name: "聊天功能", description: "启用/禁用即时聊天功能", enabled: true, category: "core", lastModified: new Date().toISOString() },
  { id: "3", code: "PREMIUM_SUBSCRIPTION", name: "高级订阅", description: "启用/禁用高级订阅功能", enabled: true, category: "monetization", lastModified: new Date().toISOString() },
  { id: "4", code: "WEEKLY_MATCHES", name: "每周匹配", description: "启用/禁用每周推荐匹配", enabled: true, category: "matching", lastModified: new Date().toISOString() },
  { id: "5", code: "AI_SUGGESTIONS", name: "AI推荐", description: "启用/禁用AI驱动的匹配推荐", enabled: true, category: "ai", lastModified: new Date().toISOString() },
  { id: "6", code: "EMAIL_VERIFICATION", name: "邮箱验证", description: "新用户注册需要邮箱验证", enabled: true, category: "security", lastModified: new Date().toISOString() },
  { id: "7", code: "TWO_FACTOR_AUTH", name: "双因素认证", description: "启用/禁用双因素认证", enabled: false, category: "security", lastModified: new Date().toISOString() },
  { id: "8", code: "REFERRAL_PROGRAM", name: "推荐奖励", description: "启用/禁用用户推荐奖励计划", enabled: true, category: "growth", lastModified: new Date().toISOString() },
  { id: "9", code: "PUSH_NOTIFICATIONS", name: "推送通知", description: "启用/禁用移动端推送通知", enabled: true, category: "engagement", lastModified: new Date().toISOString() },
  { id: "10", code: "IN_APP_MESSAGING", name: "应用内消息", description: "启用/禁用系统公告和应用内消息", enabled: true, category: "engagement", lastModified: new Date().toISOString() },
  { id: "11", code: "ANALYTICS_DASHBOARD", name: "数据分析面板", description: "启用/禁用用户数据分析面板", enabled: true, category: "analytics", lastModified: new Date().toISOString() },
  { id: "12", code: "MATCH_EXPLANATIONS", name: "匹配解释", description: "显示匹配兼容性详细解释", enabled: true, category: "matching", lastModified: new Date().toISOString() },
  { id: "13", code: "ONLINE_STATUS", name: "在线状态", description: "显示用户在线/离线状态", enabled: true, category: "social", lastModified: new Date().toISOString() },
  { id: "14", code: "STORY_FEATURES", name: "故事功能", description: "启用/禁用24小时阅后即焚故事", enabled: false, category: "social", lastModified: new Date().toISOString() },
  { id: "15", code: "VIDEO_CALLS", name: "视频通话", description: "启用/禁用一对一视频通话", enabled: false, category: "premium", lastModified: new Date().toISOString() },
  { id: "16", code: "VOICE_MESSAGES", name: "语音消息", description: "启用/禁用语音消息功能", enabled: true, category: "core", lastModified: new Date().toISOString() },
  { id: "17", code: "LOCATION_BASED", name: "位置匹配", description: "基于地理位置的用户推荐", enabled: true, category: "matching", lastModified: new Date().toISOString() },
  { id: "18", code: "BOT_DETECTION", name: "机器人检测", description: "启用/禁用自动机器人账号检测", enabled: true, category: "security", lastModified: new Date().toISOString() },
  { id: "19", code: "CONTENT_MODERATION", name: "内容审核", description: "启用/禁用AI内容审核", enabled: true, category: "safety", lastModified: new Date().toISOString() },
  { id: "20", code: "REPORTING_SYSTEM", name: "举报系统", description: "启用/禁用用户举报功能", enabled: true, category: "safety", lastModified: new Date().toISOString() },
];

// 分类配置
const categories = [
  { id: "core", name: "核心功能", icon: "⚙️" },
  { id: "matching", name: "匹配相关", icon: "💕" },
  { id: "ai", name: "AI功能", icon: "🤖" },
  { id: "security", name: "安全设置", icon: "🔒" },
  { id: "monetization", name: "商业化", icon: "💰" },
  { id: "growth", name: "增长功能", icon: "📈" },
  { id: "engagement", name: "用户互动", icon: "📱" },
  { id: "analytics", name: "数据分析", icon: "📊" },
  { id: "social", name: "社交功能", icon: "👥" },
  { id: "premium", name: "高级功能", icon: "✨" },
  { id: "safety", name: "安全审核", icon: "🛡️" },
];

/**
 * GET /api/admin/features
 * 获取所有功能开关
 */
export const GET = withPermission('system.config.view')(async () => {
  try {
    // 按分类组织功能
    const groupedFeatures = categories.map(cat => ({
      ...cat,
      features: features.filter(f => f.category === cat.id),
      enabledCount: features.filter(f => f.category === cat.id && f.enabled).length,
      totalCount: features.filter(f => f.category === cat.id).length,
    })).filter(cat => cat.features.length > 0);

    return success({
      features,
      categories: groupedFeatures,
      stats: {
        total: features.length,
        enabled: features.filter(f => f.enabled).length,
        disabled: features.filter(f => !f.enabled).length,
      },
    });
  } catch (error) {
    console.error("Features GET error:", error);
    return serverError("获取功能列表失败");
  }
});

/**
 * PUT /api/admin/features
 * 更新功能开关状态
 */
export const PUT = withPermission('system.config.edit', { dangerous: true })(async (request: NextRequest, { userId: adminId }) => {
  try {
    const body = await request.json();
    const { featureId, enabled } = body;

    if (!featureId || enabled === undefined) {
      return badRequest("缺少必要参数: featureId 和 enabled");
    }

    const featureIndex = features.findIndex(f => f.id === featureId);
    if (featureIndex === -1) {
      return badRequest("功能不存在");
    }

    const oldFeature = features[featureIndex];
    features[featureIndex] = {
      ...oldFeature,
      enabled,
      lastModified: new Date().toISOString(),
      modifiedBy: adminId,
    };

    // 记录审计日志
    await auditSystemChange(
      adminId,
      "feature.toggle",
      featureId,
      {
        feature: oldFeature.name,
        code: oldFeature.code,
        before: oldFeature.enabled,
        after: enabled,
      },
      undefined,
      request
    );

    return success(features[featureIndex]);
  } catch (error) {
    console.error("Features PUT error:", error);
    return serverError("更新功能状态失败");
  }
});

/**
 * POST /api/admin/features
 * 批量更新功能开关
 */
export const POST = withPermission('system.config.edit', { dangerous: true })(async (request: NextRequest, { userId: adminId }) => {
  try {
    const body = await request.json();
    const { updates } = body;

    if (!updates || !Array.isArray(updates)) {
      return badRequest("缺少必要参数: updates (数组)");
    }

    const results: Feature[] = [];
    for (const update of updates) {
      const { featureId, enabled } = update;
      const featureIndex = features.findIndex(f => f.id === featureId);
      if (featureIndex !== -1) {
        features[featureIndex] = {
          ...features[featureIndex],
          enabled,
          lastModified: new Date().toISOString(),
          modifiedBy: adminId,
        };
        results.push(features[featureIndex]);
      }
    }

    return success({
      updated: results,
      count: results.length,
    });
  } catch (error) {
    console.error("Features POST error:", error);
    return serverError("批量更新功能状态失败");
  }
});
