/**
 * Fix Onboarding Step API (Admin Tool)
 *
 * One-time utility to fix user onboardingStep fields.
 * Protected by RBAC + admin key dual auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withPermission } from "@/lib/with-permission";

// C-03 fix: Use lazy Proxy `db` instead of module-level `getDb()` to avoid cold-start crash

export const dynamic = "force-dynamic";

const ADMIN_KEY = process.env.ADMIN_KEY;

if (!ADMIN_KEY) {
  console.warn("[FixOnboarding] ADMIN_KEY not set — admin key verification disabled");
}

export const POST = withPermission('user.edit', { dangerous: true })(async (req: NextRequest) => {
  // Additional admin key verification for tool endpoints
  const adminKey = req.headers.get("x-admin-key");
  if (adminKey !== ADMIN_KEY) {
    return NextResponse.json({ error: "Admin key required" }, { status: 403 });
  }

  try {
    // Find profiles with low onboardingStep (lt 9 to catch step 8 users)
    const profilesToFix = await db.profile.findMany({
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
    const profileUpdate = await db.profile.updateMany({
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
});

export const GET = withPermission('user.view')(async (req: NextRequest) => {
  const adminKey = req.headers.get("x-admin-key");
  if (adminKey !== ADMIN_KEY) {
    return NextResponse.json({ error: "Admin key required" }, { status: 403 });
  }

  try {
    // Count profiles by onboardingStep
    // NOTE: Using findMany+distinct instead of groupBy (Turso/libSQL incompatible)
    const stepProfiles = await db.profile.findMany({
      select: { onboardingStep: true },
      distinct: ['onboardingStep'],
    });
    const stepStats = await Promise.all(
      stepProfiles.map(async (p: any) => {
        const count = await db.profile.count({
          where: { onboardingStep: p.onboardingStep },
        });
        return { onboardingStep: p.onboardingStep, _count: { id: count } };
      })
    );

    // Count profiles needing fix
    const needsFix = await db.profile.count({
      where: {
        onboardingStep: { lt: 9 },
      },
    });

    // Total profiles
    const totalProfiles = await db.profile.count();

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
});
