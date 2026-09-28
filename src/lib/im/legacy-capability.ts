/**
 * Legacy 聊天表可用性探测 —— 阶段 5「显式降级」开关。
 *
 * ## 为什么需要这个模块
 *
 * 阶段 5 的终点是**从 schema.prisma 删掉 3 个 model**（`ChatRoom` / `ChatRoomMember` / `Message`）。
 * Prisma 客户端**按 schema 代码生成**：model 一移除，`db.chatRoom` 就从"可用的查询委托"
 * 变成 `undefined`，于是每个引用点都会 `TypeError`，或在更早一步被 `tsc` 拦下。
 *
 * ## ⚠️ 本模块的能力边界（必读，避免误用）
 *
 * **它能做**：
 *   · 让运行时行为**显式降级**而不是崩溃 —— 例如 ChatRoom 表被手工删除、
 *     迁移只做了一半、或读库与 schema 版本错配时，代码会走 Conversation 自身字段，
 *     而不是抛异常把一个页面打成 500。
 *   · 把"哪些分支是 Legacy 可选的"变成**可枚举、可审计**的清单
 *     （配合阶段 5 删除标注与 `npm run chat:refs` 的报告）。
 *
 * **它做不到**（不要指望）：
 *   · **不能消除编译期耦合**。守卫只决定"要不要执行"，代码里 `db.chatRoom` 这个
 *     属性访问**依然存在**，schema 删掉 model 后 `npx tsc --noEmit` 照样报
 *     `Property 'chatRoom' does not exist`。要真正让它通过，必须在阶段 5
 *     删掉这些分支本身 —— 它们由阶段 5 删除标注标记，`chat:refs` 会列全。
 *
 * 因此本模块的定位是**降低阶段 5 的风险与不确定性**，不是"删表时零代码改动"。
 * 阶段 5 仍然是一次需要人执行的、有明确清单的发布。
 *
 * ## 使用边界（重要）
 *
 * 「跳过 Legacy 分支」对**读**是安全的（少一个富化来源，值退化为 Conversation 自身的列）；
 * 对**写**是不安全的 —— 跳过一次 Legacy 写入可能等于**静默丢功能**。
 *
 * 因此只应在「Legacy 已是可选来源」的地方使用（列表富化、详情富化、Vault 取值回退），
 * 并同时在该分支上标阶段 5 删除标注。
 * **写入型引用点（bot/cron/匹配/限额）不得用本模块豁免**，必须先真正迁到 IM 侧
 * —— 它们由 `npm run chat:refs` 逐条列出（阶段 5 的 B9 门禁）。
 *
 * @module lib/im/legacy-capability
 */

import { db } from '@/lib/db';

/** Legacy 三表在 Prisma 客户端上的属性名 */
export type LegacyChatModel = 'chatRoom' | 'chatRoomMember' | 'message';

/** Legacy 三表的中文名，用于日志与门禁输出 */
export const LEGACY_MODEL_LABELS: Record<LegacyChatModel, string> = {
  chatRoom: 'ChatRoom（房间 / Vault 事实来源）',
  chatRoomMember: 'ChatRoomMember（成员 / 已读位）',
  message: 'Message（消息实体）',
};

/**
 * 探测单个 Legacy model 在当前 Prisma 客户端上是否可用。
 *
 * 实现刻意不用 try/catch：Prisma 对未定义的 model 返回 `undefined` 而非抛错，
 * 直接判类型即可，无需触发任何数据库访问（零成本、无副作用）。
 */
export function isLegacyChatModelAvailable(model: LegacyChatModel): boolean {
  const client = db as unknown as Record<string, unknown>;
  const delegate = client[model];
  return typeof delegate === 'object' && delegate !== null;
}

/** 三表是否**全部**可用（阶段 5 之前恒为 true） */
export function hasLegacyChatTables(): boolean {
  return (
    isLegacyChatModelAvailable('chatRoom') &&
    isLegacyChatModelAvailable('chatRoomMember') &&
    isLegacyChatModelAvailable('message')
  );
}

/** 当前缺失的 Legacy model 列表（阶段 5 之后应等于全部三项） */
export function missingLegacyChatModels(): LegacyChatModel[] {
  return (['chatRoom', 'chatRoomMember', 'message'] as const).filter(
    (m) => !isLegacyChatModelAvailable(m),
  );
}

/**
 * 一次性的启动日志（便于线上确认当前处于哪一侧）。
 *
 * 只在首次调用时输出，避免在热点路径上刷屏。
 */
let _logged = false;

export function logLegacyCapabilityOnce(): void {
  if (_logged) return;
  _logged = true;

  const missing = missingLegacyChatModels();
  if (missing.length === 0) {
    console.log('[IM] Legacy 聊天表可用（阶段 5 未执行）—— 富化路径将继续读取 ChatRoom');
  } else {
    console.log(
      `[IM] Legacy 聊天表已移除：${missing.map((m) => LEGACY_MODEL_LABELS[m]).join('、')}` +
        ' —— 富化路径自动降级为纯 Conversation',
    );
  }
}
