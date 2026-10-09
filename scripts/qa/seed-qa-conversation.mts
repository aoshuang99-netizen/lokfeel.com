/**
 * 为 QA 双账号建立会话（幂等），使聊天页可渲染——用于生产端到端 UI 验证。
 *
 * 为什么需要：`/dashboard/chats/[roomId]` 的通话按钮只有在**存在会话**时才会渲染。
 * QA 账号每次清理重建后 id 会变，旧会话的 participant 行不再匹配，因此需要重新建。
 *
 * 用法：npx tsx scripts/qa/seed-qa-conversation.mts
 * 输出：会话 id（供 QA_CONV 使用）
 *
 * ⚠️ 必须先注入 env 再**动态** import `@/lib/db`：ESM 的静态 import 会被提升到
 *    模块顶部执行，那时 DATABASE_URL 还没写入 process.env → Prisma 报 `URL_INVALID`。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');

/** 极简 dotenv：解析 `KEY=value`（值两端引号会被剥掉）。 */
function parseEnv(f: string): Record<string, string> {
  const o: Record<string, string> = {};
  if (!fs.existsSync(f)) return o;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return o;
}
const env: Record<string, string> = {
  ...parseEnv(path.join(root, '.env')),
  ...parseEnv(path.join(root, '.env.local')),
};
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;
if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL（检查 .env / .env.local）');
  process.exit(2);
}

const { db } = await import('@/lib/db');
const { createConversation, createMessage } = await import('@/lib/im/queries');

const male = await db.user.findUnique({ where: { email: 'qa.male@lokfeel.com' }, select: { id: true } });
const female = await db.user.findUnique({ where: { email: 'qa.female@lokfeel.com' }, select: { id: true } });
if (!male || !female) {
  console.error('缺少 QA 账号，先跑 scripts/qa/create-qa-accounts.mjs');
  process.exit(2);
}
console.log(`male=${male.id}\nfemale=${female.id}`);

const conv = await createConversation(male.id, female.id, male.id);
// `ConversationPayload.convId` 类型上是必填 string —— 之前的
// `?? conv.id ?? conv.conversationId ?? conv.conversation.id` 全是无效兜底
// （那些属性不存在，TS 直接报 2339）。留一个运行期兜底即可。
const conversationId: string | undefined = conv.convId;
if (!conversationId) {
  console.error('未能取得会话 id：', JSON.stringify(conv).slice(0, 300));
  process.exit(3);
}
console.log(`会话 id：${conversationId}`);

// 会话列表与聊天页通常需要至少有 1 条消息才会正常渲染
// ⚠️ 只有 IMMessage 这一张表（`db.message` 是 Legacy 表，模型已不存在，
//    写 `db.iMMessage ?? db.message` 会直接报 TS2551）。
let existing = 0;
try {
  existing = await db.iMMessage.count({ where: { conversationId } });
} catch {
  existing = 0;
}
if (existing === 0) {
  await createMessage(conversationId, male.id, female.id, 'Hi! QA baseline message for UI verification.');
  console.log('已写入 1 条种子消息');
} else {
  console.log(`已有 ${existing} 条消息，跳过写入`);
}

console.log(`\nQA_CONV=${conversationId}`);
process.exit(0);
