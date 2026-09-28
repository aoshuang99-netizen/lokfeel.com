/**
 * ✅ [P1-6 阶段 4 — TARGET/KEEP] 统一 id 解析器（消除 D1「同一会话两个主键」）
 *
 * 背景：
 *   双聊天系统里，同一个 1:1 会话有两个主键 —— `ChatRoom.id` 与 `Conversation.id`。
 *   二者由 `Conversation.chatRoomId`（@unique）一一对应。改造前前端只拿到一个裸字符串，
 *   服务端只能靠"先试 A 再试 B"猜测，导致：
 *     · 同一会话的历史消息分散在两张表（D2）
 *     · 入口 id 类型不同 → 写入落到不同的表（合并目标无法达成）
 *
 * 本模块的作用：**任何入口 id 都能解析出唯一的会话引用**。调用方拿到
 * `Ref.conversationId` 后即可稳定使用 IM 侧 API，无需再关心 id 来源。
 *
 * 与 `/api/chat/[id]/messages` 分发器的关系：
 *   该分发器同样解析两种 id，但它把解析与业务逻辑（读取/写入/Bot 回复）耦合在一个文件里。
 *   阶段 4 的前端改为直接走 `/api/im/*`，因此需要一个只做解析、不含业务副作用的独立模块。
 *   分发器保留，供过渡期内的外部/旧客户端调用。
 *
 * @module lib/im/resolve
 */

import { db } from '@/lib/db';
import { isLegacyChatModelAvailable } from './legacy-capability';

export interface ConversationRef {
  conversationId: string;
  /**
   * 对应 ChatRoom id。
   *
   * ⚠️ 阶段 5 之后**这个字段仍然有效**：`Conversation.chatRoomId` 列被刻意保留
   * （只去掉指向 ChatRoom 的外键关系），作为「旧书签别名」永久存在。
   * 因此它同时是：① 阶段 5 前 Legacy 数据的定位键；② 阶段 5 后旧 URL 的解析键。
   */
  chatRoomId: string | null;
  /** 会话中的另一方 */
  otherUserId: string;
  /** 入口 id 的形状，便于排障与埋点（不参与业务判定） */
  resolvedFrom: 'conversation' | 'chatRoomAlias' | 'chatRoom';
  /**
   * 该会话对应的 ChatRoom 行**此刻是否可读**。
   *
   * 这是「阶段 5 软着陆」的判据：调用方应据此决定是否查询 ChatRoom 取富化字段，
   * 而**不是**用 `chatRoomId != null` 判断 —— 后者在删表后会得到一个必然失败的查询。
   *
   * 判定为 `chatRoomId != null && ChatRoom 模型可用`。刻意不额外查一次库：
   * 富化查询本身就是"查不到就回退"的语义，多一次存在性查询纯属浪费。
   */
  legacyRoomAvailable: boolean;
  /**
   * @deprecated 语义等同 `legacyRoomAvailable`，仅为兼容既有调用方而保留。
   * 新代码请直接用 `legacyRoomAvailable`。
   */
  vaultFromChatRoom: boolean;
}

/**
 * 解析任意会话 id → 统一引用。
 *
 * 解析顺序：**① Conversation.id → ② ChatRoom.id 别名**。
 *
 * · 步骤 ① 是阶段 4 之后的常态（列表与详情都返回 Conversation.id）。
 * · 步骤 ② 是**旧书签的永久兜底**。用户在改造前收藏的
 *   `app.lokfeel.com/dashboard/chats/<ChatRoom.id>` 里没有 Conversation.id，
 *   只能靠 `Conversation.chatRoomId`（@unique）反查。**这一步使阶段 5 删表后
 *   旧链接依然可用** —— 否则删表会静默把一批老用户挡在"会话不存在"之外（G-8）。
 *   （原步骤 ③"按 ChatRoom 实体命中"已在阶段 5 随表删除。）
 *
 * 三种路径都要求调用者对会话有访问权（是参与者），否则返回 null —— 调用方应回 404，
 * 不要区分"不存在"与"无权限"，避免泄露会话 id 的存在性。
 *
 * @param id     入口 id，可能是 Conversation.id 或 ChatRoom.id
 * @param userId 当前登录用户
 */
export async function resolveConversationRef(
  id: string,
  userId: string,
): Promise<ConversationRef | null> {
  // ── 路径 1：直接按 Conversation.id 命中（阶段 4 之后的常态） ──
  const conv = await db.conversation.findFirst({
    where: { id, OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true, chatRoomId: true },
  });

  if (conv) {
    const legacyRoomAvailable = !!conv.chatRoomId && isLegacyChatModelAvailable('chatRoom');
    return {
      conversationId: conv.id,
      chatRoomId: conv.chatRoomId ?? null,
      otherUserId: conv.userAId === userId ? conv.userBId : conv.userAId,
      resolvedFrom: 'conversation',
      legacyRoomAvailable,
      vaultFromChatRoom: legacyRoomAvailable,
    };
  }

  // ── 路径 2：按 ChatRoom.id 别名命中（旧书签、且 ChatRoom 表可能已删除） ──
  // 放在路径 3 之前：它只依赖 Conversation（永不被删），因此**在阶段 5 之后依然有效**。
  // 返回的 conversationId 是真正的 Conversation.id，调用方无需知道 id 的来源形状。
  const aliased = await db.conversation.findFirst({
    where: { chatRoomId: id, OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true, chatRoomId: true },
  });

  if (aliased) {
    const legacyRoomAvailable = isLegacyChatModelAvailable('chatRoom');
    return {
      conversationId: aliased.id,
      chatRoomId: aliased.chatRoomId ?? id,
      otherUserId: aliased.userAId === userId ? aliased.userBId : aliased.userAId,
      resolvedFrom: 'chatRoomAlias',
      legacyRoomAvailable,
      vaultFromChatRoom: legacyRoomAvailable,
    };
  }

  // ── 都未命中：调用方应回 404（不区分"不存在"与"无权限"） ──
  // P1-6 阶段 5：原路径 3（ChatRoom 实体命中）已随表删除，这里成为唯一的末态出口。
  return null;
}

/**
 * 判断一个已解析的引用是否**只能**走 Legacy 通路（即没有 Conversation 承载它）。
 *
 * 调用方用它来决定读哪张消息表。阶段 4 之后应恒为 false；若线上仍观测到 true，
 * 说明 backfill 覆盖率不足，先跑 `npm run chat:inventory` 核查再继续。
 */
export function isLegacyOnly(ref: ConversationRef, id: string): boolean {
  // 当 conversationId === id 且 chatRoomId 为空 → 这是纯 Conversation（正常）。
  // 当 chatRoomId === id 且 conversationId === id → 房间没有 Conversation，conversationId 是回退值。
  return ref.chatRoomId === id && ref.conversationId === id;
}
