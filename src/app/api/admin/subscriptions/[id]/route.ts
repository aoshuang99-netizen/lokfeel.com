import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/with-permission";
import { prisma } from "@/lib/prisma";
import { createSubscriptionRefundHandler } from "@/lib/stripe/refund-route";

// GET /api/admin/subscriptions/[id] - Get subscription details
export const GET = withPermission("payment.view")(async (request: NextRequest, context: any) => {
  try {
    const { id } = await context.params;

    // Get subscription from database
    const subscription = await prisma.subscription.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (!subscription) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    return NextResponse.json({ subscription });
  } catch (error) {
    console.error("Get subscription error:", error);
    return NextResponse.json({ error: "Failed to get subscription" }, { status: 500 });
  }
});

// POST /api/admin/subscriptions/[id] - Process refund
// 与 /refund 路由共用同一份实现（逻辑见 @/lib/stripe/refund.ts）。
export const POST = createSubscriptionRefundHandler();
