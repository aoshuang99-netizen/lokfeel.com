import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/users/[userId]
 * 
 * 获取用户详细信息（用于资料页展示）
 * 返回用户基本信息和完整 profile
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await params;

    if (!userId) {
      return NextResponse.json({ error: "User ID required" }, { status: 400 });
    }

    // 获取目标用户详情
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: {
          select: {
            id: true,
            displayName: true,
            age: true,
            avatar: true,
            avatarType: true,
            city: true,
            bio: true,
            relationshipGoal: true,
            attachmentStyle: true,
            communicationStyle: true,
            loveLanguage: true,
            conflictResolution: true,
            emotionalAvailability: true,
            interests: true,
            selectedTags: true,
            profileStatus: true,
            onboardingStep: true,
            gallery: true,
            gender: true,
            lookingFor: true,
            education: true,
            occupation: true,
            height: true,
            drinking: true,
            smoking: true,
            kids: true,
            pets: true,
            languages: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // 检查当前用户是否已经和该用户有 match
    const existingMatch = await prisma.match.findFirst({
      where: {
        OR: [
          { senderId: session.user.id, receiverId: userId },
          { senderId: userId, receiverId: session.user.id },
        ],
      },
    });

    // 检查当前用户是否已经有 reaction
    const existingReaction = existingMatch
      ? await prisma.matchReaction.findUnique({
          where: {
            userId_matchId: {
              userId: session.user.id,
              matchId: existingMatch.id,
            },
          },
        })
      : null;

    // 构建响应
    const userDetail = {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      isBot: user.isBot || false,
      createdAt: user.createdAt,
      profile: user.profile,
      matchStatus: existingMatch ? existingMatch.status : null,
      myReaction: existingReaction?.reaction || null,
      matchId: existingMatch?.id || null,
    };

    return NextResponse.json({ user: userDetail });
  } catch (error) {
    console.error("[API /users/[userId]] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch user details" },
      { status: 500 }
    );
  }
}
