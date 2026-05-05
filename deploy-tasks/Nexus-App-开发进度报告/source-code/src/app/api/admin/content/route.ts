import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/with-permission";
import { promises as fs } from "fs";
import path from "path";

const CONTENT_DIR = path.join(process.cwd(), "content");

// Ensure content directory exists
async function ensureContentDir() {
  try {
    await fs.access(CONTENT_DIR);
  } catch {
    await fs.mkdir(CONTENT_DIR, { recursive: true });
  }
}

// Get all content items
export const GET = withPermission('content.report.view')(async (request: NextRequest, { userId }) => {
  
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get("type"); // 'page' | 'template' | null
  
  try {
    const items = [
      {
        id: "about",
        title: "About Page",
        type: "page",
        status: "published",
        lastUpdated: "2024-03-15T10:00:00Z",
        description: "About page content",
      },
      {
        id: "privacy",
        title: "Privacy Policy",
        type: "page",
        status: "published",
        lastUpdated: "2024-03-10T10:00:00Z",
        description: "Privacy policy content",
      },
      {
        id: "terms",
        title: "Terms of Service",
        type: "page",
        status: "published",
        lastUpdated: "2024-03-10T10:00:00Z",
        description: "Terms of service content",
      },
      {
        id: "cookies",
        title: "Cookie Policy",
        type: "page",
        status: "draft",
        lastUpdated: "2024-02-20T10:00:00Z",
        description: "Cookie policy content",
      },
      {
        id: "welcome",
        title: "Welcome Email",
        type: "template",
        status: "published",
        lastUpdated: "2024-03-15T10:00:00Z",
        description: "Sent when users create an account",
      },
      {
        id: "verification",
        title: "Email Verification",
        type: "template",
        status: "published",
        lastUpdated: "2024-03-15T10:00:00Z",
        description: "Sent when users need to verify email",
      },
      {
        id: "match-notification",
        title: "New Match Notification",
        type: "template",
        status: "published",
        lastUpdated: "2024-03-15T10:00:00Z",
        description: "Sent when user gets a new match",
      },
      {
        id: "message-notification",
        title: "New Message Notification",
        type: "template",
        status: "published",
        lastUpdated: "2024-03-15T10:00:00Z",
        description: "Sent when user receives a message",
      },
      {
        id: "subscription",
        title: "Subscription Confirmation",
        type: "template",
        status: "published",
        lastUpdated: "2024-03-15T10:00:00Z",
        description: "Sent when user subscribes to Premium",
      },
    ];

    // ������ɸѡ
    const filtered = type ? items.filter((item) => item.type === type) : items;

    return NextResponse.json({ success: true, data: filtered });
  } catch (error) {
    console.error("Error fetching content:", error);
    return NextResponse.json(
      { error: "Failed to fetch content" },
      { status: 500 }
    );
  }
});

// Get content
export const PUT = withPermission('content.rule', { dangerous: true })(async (request: NextRequest, { userId: adminId }) => {
  await ensureContentDir();
  
  try {
    const body = await request.json();
    const { id, title, content, status } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Content ID is required" },
        { status: 400 }
      );
    }

    // Here content should be saved to database or file system
    // Simplified: just mock success
    console.log(`Saving content ${id}:`, { title, status });

    return NextResponse.json({
      success: true,
      data: {
        id,
        title,
        status,
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error updating content:", error);
    return NextResponse.json(
      { error: "Failed to update content" },
      { status: 500 }
    );
  }
});

// Update content
export const POST = withPermission('content.rule', { dangerous: true })(async (request: NextRequest, { userId: adminId }) => {
  await ensureContentDir();
  
  try {
    const body = await request.json();
    const { action, ids } = body;

    if (!action || !ids || !Array.isArray(ids)) {
      return NextResponse.json(
        { error: "Invalid request" },
        { status: 400 }
      );
    }

    console.log(`Batch action ${action} for items:`, ids);

    // Mock batch operation
    switch (action) {
      case "publish":
      case "draft":
      case "delete":
        return NextResponse.json({ success: true, message: `Batch ${action} completed` });
      default:
        return NextResponse.json(
          { error: "Unknown action" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Error in batch operation:", error);
    return NextResponse.json(
      { error: "Failed to perform batch operation" },
      { status: 500 }
    );
  }
});

// Batch operations