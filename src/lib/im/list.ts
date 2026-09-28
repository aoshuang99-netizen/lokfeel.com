/**
 * ✅ [P1-6 阶段 4 — TARGET/KEEP] 统一会话列表（单一数据源）
 *
 * 为什么需要这个模块：
 *
 *   改造前，会话列表有两个各自为政的接口：
 *     · `/api/chat`              —— "运行时合并层"：把 ChatRoom 与 Conversation 拼在一起，
 *                                    **按对方 userId 粗略去重且优先 ChatRoom**。
 *     · `/api/im/conversations`  —— 只查 Conversation，**缺 matchScore / Vault / age 字段**。
 *
 *   这导致两个真实缺陷：
 *     D1「同一会话两个主键」：列表返回的 `id` 是混合的 —— 命中 ChatRoom 的项给 ChatRoom.id，
 *        命中 IM 的项给 Conversation.id。前端只拿到一个字符串，无从区分，详情页只能靠
 *        "先试 A 再试 B"猜测。阶段 3 已把分发顺序反转为 Conversation 优先，但只要列表
 *        仍能吐出 ChatRoom.id，就仍有一半入口走进 Legacy 写入路径 —— 合并目标无法达成。
 *     D3「按 userId 粗去重」：ChatRoom 与 Conversation 若指向同一对象，IM 侧那条会被**整个丢弃**，
 *        连带它的 unreadCount 与 seq 语义一起丢失。若两者数据不同步，用户会看到错误未读数。
 *
 *   本模块的解法：**以 Conversation 为唯一列表骨架**，把 ChatRoom 降级为"富化数据源"
 *    （提供 matchId / matchScore / Vault 状态）。输出项的 `id` 恒为 Conversation.id。
 *   ChatRoom 若无对应 Conversation（backfill 未覆盖的历史房间），才作为独立项出现，
 *   其 id 仍为 ChatRoom.id —— 但这属于**过渡期残留**，阶段 5 随 Legacy 表一并清理。
 *
 * 为什么不直接删掉 ChatRoom 分支：
 *   线上存在 `TWIN-CHAT FIX` 之前创建的历史房间，其 Conversation 可能缺失（幂等 backfill 需实测）。
 *   若列表直接不展示它们，用户会**丢失历史会话入口**。因此先并存，跑完体检脚本确认覆盖率为 100%
 *   后再移除（见 docs/CHAT-MERGE-RUNBOOK.md 的闸门判据）。
 *
 * @module lib/im/list
 */

import { db } from '@/lib/db';
import { hasLegacyChatTables } from './legacy-capability';

/** 统一的会话列表项。字段命名与前端 `ChatItem` 对齐，避免前端做二次映射。 */
export interface UnifiedChatItem {
  /** 统一主键：优先 Conversation.id；仅历史遗留 ChatRoom 才为 ChatRoom.id */
  id: string;
  /** IM 会话 id（历史遗留房间为 null） */
  conversationId: string | null;
  /** 对应 ChatRoom id（用于 Vault 操作等仍挂在 ChatRoom 上的能力） */
  chatRoomId: string | null;
  matchId: string | null;
  matchScore?: number;
  otherUser: {
    id: string;
    name: string;
    age?: number;
    avatar: string | null;
    isOnline: boolean;
    lastSeen?: string;
    isBot: boolean;
  };
  lastMessage: {
    content: string;
    msgType: string;
    timestamp: string;
    isFromMe: boolean;
  } | null;
  unreadCount: number;
  isVault: boolean;
  vaultExpiresAt?: string;
  /** Vault 四态（ACTIVE/EXTENDED/REVOKED/EXPIRED）—— 阶段 4 起随列表暴露，供 UI 精细化展示 */
  vaultStatus?: string;
  lastReadAt: string | null;
  /** 仅用于内部调试/体检，不对外暴露 */
  source: 'conversation' | 'chatroom-only';
}

/** 会话列表最大条数（两侧各自限额，合并后统一排序截断） */
const LIST_LIMIT = 50;

type ProfileLite = { displayName: string | null; age: number | null; avatar: string | null } | null;

interface UserLite {
  id: string;
  name: string | null;
  image: string | null;
  isBot: boolean;
  profile: ProfileLite;
}

function displayName(u: UserLite | null | undefined): string {
  return u?.profile?.displayName || u?.name || 'Unknown';
}

/**
 * 老用户头像口径：profile.avatar 优先，回退 user.image。
 * 与 /api/chat 改造前行为一致（这是前端头像渲染的既有契约）。
 */
function displayAvatar(u: UserLite | null | undefined): string | null {
  return u?.profile?.avatar || u?.image || null;
}

/**
 * 构建用户的统一会话列表。
 *
 * 排序：lastMessageAt 降序（null 视为 0）。这是改造前 `/api/chat` 的既有排序语义，保持不变。
 *
 * @param userId 当前登录用户
 */
export async function buildConversationList(userId: string): Promise<UnifiedChatItem[]> {
  // 阶段 5 软着陆开关：ChatRoom 被删除后，include 分支与孤儿房间段整体跳过，
  // Vault / matchScore 自动回退到 Conversation 自身的列（G-1 迁移已把字段扩过去）。
  const legacyRoomAvailable = hasLegacyChatTables();

  // ═══ 1. 以 Conversation 为骨架，挂上 ChatRoom 作富化源 ═══
  const conversations = await db.conversation.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      state: { not: 'ARCHIVED' },
    },
    include: {
      userA: {
        select: {
          id: true,
          name: true,
          image: true,
          isBot: true,
          profile: { select: { displayName: true, age: true, avatar: true } },
        },
      },
      userB: {
        select: {
          id: true,
          name: true,
          image: true,
          isBot: true,
          profile: { select: { displayName: true, age: true, avatar: true } },
        },
      },
      // 富化源：阶段 5 后 Vault / matchId 全部来自 Conversation 自身列
      // （Vault 由 chat:vault:apply 迁入，matchId 由同一次迁移搬运）。
      imMessages: {
        orderBy: { seq: 'desc' },
        take: 1,
        select: { id: true, payload: true, msgType: true, senderId: true, createdAt: true },
      },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: LIST_LIMIT,
  });

  const items: UnifiedChatItem[] = conversations.map((conv) => {
    const isUserA = conv.userAId === userId;
    const otherUser = isUserA ? conv.userB : conv.userA;
    const unreadCount = isUserA ? conv.unreadCountA : conv.unreadCountB;
    const last = conv.imMessages[0];

    // Vault 取 Conversation 自身字段（阶段 5 后唯一来源）
    const vaultExpiry: Date | null = conv.vaultExpiresAt ?? null;
    const isVault = !!(vaultExpiry && vaultExpiry.getTime() > Date.now());

    return {
      id: conv.id,
      conversationId: conv.id,
      chatRoomId: conv.chatRoomId ?? null,
      matchId: conv.matchId ?? null,
      matchScore: undefined,
      otherUser: {
        id: otherUser.id,
        name: displayName(otherUser as UserLite),
        age: otherUser.profile?.age ?? undefined,
        avatar: displayAvatar(otherUser as UserLite),
        isOnline: false, // 由下方 presence 批量覆盖
        isBot: otherUser.isBot,
      },
      lastMessage: last
        ? {
            content: (last.payload || '').slice(0, 100),
            msgType: last.msgType,
            timestamp: last.createdAt.toISOString(),
            isFromMe: last.senderId === userId,
          }
        : null,
      unreadCount,
      isVault,
      vaultExpiresAt: vaultExpiry ? vaultExpiry.toISOString() : undefined,
      // Vault 取 Conversation 自身字段（阶段 5 后唯一来源）
      vaultStatus: conv.vaultStatus ?? undefined,
      lastReadAt: null,
      source: 'conversation',
    };
  });

  // ═══ 2.5 匹配分补齐（阶段 5 软着陆） ═══
  // 阶段 5 删掉 ChatRoom 后 `room.match.matchScore` 不复存在，匹配分需要一个
  // 与 Legacy 无关的来源。这里按 `Conversation.matchId` 批量查 `Match`（G-10）。
  //
  // 只在 Legacy 不可用时执行：阶段 5 之前 include 已经拿到了 matchScore，
  // 再做一次额外查询纯属浪费。这样同一份代码在删表前后都给出正确的匹配分。
  if (!legacyRoomAvailable) {
    const needMatch = [
      ...new Set(
        items
          .filter((i) => i.matchScore === undefined && !!i.matchId)
          .map((i) => i.matchId as string),
      ),
    ];
    if (needMatch.length > 0) {
      try {
        const matches = await db.match.findMany({
          where: { id: { in: needMatch } },
          select: { id: true, matchScore: true },
        });
        const scoreById = new Map(matches.map((m) => [m.id, m.matchScore]));
        for (const item of items) {
          if (item.matchScore !== undefined || !item.matchId) continue;
          const s = scoreById.get(item.matchId);
          if (s !== undefined && s !== null) item.matchScore = s;
        }
      } catch (e) {
        // 匹配分是展示增强项，失败不得影响会话列表主流程
        console.warn('[IM] matchScore enrichment skipped:', e);
      }
    }
  }

  // ═══ 3. 在线状态富化（UserPresence） ═══
  // 改造前 /api/chat 恒返回 isOnline:false（Legacy 侧没有 presence 概念）。
  // IM 侧有 UserPresence 表，这里做批量查询；表为空时行为与改造前等价（全部离线），
  // 因此这是"纯增益、无回退风险"的改动。
  const otherIds = [...new Set(items.map((i) => i.otherUser.id).filter(Boolean))];
  if (otherIds.length > 0) {
    try {
      const presences = await db.userPresence.findMany({
        where: { userId: { in: otherIds } },
        select: { userId: true, status: true, lastSeenAt: true },
      });
      const presenceByUser = new Map(presences.map((p) => [p.userId, p]));
      for (const item of items) {
        const p = presenceByUser.get(item.otherUser.id);
        if (!p) continue;
        item.otherUser.isOnline = p.status === 'ONLINE';
        if (p.lastSeenAt) item.otherUser.lastSeen = p.lastSeenAt.toISOString();
      }
    } catch (e) {
      // presence 是可选增强，失败不得影响会话列表主流程
      console.warn('[IM] presence enrichment skipped:', e);
    }
  }

  // ═══ 4. 统一排序 + 截断 ═══
  items.sort((a, b) => {
    const ta = a.lastMessage ? new Date(a.lastMessage.timestamp).getTime() : 0;
    const tb = b.lastMessage ? new Date(b.lastMessage.timestamp).getTime() : 0;
    return tb - ta;
  });

  return items.slice(0, LIST_LIMIT);
}

/** 对外响应形状：剔除内部 source 字段 */
export function toPublicChatItems(items: UnifiedChatItem[]) {
  return items.map(({ source: _source, ...rest }) => rest);
}
