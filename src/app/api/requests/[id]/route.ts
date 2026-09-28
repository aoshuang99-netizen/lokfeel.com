import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";
import { createConversation } from "@/lib/im/queries";

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

    // 如果接受，创建会话（IM 终局模型为主，Legacy 为可选兼容副本）
    //
    // ⚠️ P1-6 阶段 5：本处原为**纯 Legacy 写入**（建房 + 成员 + 系统消息），
    //    IM 侧一行都没有。这比"裸写"更危险 —— 门禁的判据是
    //    「探测 ∧ **IM 承接** ∧ 标注」，只加探测不补 IM 写入会得到
    //    "删表后静默丢功能"：接口仍返回 200，但用户点进匹配看不到任何会话。
    //    因此本处**先补 IM 写入**（与 `/api/matches/react`、`/api/matches/[id]` 同规格），
    //    再把 Legacy 那一半降级为受探测保护的可选副本。
    if (action === "accept") {
      const matchMsg =
        "🎉 It's a match! You both liked each other. The Vault is open for 24 hours.";

      // ── IM 侧（终局模型）──
      let conversationId: string | null = null;
      try {
        const conv = await createConversation(
          match.senderId,
          match.receiverId,
          match.senderId,
          { matchId: match.id },
        );
        conversationId = conv.convId;

        // 开场系统消息只在会话还没有任何消息时写入 —— 避免重复接受同一请求导致刷屏
        const existingMsg = await prisma.iMMessage.findFirst({
          where: { conversationId: conv.convId },
          select: { id: true },
        });
        if (!existingMsg) {
          const last = await prisma.iMMessage.findFirst({
            where: { conversationId: conv.convId },
            orderBy: { seq: "desc" },
            select: { seq: true },
          });
          await prisma.iMMessage.create({
            data: {
              conversationId: conv.convId,
              senderId: match.senderId,
              receiverId: match.receiverId,
              seq: (last?.seq || 0) + 1,
              msgType: "SYSTEM",
              payload: matchMsg,
              encryptionMode: "SERVER",
              consentState: "CONSENT_NONE",
              mediaLevel: "L0_TEXT",
              ruleResult: "PASS",
            },
          });
          await prisma.conversation.update({
            where: { id: conv.convId },
            data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
          });
        }
      } catch (imErr) {
        // IM 已是主数据源 —— 建不成 Conversation 意味着用户看不到会话，必须可告警。
        console.error(
          "[Requests Accept] 🔴 IM 会话创建失败 —— 匹配已接受但用户可能看不到会话:",
          { matchId: match.id, error: imErr },
        );
      }

      return NextResponse.json({
        success: true,
        action: "accepted",
        match: updatedMatch,
        // chatId：Legacy 语义的字段名保留以兼容旧前端；阶段 5 后取 Conversation 的
        // 终局 id（`/api/im/conversations/[id]` 能解析，见 lib/im/resolve.ts）。
        chatId: conversationId,
        conversationId,
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
