import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withPermission } from "@/lib/with-permission";

export const GET = withPermission(["SUPER_ADMIN", "ADMIN", "MODERATOR"], async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "20");
    const status = searchParams.get("status");
    const search = searchParams.get("search") || "";

    const where: any = {};
    if (status && status !== "all") {
      where.status = status;
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
      plan: sub.plan || "basic",
      status: sub.status,
      amount: sub.amount || 0,
      currency: sub.currency || "USD",
      currentPeriodStart: sub.currentPeriodStart?.toISOString() || "",
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() || "",
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd || false,
      stripeSubscriptionId: sub.stripeSubscriptionId || "",
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

export const POST = withPermission(["SUPER_ADMIN", "ADMIN"], async (request: NextRequest) => {
  try {
    const body = await request.json();
    const { userId, plan, amount, currency, interval } = body;

    if (!userId || !plan) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const subscription = await db.subscription.create({
      data: {
        userId,
        plan,
        amount: amount || 0,
        currency: currency || "USD",
        interval: interval || "month",
        status: "active",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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
