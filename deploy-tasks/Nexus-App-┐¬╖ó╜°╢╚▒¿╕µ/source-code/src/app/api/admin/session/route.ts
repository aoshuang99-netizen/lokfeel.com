import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";

export async function GET(request: NextRequest) {
  // Get cookie from request headers (most reliable method)
  const cookieHeader = request.headers.get("cookie");
  
  if (!cookieHeader) {
    return NextResponse.json({
      success: false,
      user: null,
      debug: "No cookie header"
    });
  }

  // Parse cookie header
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k, decodeURIComponent(v.join("="))];
    })
  );

  const adminSessionCookie = cookies["admin_session"];

  if (!adminSessionCookie) {
    return NextResponse.json({
      success: false,
      user: null,
      debug: "No admin_session cookie"
    });
  }

  try {
    const decoded = Buffer.from(adminSessionCookie, "base64").toString();
    const session = JSON.parse(decoded);

    // Check expiration
    if (session.exp < Date.now()) {
      return NextResponse.json({
        success: false,
        user: null,
        debug: "Session expired"
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
      debug: "Parse error"
    });
  }
}
