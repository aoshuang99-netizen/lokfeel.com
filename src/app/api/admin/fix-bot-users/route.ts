/**
 * Fix Bot Users API
 * 
 * 修复数字用户的onboardingStep字段
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ADMIN_KEY = process.env.ADMIN_KEY || "lokfeel-admin-2024";

export async function POST(req: NextRequest) {
  // Verify admin key
  const adminKey = req.headers.get("x-admin-key");
  if (adminKey !== ADMIN_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    message: "Bot users fix endpoint ready",
    note: "Use direct SQL or Prisma Studio to fix onboardingStep",
  });
}

export async function GET(req: NextRequest) {
  // Verify admin key
  const adminKey = req.headers.get("x-admin-key");
  if (adminKey !== ADMIN_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
}
