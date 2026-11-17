import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { safeRequestBody } from "@/lib/safe-json";
import { handleBotReply } from "@/lib/im/bot-reply";
import { checkSendPermission } from "@/lib/im/message-guards";
import {
  checkMediaGrant,
  resolveRequiredMediaLevel,
} from "@/lib/im/consent-guard";
import { safePayloadForDisclosure } from "@/lib/im/media-disclosure";
import { IMMessageType } from "@/generated";

/** 客户端被允许声明的消息类型白名单。SYSTEM 等枚举绝不可由客户端指定。 */
const CLIENT_ALLOWED_MSG_TYPES: readonly string[] = ["TEXT", "IMAGE", "VOICE"];

// Pusher is optional - gracefully degrade if not configured
import { getPusherServer } from "@/lib/pusher";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    // BUG-630: safe parse — return 400 instead of 500 on malformed body
    const body = await safeRequestBody<{
      conversationId?: string;
      content?: string;
      msgType?: string;
      clientMsgId?: string;
    }>(req);
    if (!body) {
      return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
    }
    const { conversationId, content, clientMsgId } = body;
    // BUG-630: typed msgType (enum) with a safe default so Prisma accepts it.
    // P1-6 阶段 4 加固：客户端此前可直接指定任意 IMMessageType（如 SYSTEM），
    // 从而在会话里伪造"匹配成功""系统通知"之类的消息。改为白名单校验，
    // 非白名单值一律降级为 TEXT（而非报错，保持向后兼容）。
    const requestedType = (body.msgType || "").toUpperCase();
    const msgType: IMMessageType = CLIENT_ALLOWED_MSG_TYPES.includes(requestedType)
      ? (requestedType as IMMessageType)
      : IMMessageType.TEXT;

    if (!conversationId || !content) {
      return NextResponse.json(
        { error: "Conversation ID and content required" },
        { status: 400 }
      );
    }

    // Verify user is part of conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ userAId: userId }, { userBId: userId }],
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const receiverId = conversation.userAId === userId ? conversation.userBId : conversation.userAId;

    // ── IDEMPOTENCY: persist + dedup clientMsgId ──
    // The column is @unique. On a flaky-network retry the client resends the
    // same clientMsgId; return the original message instead of creating a dup.
    if (clientMsgId) {
      const existing = await prisma.iMMessage.findFirst({
        where: { clientMsgId, conversationId },
        include: {
          sender: {
            include: {
              profile: { select: { displayName: true, avatar: true } },
            },
          },
        },
      });
      if (existing) {
        // ── V25.2 P0-SEC-02：幂等重放不得绕过媒体授权 ──
        // 攻击场景：A 曾在有授权时发过媒体，B 撤销后 A 用**同一个 clientMsgId**
        // 重放（甚至把 msgType 伪装成 TEXT）。若直接返回 existing.payload，等于
        // 在撤销后重新暴露媒体原文。这里用 existing 自身的真实 msgType + payload
        // 重算档位并复核当前授权；未授权一律 403，且不返回任何媒体内容。
        const replayLevel = resolveRequiredMediaLevel(existing.msgType, existing.payload);
        if (replayLevel) {
          const replayVerdict = await checkMediaGrant({
            receiverId,
            senderId: userId,
            conversationId,
            requiredLevel: replayLevel,
          });
          if (!replayVerdict.granted) {
            return NextResponse.json(
              {
                error: "MEDIA_CONSENT_REQUIRED",
                code: "MEDIA_CONSENT_REVOKED_REPLAY",
                requiredLevel: replayVerdict.requiredLevel,
                grantedLevel: replayVerdict.effectiveLevel,
                reason: replayVerdict.reason,
              },
              { status: 403 }
            );
          }
        }
        return NextResponse.json({
          success: true,
          duplicate: true,
          message: {
            id: existing.id,
            clientMsgId: existing.clientMsgId,
            content: existing.payload,
            type: existing.msgType,
            createdAt: existing.createdAt,
            sender: {
              id: existing.sender.id,
              name: existing.sender.profile?.displayName || existing.sender.name || "Unknown",
              avatar: existing.sender.profile?.avatar,
            },
            seq: existing.seq,
          },
        });
      }
    }

    // ── MESSAGE GATE ──
    // Premium / Lady Free / female: unlimited. Free male: 2 messages / conversation.
    // Non-premium must verify card after 3 total messages.
    //
    // P1-6 阶段 4：改用 `@/lib/im/message-guards` 的共享守卫，不再本地重算。
    // 原因（这是一个真实的绕过风险，不只是重构）：
    //   本文件原先只统计 `iMMessage`。但在阶段 3 的迁移过渡期内，用户的历史消息
    //   仍可能在 Legacy `Message` 表里（尚未迁移或只迁了一半）。此时 IM 侧计数偏小，
    //   **免费用户可通过本端点多发消息**，绕过 2 条/会话 与 卡片验证 两道限制。
    //   共享守卫对两套表取 max()，在"迁移前 / 双写期 / 阶段 4 之后"三个时期都成立。
    const verdict = await checkSendPermission({
      userId,
      conversationId,
      chatRoomId: conversation.chatRoomId ?? null,
    });
    if (!verdict.ok) {
      return NextResponse.json(verdict.body, { status: verdict.status });
    }

    // ── V25-09 / M04 · MEDIA CONSENT GATE（P0 隐私硬门禁）──
    // 前提缺口：此前 mediaLevel 仅由客户端 msgType 推导、consentState 硬编码
    // CONSENT_NONE，发送执行点从未校验接收方是否授权该档位媒体 —— 任何人都能
    // 声明 IMAGE/VOICE 直接投递。这里在**任何写操作之前**（事务、Pusher、
    // bot reply 全在下方）做最小权限默认拒绝：
    //   · 授权方向 receiver(granter) → sender(grantee)，不跨会话、不看缓存；
    //   · 无有效 grant（不存在/撤销/过期/档位不足）⇒ 403 且零写；
    //   · TEXT 不受影响（基础通信能力）。
    // V25.2：档位取"声明 msgType"与"payload 内容嗅探"的较高者，堵住
    // 「把媒体伪装成 TEXT / 伪造 MIME」——客户端改 msgType 也绕不过内容嗅探。
    const requiredMediaLevel = resolveRequiredMediaLevel(msgType, content);
    if (requiredMediaLevel) {
      const mediaVerdict = await checkMediaGrant({
        receiverId,
        senderId: userId,
        conversationId,
        requiredLevel: requiredMediaLevel,
      });
      if (!mediaVerdict.granted) {
        return NextResponse.json(
          {
            error: "MEDIA_CONSENT_REQUIRED",
            code: "MEDIA_CONSENT_REQUIRED",
            requiredLevel: mediaVerdict.requiredLevel,
            grantedLevel: mediaVerdict.effectiveLevel,
            reason: mediaVerdict.reason,
          },
          { status: 403 }
        );
      }
    }

    // Atomic transaction: create message + update conversation (prevents data inconsistency)
    const message = await prisma.$transaction(async (tx) => {
      const lastMessage = await tx.iMMessage.findFirst({
        where: { conversationId },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      const nextSeq = (lastMessage?.seq || 0) + 1;

      const msg = await tx.iMMessage.create({
        data: {
          conversationId,
          senderId: userId,
          receiverId,
          clientMsgId: clientMsgId || null,
          seq: nextSeq,
          msgType,
          payload: content,
          encryptionMode: "SERVER",
          // V25.2：记录"已验证档位"而非声明类型，供 V25-10 读取侧据此复核。
          consentState: requiredMediaLevel ? "CONSENT_GRANTED" : "CONSENT_NONE",
          mediaLevel: requiredMediaLevel ?? "L0_TEXT",
          ruleResult: "PASS",
        },
        include: {
          sender: {
            include: {
              profile: {
                select: {
                  displayName: true,
                  avatar: true,
                },
              },
            },
          },
        },
      });

      // Update conversation INSIDE the transaction (was previously outside — caused P0-2 data inconsistency)
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          messageCount: { increment: 1 },
          // Increment unread count for the receiver
          ...(conversation.userAId === receiverId && { unreadCountA: { increment: 1 } }),
          ...(conversation.userBId === receiverId && { unreadCountB: { increment: 1 } }),
        },
      });

      return msg;
    });

    // ── V25.3 T02 · 实时披露之前重新判决（P0 隐私） ──
    // 写侧门禁（上方）保证"未授权不能落库"，但 Pusher 实时广播与 Bot 上下文是
    // **两条独立的新披露路径**：它们曾直接外发 message.payload / content 原文。
    // 这里对每条路径单独过一次统一判决，且只使用返回的 safePayload：
    //   · view（实时推送给接收方）：以接收方为 actor 复核当前授权——即便消息已
    //     落库，若授权在写后/发前这一瞬被撤销，实时通道也不得泄露原文；
    //   · process_ai（Bot 分类上下文）：媒体一律拒绝，Bot 只拿到占位符；
    //     TEXT 无媒体披露面，正常放行，Bot 回复能力不受影响。
    const disclosureSubject = {
      actorId: receiverId,
      senderId: userId,
      conversationId,
      mediaLevel: message.mediaLevel,
      payload: message.payload,
      msgType: message.msgType,
    };
    const [realtimePayload, botSafeContent] = await Promise.all([
      safePayloadForDisclosure("view", disclosureSubject),
      safePayloadForDisclosure("process_ai", disclosureSubject),
    ]);

    // Send real-time notification via Pusher (IM v2 format)
    // Pusher is optional - if not configured, polling will handle message delivery
    const pusherServer = getPusherServer();
    if (pusherServer) {
      try {
        const messagePayload = {
          msgId: message.id,
          // BUG-4/7: echo the client-generated id so the frontend can dedupe
          // optimistic vs. realtime messages (prevents duplicate rendering)
          clientMsgId: clientMsgId || message.id,
          senderId: userId,
          receiverId,
          convId: conversationId,
          seq: message.seq,
          msgType: message.msgType,
          // V25.3 T02：实时载荷用判决后的安全内容，撤销/越权时为占位符。
          payload: realtimePayload,
          encryptionMode: "SERVER",
          complianceTags: [],
          consentState: message.consentState,
          mediaLevel: message.mediaLevel,
          // V25.3 T02：与读取侧同契约——原文被撤销/越权遮盖时置 true，
          // 前端据此避免把占位符当作图片/音频 URL 渲染。
          mediaRedacted: realtimePayload !== message.payload,
          ruleResult: "PASS",
          isEdited: false,
          isDeleted: false,
          status: "DELIVERED",
          timestamp: new Date(message.createdAt).getTime(),
          sender: {
            id: message.sender.id,
            name: message.sender.profile?.displayName || message.sender.name || "Unknown",
            avatar: message.sender.profile?.avatar,
          },
        };

        // Broadcast to conversation channel (IM v2 naming)
        await pusherServer.trigger(
          `private-im-conv-${conversationId}`,
          "im:message",
          { message: messagePayload }
        );

        // Also notify receiver's personal channel (IM v2 naming)
        await pusherServer.trigger(
          `private-im-user-${receiverId}`,
          "im:message",
          { message: messagePayload }
        );
      } catch (pusherError) {
        console.warn("[IM] Pusher push failed (message saved in DB):", pusherError);
      }
    }

    // Trigger bot auto-reply if receiver is a bot
    // IMPORTANT: Must await — bot reply must be written to DB BEFORE we return,
    // otherwise Vercel Serverless will kill the process and the reply never gets saved.
    try {
      // V25.3 T02：Bot 上下文只喂判决后的内容——媒体为占位符，绝不把 data URL
      // / 媒体原文送进 Bot 分类与交互日志（日志/分析埋点同样不得含 base64）。
      await handleBotReply(conversationId, userId, receiverId, botSafeContent);
    } catch (botErr) {
      console.error("[IM] Bot reply error (message still saved):", botErr);
    }

    return NextResponse.json({
      success: true,
      message: {
        id: message.id,
        clientMsgId: clientMsgId || message.id,
        content: message.payload,
        type: message.msgType,
        createdAt: message.createdAt,
        sender: {
          id: message.sender.id,
          name: message.sender.profile?.displayName || message.sender.name || "Unknown",
          avatar: message.sender.profile?.avatar,
        },
        seq: message.seq,
      },
    });
  } catch (error) {
    console.error("[IM] Send message error:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
