/**
 * Fix Bot Users API (Admin Tool)
 *
 * One-time utility to fix bot user onboardingStep fields.
 * Protected by RBAC + admin key dual auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/with-permission";

export const dynamic = "force-dynamic";

const ADMIN_KEY = process.env.ADMIN_KEY;

if (!ADMIN_KEY) {
  console.warn("[FixBotUsers] ADMIN_KEY not set — admin key verification disabled");
}

export const POST = withPermission('user.edit', { dangerous: true })(async (req: NextRequest) => {
  // Additional admin key verification for tool endpoints
  const adminKey = req.headers.get("x-admin-key");
  if (adminKey !== ADMIN_KEY) {
    return NextResponse.json({ error: "Admin key required" }, { status: 403 });
  }

  return NextResponse.json({
    success: true,
    message: "Bot users fix endpoint ready",
    note: "Use direct SQL or Prisma Studio to fix onboardingStep",
  });
});

export const GET = withPermission('user.view')(async (req: NextRequest) => {
  const adminKey = req.headers.get("x-admin-key");
  if (adminKey !== ADMIN_KEY) {
    return NextResponse.json({ error: "Admin key required" }, { status: 403 });
  }

  return NextResponse.json({
    message: "Use this SQL to fix bot users:",
    sql: `
      UPDATE "User"
      SET "onboardingStep" = 9, "profileStatus" = 'ACTIVE'
      WHERE "onboardingStep" < 4
      AND id IN (SELECT "userId" FROM "Profile");
    `,
    alternative: "Or use Prisma Studio: npx prisma studio",
  });
});
