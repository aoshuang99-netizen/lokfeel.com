import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request);

    if (!session) {
      return NextResponse.json({
        success: false,
        user: null,
      });
    }

    return NextResponse.json({
      success: true,
      user: {
        username: session.username || session.email || "Admin",
        role: session.role,
      },
    });
  } catch {
    return NextResponse.json({
      success: false,
      user: null,
    });
  }
}
