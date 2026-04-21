import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * PUT /api/requests/[id]
 * 处理连接请求（接受或拒绝）- 仅女性用户
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await req.json();
    const { action } = body;

    if (!action || (action !== "accept" && action !== "decline")) {
      return NextResponse.json(
        { error: "Invalid action. Must be 'accept' or 'decline'" },
        { status: 400 }
      );
    }

    // 查找匹配记录 - 使用senderId/receiverId
    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!match) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    // 验证权限（只有接收者可以接受/拒绝）
    if (match.receiverId !== userId) {
      return NextResponse.json(
        { error: "You can only respond to requests sent to you" },
        { status: 403 }
      );
    }

    // 验证当前状态
    if (match.status !== "PENDING") {
      return NextResponse.json(
        { error: `Request already ${match.status.toLowerCase()}` },
        { status: 400 }
      );
    }

    // 更新匹配状态
    const updatedMatch = await prisma.match.update({
      where: { id },
      data: {
        status: action === "accept" ? "ACCEPTED" : "REJECTED",
        receiverAction: action === "accept" ? "INTERESTED" : "PASS",
      },
    });

    // 如果接受，创建聊天室
    if (action === "accept") {
      // 检查是否已存在聊天室
      const existingChatRoom = await prisma.chatRoom.findFirst({
        where: {
          matchId: match.id,
        },
      });

      let chatRoomId = existingChatRoom?.id;

      if (!existingChatRoom) {
        // 创建新聊天室
        const newChatRoom = await prisma.chatRoom.create({
          data: {
            matchId: match.id,
            vaultExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24小时Vault
          },
        });
        chatRoomId = newChatRoom.id;

        // 添加成员
        await prisma.chatRoomMember.createMany({
          data: [
            { roomId: chatRoomId, userId: match.senderId },
            { roomId: chatRoomId, userId: match.receiverId },
          ],
        });
      }

      // 创建系统消息
      await prisma.message.create({
        data: {
          roomId: chatRoomId!,
          senderId: match.senderId,
          content: `🎉 It's a match! You both liked each other. The Vault is open for 24 hours.`,
          messageType: "SYSTEM",
        },
      });

      return NextResponse.json({
        success: true,
        action: "accepted",
        match: updatedMatch,
        chatId: chatRoomId,
        message: "Request accepted! You can now chat.",
      });
    }

    // 拒绝
    return NextResponse.json({
      success: true,
      action: "declined",
      match: updatedMatch,
      message: "Request declined",
    });

  } catch (error) {
    console.error("Request handling error:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/requests/[id]
 * 获取单个请求详情
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { id } = await params;

    const match = await prisma.match.findUnique({
      where: { id },
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
                bio: true,
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
                bio: true,
              },
            },
          },
        },
      },
    });

    if (!match) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    // 验证权限
    if (match.senderId !== userId && match.receiverId !== userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    return NextResponse.json({ match });

  } catch (error) {
    console.error("Get request error:", error);
    return NextResponse.json(
      { error: "Failed to fetch request" },
      { status: 500 }
    );
  }
}
