/**
 * ✅ [P1-6 阶段 4 — TARGET/KEEP] IM → UI 形状适配器
 *
 * 为什么需要适配层：
 *
 *   阶段 4 的目标是"**保留已验证的 UI 外壳，只替换数据源**"，以避免同时引入
 *   「新 UI 未验证」+「数据源变更」两层风险（见 docs/CHAT-MERGE-AUDIT.md §10）。
 *
 *   但两套接口的消息形状并不一致：
 *
 *     Legacy `/api/chat/[id]/messages` 返回：
 *       { id, content, senderId, sender:{id,name,avatar,isSelf,isBot}, createdAt, type }
 *
 *     IM `/api/im/messages/[conversationId]` 返回：
 *       { id, content, type, createdAt, sender:{id,name,avatar}, isFromMe, isRead }
 *
 *   差异点（若不适配会直接产生 bug）：
 *     · IM 侧**没有顶层 `senderId`** —— 而 UI 的 `isMessageFromMe()` 靠
 *       `msg.senderId === currentUserId` 判定气泡左右。缺失会导致**所有消息都渲染成对方发的**。
 *     · IM 侧**没有 `sender.isSelf`** —— UI 的第一优先判定条件。
 *     · IM 侧 `type` 是大写枚举（TEXT/IMAGE），UI 期望小写。
 *
 *   适配层把 IM 形状单向映射为 UI 形状，让 page-content.tsx 的数据消费代码保持不变。
 *   阶段 5 Legacy 表删除后，UI 可逐步直接消费 IM 形状，本模块随之退役。
 *
 * @module lib/chat/adapter
 */

/** IM 侧消息（`/api/im/messages/*` 与 `/api/im/send` 的响应形状） */
export interface ImMessageDto {
  id: string;
  content: string;
  type?: string;
  createdAt: string;
  sender?: { id: string; name?: string | null; avatar?: string | null };
  isFromMe?: boolean;
  isRead?: boolean;
  seq?: number;
  clientMsgId?: string;
}

/** UI 层消息（page-content.tsx 的本地 Message 接口） */
export interface UiMessage {
  id: string;
  content: string;
  senderId: string;
  sender?: {
    id: string;
    name: string;
    avatar: string | null;
    isBot?: boolean;
    isSelf?: boolean;
  };
  createdAt: string;
  type?: 'text' | 'image' | 'voice';
  metadata?: unknown;
}

/** IM 枚举（大写）→ UI 字面量（小写）。未知类型归为 text，避免 UI 侧判空。 */
export function normalizeMsgType(type: string | undefined): UiMessage['type'] {
  switch ((type || 'TEXT').toUpperCase()) {
    case 'IMAGE':
      return 'image';
    case 'VOICE':
      return 'voice';
    default:
      return 'text';
  }
}

/**
 * IM 消息 → UI 消息。
 *
 * @param dto            IM 侧消息
 * @param currentUserId  当前登录用户 id。传入后即可精确判定 `isSelf`，
 *                       不依赖服务端 `isFromMe`（更抗序列化差异）。
 */
export function toUiMessage(dto: ImMessageDto, currentUserId?: string): UiMessage {
  const senderId = dto.sender?.id || '';
  const isSelf = currentUserId
    ? senderId === currentUserId
    : !!dto.isFromMe;

  return {
    id: dto.id,
    content: dto.content,
    senderId,
    sender: dto.sender
      ? {
          id: senderId,
          name: dto.sender.name || 'Unknown',
          avatar: dto.sender.avatar ?? null,
          isSelf,
        }
      : undefined,
    createdAt: dto.createdAt,
    type: normalizeMsgType(dto.type),
  };
}

/** 批量映射（保持服务端返回的顺序 —— IM 接口已按 seq 升序 reverse 过） */
export function toUiMessages(dtos: ImMessageDto[], currentUserId?: string): UiMessage[] {
  return dtos.map((d) => toUiMessage(d, currentUserId));
}

/**
 * 从 IM 消息列表中取最大 seq。
 *
 * 用途：增量轮询。传给 `GET /api/im/messages/[conversationId]?afterSeq=N`，
 * 只拉新消息，避免每 5 秒全量重拉（改造前 Legacy 轮询是全量的，随会话增长会退化）。
 *
 * 为什么用 seq 而不是 createdAt：改造前注释已指出，同毫秒消息用时间戳比较会**漏消息**
 * （`createdAt > lastTs` 会跳过同一毫秒内后到的消息）。seq 由服务端在事务内单调递增，
 * 是可靠游标。
 */
export function maxSeq(dtos: ImMessageDto[]): number {
  let max = 0;
  for (const d of dtos) {
    if (typeof d.seq === 'number' && d.seq > max) max = d.seq;
  }
  return max;
}
