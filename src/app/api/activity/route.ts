import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/activity
 * 获取用户活动记录（收到的喜欢、匹配、浏览等）
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // 获取用户性别
    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { gender: true },
    });

    const isFemale = profile?.gender?.toLowerCase() === "female" ||
      profile?.gender?.toLowerCase() === "woman";

    // 获取收到的喜欢/请求（使用senderId/receiverId）
    const receivedMatches = await prisma.match.findMany({
      where: {
        receiverId: userId,
        ...(isFemale ? {} : { status: "PENDING" }),
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            profile: {
              select: {
                age: true,
                avatar: true,
                city: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // 获取匹配记录
    const matches = await prisma.match.findMany({
      where: {
        OR: [
          { senderId: userId, status: "ACCEPTED" },
          { receiverId: userId, status: "ACCEPTED" },
        ],
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            profile: {
              select: {
                age: true,
                avatar: true,
                city: true,
              },
            },
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            profile: {
              select: {
                age: true,
                avatar: true,
                city: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    // 构建活动列表
    const activities = [];

    // 添加收到的喜欢/请求
    for (const match of receivedMatches) {
      activities.push({
        id: `match_${match.id}`,
        type: isFemale ? "request" : "like_received",
        user: {
          id: match.sender.id,
          name: match.sender.name || "Someone",
          age: match.sender.profile?.age || 0,
          avatar: match.sender.profile?.avatar || null,
        },
        timestamp: match.createdAt.toISOString(),
        read: !match.isUnread,
        requestStatus: match.status === "PENDING" ? "pending" :
          match.status === "ACCEPTED" ? "accepted" : "declined",
        matchScore: match.matchScore || 0,
        matchId: match.id,
      });
    }

    // 添加匹配记录
    for (const match of matches) {
      const otherUser = match.senderId === userId ? match.receiver : match.sender;
      activities.push({
        id: `match_${match.id}_accepted`,
        type: "match",
        user: {
          id: otherUser.id,
          name: otherUser.name || "Someone",
          age: otherUser.profile?.age || 0,
          avatar: otherUser.profile?.avatar || null,
        },
        timestamp: match.updatedAt.toISOString(),
        read: true,
        matchScore: match.matchScore || 0,
        matchId: match.id,
      });
    }

    // 按时间排序
    activities.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // 统计
    const stats = {
      newLikes: activities.filter(a => a.type === "like_received" || a.type === "request").length,
      matches: activities.filter(a => a.type === "match").length,
      unread: activities.filter(a => !a.read).length,
    };

    return NextResponse.json({
      activities: activities.slice(0, 50),
      stats,
    });

  } catch (error) {
    console.error("Activity API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch activity" },
      { status: 500 }
    );
  }
}
