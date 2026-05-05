export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/with-permission";
import { success, badRequest, serverError } from "@/lib/api-response";
import { auditSystemChange } from "@/lib/admin-audit";

// 营销活动类型
interface Campaign {
  id: string;
  code: string;
  name: string;
  description: string;
  type: "promo_code" | "discount" | "bundle" | "referral" | "seasonal";
  status: "draft" | "active" | "paused" | "expired";
  discount?: {
    type: "percentage" | "fixed";
    value: number;
    minPurchase?: number;
  };
  startDate: string;
  endDate: string;
  targetAudience?: string;
  usageLimit?: number;
  usedCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// 内存中的活动配置
let campaigns: Campaign[] = [
  {
    id: "1",
    code: "WELCOME50",
    name: "新用户欢迎优惠",
    description: "新注册用户首月高级功能5折优惠",
    type: "discount",
    status: "active",
    discount: { type: "percentage", value: 50 },
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    targetAudience: "new_users",
    usageLimit: 1000,
    usedCount: 234,
    createdBy: "system",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    id: "2",
    code: "REFER10",
    name: "推荐奖励",
    description: "推荐好友成功注册，双方各获得10美元代金券",
    type: "referral",
    status: "active",
    discount: { type: "fixed", value: 10 },
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    targetAudience: "all_users",
    usageLimit: 5000,
    usedCount: 891,
    createdBy: "system",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-04-15T00:00:00Z",
  },
  {
    id: "3",
    code: "SUMMER30",
    name: "夏季特惠",
    description: "夏季限时高级订阅30%折扣",
    type: "seasonal",
    status: "paused",
    discount: { type: "percentage", value: 30 },
    startDate: "2026-06-01",
    endDate: "2026-08-31",
    targetAudience: "all_users",
    usageLimit: 2000,
    usedCount: 0,
    createdBy: "admin",
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    id: "4",
    code: "BUNDLE_PREMIUM",
    name: "高级年付套餐",
    description: "年付高级订阅额外赠送3个月",
    type: "bundle",
    status: "active",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    targetAudience: "all_users",
    usedCount: 156,
    createdBy: "system",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
  },
  {
    id: "5",
    code: "VALENTINE25",
    name: "情人节特惠",
    description: "情人节期间订阅25%折扣",
    type: "seasonal",
    status: "expired",
    discount: { type: "percentage", value: 25 },
    startDate: "2026-02-01",
    endDate: "2026-02-28",
    targetAudience: "all_users",
    usageLimit: 500,
    usedCount: 412,
    createdBy: "admin",
    createdAt: "2026-01-15T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
  },
];

// 获取统计数据
function getStats() {
  const now = new Date();
  return {
    total: campaigns.length,
    active: campaigns.filter(c => c.status === "active" && new Date(c.startDate) <= now && new Date(c.endDate) >= now).length,
    paused: campaigns.filter(c => c.status === "paused").length,
    expired: campaigns.filter(c => c.status === "expired" || new Date(c.endDate) < now).length,
    draft: campaigns.filter(c => c.status === "draft").length,
    totalUsage: campaigns.reduce((sum, c) => sum + c.usedCount, 0),
  };
}

/**
 * GET /api/admin/marketing
 * 获取营销活动列表
 */
export const GET = withPermission('marketing.view')(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const type = searchParams.get("type");

    let filtered = campaigns;

    if (status && status !== "all") {
      if (status === "active") {
        const now = new Date();
        filtered = filtered.filter(c =>
          c.status === "active" &&
          new Date(c.startDate) <= now &&
          new Date(c.endDate) >= now
        );
      } else if (status === "expired") {
        filtered = filtered.filter(c =>
          c.status === "expired" ||
          new Date(c.endDate) < new Date()
        );
      } else {
        filtered = filtered.filter(c => c.status === status);
      }
    }

    if (type && type !== "all") {
      filtered = filtered.filter(c => c.type === type);
    }

    return success({
      campaigns: filtered,
      stats: getStats(),
    });
  } catch (error) {
    console.error("Marketing GET error:", error);
    return serverError("获取营销活动列表失败");
  }
});

/**
 * POST /api/admin/marketing
 * 创建新营销活动
 */
export const POST = withPermission('marketing.edit', { dangerous: true })(async (request: NextRequest, { userId: adminId }) => {
  try {
    const body = await request.json();
    const { code, name, description, type, status, discount, startDate, endDate, targetAudience, usageLimit } = body;

    if (!code || !name || !type) {
      return badRequest("缺少必要参数: code, name, type");
    }

    // 检查代码是否已存在
    if (campaigns.some(c => c.code === code)) {
      return badRequest("优惠码已存在");
    }

    const newCampaign: Campaign = {
      id: Date.now().toString(),
      code,
      name,
      description: description || "",
      type,
      status: status || "draft",
      discount,
      startDate: startDate || new Date().toISOString().split("T")[0],
      endDate: endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      targetAudience: targetAudience || "all_users",
      usageLimit,
      usedCount: 0,
      createdBy: adminId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    campaigns.push(newCampaign);

    await auditSystemChange(
      adminId,
      "marketing.create",
      newCampaign.id,
      { campaign: newCampaign } as any, // Cast to any to fix type error
      undefined,
      request
    );

    return success(newCampaign, undefined, 201);
  } catch (error) {
    console.error("Marketing POST error:", error);
    return serverError("创建营销活动失败");
  }
});

/**
 * PUT /api/admin/marketing
 * 更新营销活动
 */
export const PUT = withPermission('marketing.edit', { dangerous: true })(async (request: NextRequest, { userId: adminId }) => {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return badRequest("缺少活动ID");
    }

    const index = campaigns.findIndex(c => c.id === id);
    if (index === -1) {
      return badRequest("营销活动不存在");
    }

    const oldCampaign = campaigns[index];
    campaigns[index] = {
      ...oldCampaign,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await auditSystemChange(
      adminId,
      "marketing.update",
      id,
      { before: oldCampaign, after: campaigns[index] } as any, // Cast to any
      undefined,
      request
    );

    return success(campaigns[index]);
  } catch (error) {
    console.error("Marketing PUT error:", error);
    return serverError("更新营销活动失败");
  }
});

/**
 * DELETE /api/admin/marketing
 * 删除营销活动
 */
export const DELETE = withPermission('marketing.delete', { dangerous: true })(async (request: NextRequest, { userId: adminId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return badRequest("缺少活动ID");
    }

    const index = campaigns.findIndex(c => c.id === id);
    if (index === -1) {
      return badRequest("营销活动不存在");
    }

    const deleted = campaigns.splice(index, 1)[0];

    await auditSystemChange(
      adminId,
      "marketing.delete",
      id,
      { campaign: deleted } as any, // Cast to any
      undefined,
      request
    );

    return success({ message: "营销活动已删除" });
  } catch (error) {
    console.error("Marketing DELETE error:", error);
    return serverError("删除营销活动失败");
  }
});
