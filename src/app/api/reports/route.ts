import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { getDb } from "@/lib/db";
import { z } from "zod";

const reportSchema = z.object({
  reportedUserId: z.string(),
  reason: z.enum([
    "INAPPROPRIATE_CONTENT",
    "HARASSMENT",
    "FAKE_PROFILE",
    "SPAM",
    "OFFENSIVE_BEHAVIOR",
    "OTHER"
  ]),
  description: z.string().max(500).optional(),
  chatRoomId: z.string().optional(),
  messageId: z.string().optional(),
});

// POST /api/reports - Create a new report
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const validated = reportSchema.parse(body);

    // Prevent self-reporting
    if (validated.reportedUserId === session.user.id) {
      return NextResponse.json(
        { error: "Cannot report yourself" },
        { status: 400 }
      );
    }

    const db = getDb();

    // Check if reported user exists
    const reportedUser = await db.user.findUnique({
      where: { id: validated.reportedUserId },
      select: { id: true },
    });

    if (!reportedUser) {
      return NextResponse.json(
        { error: "Reported user not found" },
        { status: 404 }
      );
    }

    // Check for duplicate reports within 24 hours
    const existingReport = await db.userReport.findFirst({
      where: {
        reporterId: session.user.id,
        reportedUserId: validated.reportedUserId,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    if (existingReport) {
      return NextResponse.json(
        { error: "You have already reported this user recently" },
        { status: 429 }
      );
    }

    // Create the report
    const report = await db.userReport.create({
      data: {
        reporterId: session.user.id,
        reportedUserId: validated.reportedUserId,
        reason: validated.reason,
        description: validated.description,
        chatRoomId: validated.chatRoomId,
        messageId: validated.messageId,
        status: "PENDING",
      },
    });

    // Log for admin review (in production, send to admin dashboard or Slack)
    console.log(`[REPORT] New report created:`, {
      reportId: report.id,
      reporterId: session.user.id,
      reportedUserId: validated.reportedUserId,
      reason: validated.reason,
    });

    return NextResponse.json({
      success: true,
      reportId: report.id,
      message: "Report submitted successfully. Thank you for helping keep our community safe.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Report creation error:", error);
    return NextResponse.json(
      { error: "Failed to submit report" },
      { status: 500 }
    );
  }
}

// GET /api/reports - Get user's reports (for admin or user to see their own)
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");

    // Regular users can only see reports they made
    if (type === "my-reports") {
      const db = getDb();
      const reports = await db.userReport.findMany({
        where: { reporterId: session.user.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          reportedUser: {
            select: {
              name: true,
              image: true,
            },
          },
        },
      });

      return NextResponse.json({ reports });
    }

    // TODO: Add admin check for viewing all reports
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Get reports error:", error);
    return NextResponse.json(
      { error: "Failed to fetch reports" },
      { status: 500 }
    );
  }
}
