import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { db as prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || "https://app.lokfeel.com/api/auth/linkedin/callback";

/**
 * GET /api/auth/linkedin
 * Initiates LinkedIn OAuth flow
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!LINKEDIN_CLIENT_ID) {
      return NextResponse.json(
        { error: "LinkedIn OAuth not configured" },
        { status: 500 }
      );
    }

    // Generate state parameter for security
    const state = Buffer.from(
      JSON.stringify({ userId: session.user.id, nonce: Math.random().toString(36) })
    ).toString("base64");

    // Build LinkedIn OAuth URL
    const params = new URLSearchParams({
      response_type: "code",
      client_id: LINKEDIN_CLIENT_ID,
      redirect_uri: LINKEDIN_REDIRECT_URI,
      state: state,
      scope: "openid profile email r_basicprofile",
    });

    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;

    return NextResponse.json({ authUrl, state });
  } catch (error) {
    console.error("LinkedIn auth error:", error);
    return NextResponse.json(
      { error: "Failed to initiate LinkedIn OAuth" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/linkedin/callback
 * Handles LinkedIn OAuth callback
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { code, state } = await request.json();

    if (!code) {
      return NextResponse.json({ error: "Authorization code required" }, { status: 400 });
    }

    if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
      return NextResponse.json(
        { error: "LinkedIn OAuth not configured" },
        { status: 500 }
      );
    }

    // Exchange code for access token
    const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
        redirect_uri: LINKEDIN_REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error("LinkedIn token error:", error);
      return NextResponse.json(
        { error: "Failed to exchange authorization code" },
        { status: 400 }
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Fetch user profile from LinkedIn
    const profileResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch LinkedIn profile" },
        { status: 400 }
      );
    }

    const linkedInProfile = await profileResponse.json();

    // Fetch additional profile data (headline, industry)
    const basicProfileResponse = await fetch(
      "https://api.linkedin.com/v2/me?projection=(id,headline,industryName,positions(view:(title,company)))",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    let headline = "";
    let industry = "";
    let company = "";

    if (basicProfileResponse.ok) {
      const basicProfile = await basicProfileResponse.json();
      headline = basicProfile.headline || "";
      industry = basicProfile.industryName || "";
      if (basicProfile.positions?.elements?.length > 0) {
        const position = basicProfile.positions.elements[0];
        company = position.company?.name || "";
      }
    }

    // Extract occupation from headline (typically "Role at Company")
    const occupation = headline.split(" at ")[0] || headline;

    // Update user profile
    await (prisma as any).profile.update({
      where: { userId: session.user.id },
      data: {
        linkedInVerified: true,
        verificationBadge: true,
        occupation: occupation || undefined,
        industry: industry || undefined,
        company: company || undefined,
      },
    });

    return NextResponse.json({
      success: true,
      profile: {
        linkedInVerified: true,
        occupation,
        industry,
        company,
      },
    });
  } catch (error) {
    console.error("LinkedIn callback error:", error);
    return NextResponse.json(
      { error: "Failed to complete LinkedIn verification" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/auth/linkedin
 * Disconnect LinkedIn verification
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await (prisma as any).profile.update({
      where: { userId: session.user.id },
      data: {
        linkedInVerified: false,
        verificationBadge: false,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("LinkedIn disconnect error:", error);
    return NextResponse.json(
      { error: "Failed to disconnect LinkedIn" },
      { status: 500 }
    );
  }
}
