/**
 * Fix Onboarding Step API
 * 
 * 修复数字用户的onboardingStep字段
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const prisma = getDb();

export const dynamic = "force-dynamic";

const ADMIN_KEY = process.env.ADMIN_KEY || "lokfeel-admin-2024";

export async function POST(req: NextRequest) {
  const adminKey = req.headers.get("x-admin-key");
  if (adminKey !== ADMIN_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find profiles with low onboardingStep (lt 9 to catch step 8 users)
    const profilesToFix = await prisma.profile.findMany({
      where: {
        onboardingStep: {
          lt: 9,
        },
      },
      select: {
        id: true,
        userId: true,
        onboardingStep: true,
      },
      take: 5000,
    });

    console.log(`[FixOnboarding] Found ${profilesToFix.length} profiles to fix`);

    if (profilesToFix.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No profiles need fixing",
        fixed: 0,
      });
    }

    // Update profiles
    const profileUpdate = await prisma.profile.updateMany({
      where: {
        id: { in: profilesToFix.map(p => p.id) },
      },
      data: {
        onboardingStep: 9,
        profileStatus: "APPROVED",
        isApproved: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Fixed ${profileUpdate.count} profiles`,
      fixed: profileUpdate.count,
      sample: profilesToFix.slice(0, 5).map(p => ({ id: p.id, userId: p.userId })),
    });
  } catch (error) {
    console.error("[FixOnboarding] Error:", error);
    return NextResponse.json(
      { error: "Failed to fix profiles", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const adminKey = req.headers.get("x-admin-key");
  if (adminKey !== ADMIN_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Count profiles by onboardingStep
    const stepStats = await prisma.profile.groupBy({
      by: ["onboardingStep"],
      _count: {
        id: true,
      },
    });

    // Count profiles needing fix
    const needsFix = await prisma.profile.count({
      where: {
        onboardingStep: { lt: 9 },
      },
    });

    // Total profiles
    const totalProfiles = await prisma.profile.count();

    return NextResponse.json({
      totalProfiles,
      needsFix,
      stepDistribution: stepStats,
    });
  } catch (error) {
    console.error("[FixOnboarding] Error:", error);
    return NextResponse.json(
      { error: "Failed to get stats", details: String(error) },
      { status: 500 }
    );
  }
}
