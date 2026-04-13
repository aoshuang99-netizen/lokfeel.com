import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { db as prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/privacy/screenshot-report
 * Logs screenshot attempts for security monitoring
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id || "anonymous";

    const body = await request.json();
    const { timestamp, pageUrl, userAgent } = body;

    // Log the incident (in production, you might want to store this in a separate table)
    console.warn("Screenshot attempt detected:", {
      userId,
      timestamp: timestamp || new Date().toISOString(),
      pageUrl,
      userAgent,
      ip: request.headers.get("x-forwarded-for") || "unknown",
    });

    // In a production environment, you might want to:
    // 1. Store this in a SecurityIncident table
    // 2. Send alert to admin if repeated attempts
    // 3. Rate limit or temporarily restrict user if abuse detected

    // For now, we just log and return success
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Screenshot report error:", error);
    return NextResponse.json(
      { error: "Failed to process report" },
      { status: 500 }
    );
  }
}
