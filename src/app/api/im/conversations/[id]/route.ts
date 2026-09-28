/**
 * ✅ [P1-6 阶段 4 — TARGET/KEEP] 会话详情 + 标记已读。
 *
 * 背景（阶段 4 的核心缺口）：
 *
 *   `page-content.tsx` 原本用 `/api/chat/${roomId}` 读会话头信息。该端点属 Legacy 侧，
 *   且当 id 是 Conversation.id 时会 404，于是前端写了三级回退（先 /api/chat → 再
 *   拉全量 /api/im/conversations 遍历查找 → 最后从消息里反推对方信息）。这种回退链
 *   有真实的正确性问题：**用会话列表第 51 条之后的会话打开详情，第 2 级回退恒失败**
 *   （列表接口 take:50），最后只能靠消息反推，过程还会有头像/在线状态缺失。
 *
 *   本端点把解析收敛为一处：`resolveConversationRef()` 同时接受 Conversation.id 与
 *   ChatRoom.id，因此前端**不需要知道 id 属于哪套系统**，也无需回退链。
 *
 * 与 `/api/im/messages/[conversationId]` 的分工：
 *   本端点返回"会话级"信息（对方资料、Vault、匹配分、统一 conversationId）；
 *   消息列表由 `/api/im/messages/*` 负责。前端先调本端点拿到 conversationId，再拉消息。
 *
 * @module api/im/conversations/[id]
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveConversationRef } from "@/lib/im/resolve";

export const dynamic = "force-dynamic";

/** 单次标记已读时最多处理的入站消息数（防止超大会话产生无界事务） */
const MARK_READ_BATCH_LIMIT = 200;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id } = await params;

    const ref = await resolveConversationRef(id, userId);
    if (!ref) {
      // 刻意不区分"不存在"与"无权访问"，避免泄露会话 id 的存在性
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // ── 对方资料 ──
    const other = await db.user.findFirst({
      where: { id: ref.otherUserId },
      select: {
        id: true,
        name: true,
        image: true,
        isBot: true,
        profile: { select: { displayName: true, age: true, avatar: true } },
      },
    });

    // ── Vault 与匹配分 ──
    // 阶段 5 之后 Vault 与 matchId 全部来自 Conversation 自身列（G-1 迁移后的唯一来源）。
    const [conv, presence] = await Promise.all([
      db.conversation.findFirst({
        where: { id: ref.conversationId },
        select: {
          id: true,
          matchId: true,
          vaultExpiresAt: true,
          vaultStatus: true,
          extensionCount: true,
          revokedAt: true,
          state: true,
          controllingUserId: true,
        },
      }),
      db.userPresence.findFirst({
        where: { userId: ref.otherUserId },
        select: { status: true, lastSeenAt: true },
      }),
    ]);

    const vaultExpiry: Date | null = conv?.vaultExpiresAt ?? null;
    const isVault = !!(vaultExpiry && vaultExpiry.getTime() > Date.now());
    const vaultStatus = conv?.vaultStatus ?? undefined;
    const vaultExtensionCount = conv?.extensionCount ?? 0;
    const vaultRevokedAt = conv?.revokedAt ?? null;

    // matchScore：Conversation 只存 matchId（G-10），匹配分按需查一次 Match
    const matchScore = conv?.matchId
      ? ((await db.match.findUnique({ where: { id: conv.matchId }, select: { matchScore: true } }))
          ?.matchScore ?? undefined)
      : undefined;

    return NextResponse.json({
      // 统一引用：前端拿 conversationId 即可稳定走 IM 数据通路
      conversationId: ref.conversationId,
      chatRoomId: ref.chatRoomId,
      id: ref.conversationId,
      /** 入口 id 的形状：conversation | chatRoomAlias | chatRoom。仅用于排障与埋点 */
      resolvedFrom: ref.resolvedFrom,
      /** ChatRoom 行此刻是否可读。阶段 5 之后恒为 false（前端可据此隐藏 Legacy-only 入口） */
      legacyRoomAvailable: ref.legacyRoomAvailable,
      matchId: conv?.matchId ?? null,
      matchScore,
      isVault,
      vaultExpiresAt: vaultExpiry ? vaultExpiry.toISOString() : undefined,
      vaultStatus,
      vaultExtensionCount,
      vaultRevokedAt: vaultRevokedAt ? vaultRevokedAt.toISOString() : undefined,
      state: conv?.state ?? undefined,
      controllingUserId: conv?.controllingUserId ?? undefined,
      otherUser: {
        id: other?.id ?? ref.otherUserId,
        name: other?.profile?.displayName || other?.name || "Unknown",
        age: other?.profile?.age ?? undefined,
        avatar: other?.profile?.avatar || other?.image || null,
        isBot: other?.isBot ?? false,
        isOnline: presence?.status === "ONLINE",
        lastSeen: presence?.lastSeenAt ? presence.lastSeenAt.toISOString() : undefined,
      },
    });
  } catch (error) {
    console.error("[IM] Get conversation detail error:", error);
    return NextResponse.json(
      { error: "Failed to get conversation" },
      { status: 500 }
    );
  }
}

/**
 * POST — 标记会话已读。
 *
 * 为什么需要它：改造前的聊天详情页**从不标记已读**，因此会话列表的未读徽章会一直累积
 * 不复位（用户打开会话后未读数不动）。阶段 4 的验收项包含"未读"，必须补齐这个动作。
 *
 * 语义：把这**之前**所有入站消息记为已读，并复位本会话未读计数。
 * 幂等：重复调用不会产生重复回执（receipts 以 (messageId,userId) 唯一约束 upsert）。
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id } = await params;

    const ref = await resolveConversationRef(id, userId);
    if (!ref) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const now = new Date();

    // 只取未被 Conversation 覆盖的房间才需要写 Legacy 已读位
    const unread = await db.iMMessage.findMany({
      where: {
        conversationId: ref.conversationId,
        senderId: { not: userId },
        isDeleted: false,
        receipts: { none: { userId } },
      },
      select: { id: true },
      orderBy: { seq: "desc" },
      take: MARK_READ_BATCH_LIMIT,
    });

    if (unread.length > 0) {
      await db.$transaction(
        unread.map((m) =>
          db.messageReceipt.upsert({
            where: { messageId_userId: { messageId: m.id, userId } },
            update: { readAt: now },
            create: {
              messageId: m.id,
              conversationId: ref.conversationId,
              userId,
              deliveredAt: now,
              readAt: now,
            },
          }),
        ),
      );
    }

    // 复位本会话未读计数（按角色选择列）
    const conv = await db.conversation.findFirst({
      where: { id: ref.conversationId },
      select: { userAId: true, userBId: true },
    });
    if (conv) {
      await db.conversation.update({
        where: { id: ref.conversationId },
        data: conv.userAId === userId ? { unreadCountA: 0 } : { unreadCountB: 0 },
      });
    }

    return NextResponse.json({ success: true, marked: unread.length });
  } catch (error) {
    console.error("[IM] Mark conversation read error:", error);
    return NextResponse.json(
      { error: "Failed to mark conversation as read" },
      { status: 500 }
    );
  }
}
