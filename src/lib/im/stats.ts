/**
 * 聊天统计的**单一数据源**（阶段 5 之后的纯 IM 口径）。
 *
 * ## 历史：为什么曾经是 `max(Legacy, IM)`
 *
 * 阶段 5 之前，`Message` / `ChatRoom` / `ChatRoomMember` 三张 Legacy 表尚未删除，
 * 本模块统一封装 **`max(Legacy, IM)`** 口径：迁移是 1:1 复制
 * （`IMMessage.legacyMessageId` ↔ `Message.id`），两侧存在**包含关系**（IM ⊇ Legacy），
 * 因此 `max` 在迁移窗口期的三个阶段都给出不低估的全量值，而 `sum` 会重复计数。
 *
 * 阶段 5 删表后，Legacy 分支已按阶段 5 标注全部移除，本模块退化为纯 IM
 * 统计 —— 前置条件是 `npm run chat:retire` 的 B4 门禁（消息未迁移 = 0）已 GO，
 * 因此退化不会让任何统计数字变小。
 *
 * @module lib/im/stats
 */

import { db } from '@/lib/db';
import type { Prisma } from '@/generated';

// ═══════════════════════════════════════════════════════════════════════════
// 公共类型
// ═══════════════════════════════════════════════════════════════════════════

/** 时间窗（两端都可选，与时序查询的惯用写法一致） */
export interface TimeWindow {
  gte?: Date;
  lte?: Date;
}

/** 消息统计的过滤条件 */
export interface MessageCountOptions {
  /** 按 `createdAt` 限定时间窗 */
  window?: TimeWindow;
  /** 按发送者 id 限定 */
  senderId?: string;
  /** 按发送者属性限定（如 Bot、邮箱后缀）。接 `User` 关联过滤 */
  sender?: Prisma.UserWhereInput;
  /** 限定到单个会话（`IMMessage.conversationId`） */
  conversationId?: string | null;
  /**
   * 只统计"用户产出"的消息（排除 `msgType = SYSTEM`）。
   *
   * WHY：匹配成功时 `matches/react` 插入的 SYSTEM 通知把 `senderId` 记为
   * **匹配发起人**，于是该用户"什么都没发"却已计 1 条。凡是要展示给用户看
   * 的"我发了几条"，都必须打开这个开关，否则数字虚高、且与真实发信门禁
   * （`lib/im/message-guards.ts` 已排除 SYSTEM）口径不一致。
   *
   * 面向运营的总量/分析类统计**不要**打开 —— 那些场景要的是消息总量。
   */
  excludeSystem?: boolean;
}

/** 活跃发送者统计的过滤条件 */
export interface SenderCountOptions {
  window?: TimeWindow;
  sender?: Prisma.UserWhereInput;
}

// ═══════════════════════════════════════════════════════════════════════════
// 内部工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 由 `TimeWindow` 构造 Prisma 的 `createdAt` 过滤；无有效边界时返回 `undefined`。
 *
 * ⚠️ 返回值刻意标注为**结构化类型**而不是 `Prisma.DateTimeFilter`：后者在 Prisma 里
 * 是按模型泛型化的，直接 spread 进某侧 where 可能引入泛型不匹配的类型错误。
 * 用最小结构类型 + 逐字段赋值可以彻底绕开这个陷阱。
 */
function buildCreatedAt(window: TimeWindow | undefined): { gte?: Date; lte?: Date } | undefined {
  if (!window || (!window.gte && !window.lte)) return undefined;

  const createdAt: { gte?: Date; lte?: Date } = {};
  if (window.gte) createdAt.gte = window.gte;
  if (window.lte) createdAt.lte = window.lte;
  return createdAt;
}

// ═══════════════════════════════════════════════════════════════════════════
// 消息计数
// ═══════════════════════════════════════════════════════════════════════════

/** 统计消息条数。 */
export async function countMessages(opts: MessageCountOptions = {}): Promise<number> {
  const imWhere: Prisma.IMMessageWhereInput = {};
  const createdAt = buildCreatedAt(opts.window);
  if (createdAt) imWhere.createdAt = createdAt;
  if (opts.senderId) imWhere.senderId = opts.senderId;
  if (opts.sender) imWhere.sender = opts.sender;
  if (opts.conversationId) imWhere.conversationId = opts.conversationId;
  if (opts.excludeSystem) imWhere.msgType = { not: 'SYSTEM' };

  return db.iMMessage.count({ where: imWhere });
}

/**
 * 统计"发过消息的**不同用户**数"（活跃用户）。
 *
 * 实现用 `findMany + distinct` 而非 `groupBy`：后者在 Turso/libSQL 上不稳定
 * （见 `api/admin/analytics` 里的既有注释），全项目统一走 distinct。
 */
export async function countDistinctMessageSenders(
  opts: SenderCountOptions = {},
): Promise<number> {
  const imWhere: Prisma.IMMessageWhereInput = {};
  const createdAt = buildCreatedAt(opts.window);
  if (createdAt) imWhere.createdAt = createdAt;
  if (opts.sender) imWhere.sender = opts.sender;

  const imRows = await db.iMMessage.findMany({
    where: imWhere,
    select: { senderId: true },
    distinct: ['senderId'],
  });

  const senders = new Set<string>();
  for (const r of imRows) senders.add(r.senderId);
  return senders.size;
}

// ═══════════════════════════════════════════════════════════════════════════
// 会话计数
// ═══════════════════════════════════════════════════════════════════════════

/** 统计会话总数。 */
export async function countConversations(): Promise<number> {
  return db.conversation.count();
}

/**
 * 统计某用户"**近期有消息往来**的会话数"。
 *
 * 语义对应改造前的「7 天内有消息的房间数」（免费套餐 `maxChats` 的计数口径）。
 *
 * 用 `imMessages: { some: ... }` 而不是读 `Conversation.messageCount` 缓存列：
 * 缓存列在跨表迁移后会与真实消息量脱节，而本函数的用途是**限额判定** ——
 * 偏大是安全方向、偏小才是漏洞，因此以真实消息行为准。
 */
export async function countUserActiveConversations(
  userId: string,
  activeSince: Date,
): Promise<number> {
  return db.conversation.count({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      imMessages: { some: { createdAt: { gte: activeSince } } },
    },
  });
}

/**
 * 统计"**近期活跃的 Bot 会话**数"（Bot 引擎健康看板用）。
 *
 * `ConversationParticipant.isArchived` 是**每用户**标记（Legacy `ChatRoom.isArchived`
 * 曾是房间级标记），因此按"该 Bot 参与者的会话未归档"计数 —— 对健康看板而言
 * 偏大不会掩盖故障，是可接受的近似。
 */
export async function countActiveBotChats(activeSince: Date): Promise<number> {
  return db.conversationParticipant.count({
    where: {
      user: { isBot: { not: false } },
      isArchived: false,
      conversation: { lastMessageAt: { gte: activeSince } },
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 用户维度统计
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 统计某用户的**未读消息数**（徽章口径）。
 *
 * 读 `Conversation.unreadCountA/B` 缓存列（**与前端徽章同源**，这就是"权威值"）：
 * 徽章直接显示这一列，若两处口径不同，用户会看到"列表里 3 条未读、点进去 0 条"的矛盾。
 */
export async function countUnreadForUser(userId: string): Promise<number> {
  const convAgg = await db.conversation.aggregate({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    _sum: { unreadCountA: true, unreadCountB: true },
  });

  return (convAgg._sum.unreadCountA || 0) + (convAgg._sum.unreadCountB || 0);
}

/**
 * 统计某用户参与的全部会话数。
 *
 * 对应 `/api/chats/unread-count` 的 `totalChats` 字段（前端只声明不消费，
 * 保留以维持接口形状）。
 */
export async function countUserConversations(userId: string): Promise<number> {
  return db.conversation.count({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
  });
}

/**
 * 统计某用户参与会话中的**消息条数**（可带时间窗）。
 *
 * 用于用户侧分析看板（"本周消息数"）。
 */
export async function countMessagesForUser(
  userId: string,
  window?: TimeWindow,
): Promise<number> {
  const createdAt = buildCreatedAt(window);

  return db.iMMessage.count({
    where: {
      conversation: { OR: [{ userAId: userId }, { userBId: userId }] },
      ...(createdAt ? { createdAt } : {}),
    },
  });
}
