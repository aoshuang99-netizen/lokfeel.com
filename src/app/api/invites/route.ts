import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// In-memory store for invite codes (until DB schema is updated)
const inviteCodeStore = new Map<string, string>();
const inviteStatsStore = new Map<string, { count: number; rewards: number }>();

/**
 * GET /api/invites
 * 
 * Get user's invite stats and history
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Generate invite code if not exists
    let inviteCode = inviteCodeStore.get(userId);
    if (!inviteCode) {
      inviteCode = generateInviteCode();
      inviteCodeStore.set(userId, inviteCode);
      inviteStatsStore.set(userId, { count: 0, rewards: 0 });
    }

    const stats = inviteStatsStore.get(userId) || { count: 0, rewards: 0 };

    return NextResponse.json({
      inviteCode,
      inviteCount: stats.count,
      inviteRewards: stats.rewards,
      invites: [], // TODO: Add invite history when schema is ready
      rewards: {
        perInvite: 50, // Points per successful invite
        maxInvites: 10, // Max invites for rewards
      },
    });
  } catch (error) {
    console.error("Get invites error:", error);
    return NextResponse.json(
      { error: "Failed to load invites" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/invites/verify
 * 
 * Verify and apply invite code during registration
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code } = body;

    if (!code) {
      return NextResponse.json(
        { error: "Invite code is required" },
        { status: 400 }
      );
    }

    // Find inviter by looking up in memory store
    const normalizedCode = code.toUpperCase();
    let inviterId: string | null = null;
    
    for (const [userId, storedCode] of inviteCodeStore.entries()) {
      if (storedCode === normalizedCode) {
        inviterId = userId;
        break;
      }
    }

    if (!inviterId) {
      return NextResponse.json(
        { error: "Invalid invite code" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      valid: true,
      inviterId,
    });
  } catch (error) {
    console.error("Verify invite error:", error);
    return NextResponse.json(
      { error: "Failed to verify invite code" },
      { status: 500 }
    );
  }
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
