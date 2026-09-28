/**
 * [P1-6 阶段 5 · 统一的**消息写入入口**]
 *
 * 阶段 5 之后本模块是**纯 IM 写入入口**：只写终局模型
 * （`Conversation` + `IMMessage`，经由 `createMessage`），不再产生任何
 * Legacy 副本。原"IM 主 + 可选 Legacy 副本"的方向说明、`CHAT_TWIN_WRITE`
 * 开关与 5 个阶段 5 删除标注块已随阶段 5 清理一并移除。
 *
 * @module lib/im/write-message
 */

import { db } from '@/lib/db';
import type { IMMessageType } from '@/generated';
import { createMessage } from './queries';

export interface WriteMessageParams {
  /** 终局模型会话 id（**不是** ChatRoom.id） */
  conversationId: string;
  senderId: string;
  /**
   * 接收者。省略时从会话双方推导（本产品会话恒为 1:1）。
   * 显式传入仅用于调用方已经知道对方的场景，避免多一次会话查询。
   */
  receiverId?: string;
  content: string;
  msgType?: IMMessageType;
}

export interface WriteMessageResult {
  /** IM 消息 id */
  msgId: string;
  seq: number;
}

/**
 * 写一条消息：只写 IM。
 *
 * @throws IM 写入失败时抛出 —— IM 已是用户实际读取的数据源，
 *         它失败就意味着这条消息对用户不存在，调用方必须把错误暴露出来。
 */
export async function writeMessage(params: WriteMessageParams): Promise<WriteMessageResult> {
  const { conversationId, senderId, content, msgType } = params;

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { userAId: true, userBId: true },
  });

  if (!conversation) {
    throw new Error(`[im/write-message] conversation not found: ${conversationId}`);
  }

  const receiverId =
    params.receiverId ??
    (conversation.userAId === senderId ? conversation.userBId : conversation.userAId);

  return await createMessage(conversationId, senderId, receiverId, content, {
    ...(msgType ? { msgType } : {}),
  });
}
