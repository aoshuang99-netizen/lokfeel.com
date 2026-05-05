import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAnyPermission } from "@/lib/with-permission";

export const GET = withAnyPermission(["payment.view", "payment.subscription"])(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "20");
    const status = searchParams.get("status");
    const search = searchParams.get("search") || "";

    const where: any = {};
    if (status && status !== "all") {
      where.status = status as any;
    }
    if (search) {
      where.OR = [
        { user: { name: { contains: search } } },
        { user: { email: { contains: search } } },
        { stripeSubscriptionId: { contains: search } },
      ];
    }

    const [subscriptions, total] = await Promise.all([
      db.subscription.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.subscription.count({ where }),
    ]);

    const formattedSubscriptions = subscriptions.map((sub) => ({
      id: sub.id,
      userId: sub.userId,
      userName: sub.user?.name || sub.user?.email || "Unknown",
      plan: sub.plan || "FREE",
      status: sub.status,
      stripeCurrentPeriodEnd: sub.stripeCurrentPeriodEnd?.toISOString() || "",
      startsAt: sub.startsAt.toISOString(),
      endsAt: sub.endsAt?.toISOString() || "",
      isCancelled: !!sub.cancelledAt,
      cancelledAt: sub.cancelledAt?.toISOString() || "",
      stripeSubscriptionId: sub.stripeSubscriptionId || "",
      weeklyMatchLimit: sub.weeklyMatchLimit,
      canInitiateChat: sub.canInitiateChat,
      canViewFullProfile: sub.canViewFullProfile,
      createdAt: sub.createdAt.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      subscriptions: formattedSubscriptions,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("[Admin Subscriptions API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch subscriptions" },
      { status: 500 }
    );
  }
});

export const POST = withAnyPermission(["payment.subscription"])(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const { userId, plan, stripePriceId, stripeSubscriptionId, stripeCurrentPeriodEnd, endsAt } = body;

    if (!userId || !plan) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const subscription = await db.subscription.create({
      data: {
        userId,
        plan: plan as any,
        status: "ACTIVE",
        stripePriceId: stripePriceId || undefined,
        stripeSubscriptionId: stripeSubscriptionId || undefined,
        stripeCurrentPeriodEnd: stripeCurrentPeriodEnd ? new Date(stripeCurrentPeriodEnd) : undefined,
        startsAt: new Date(),
        endsAt: endsAt ? new Date(endsAt) : undefined,
      },
    });

    return NextResponse.json({
      success: true,
      subscription,
    });
  } catch (error) {
    console.error("[Admin Subscriptions API] Create error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create subscription" },
      { status: 500 }
    );
  }
});
