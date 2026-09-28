/**
 * P1-6 双聊天系统合并 —— `ChatRoom → Conversation` 迁移字段清单的唯一数据源
 *
 * 为什么单独成文件：
 *   阶段 4 的 `migrate-vault.ts` 与阶段 5 的 `retire-legacy.ts` 都需要回答同一个问题
 *   ——「某个会话的字段是否已经与来源 `ChatRoom` 一致」。
 *   如果各自维护一份字段清单，就会重演本任务刚刚修掉的缺陷模式
 *   （G-3：同一套定义散落在三处，改一处必漏其余）。
 *
 *   因此字段清单、语义判定、差异表达式全部收敛到这里。
 *   **将来 ChatRoom 上新增任何需要保留的字段，只需改这一个文件。**
 *
 * 文件名的历史遗留：最初只为 Vault 状态机而建，阶段 5 起也承载「桥接标量」
 * （`matchId`，G-10）。清单本身是通用的，只是 Vault 占绝大多数。
 *
 * @module scripts/chat-merge/shared/vault-diff
 */

/**
 * 直接复制型字段（SQL 内**原值搬运**，时间不做任何解析）。
 *
 * ⚠️ 时间列处理约束（本库是 libSQL/SQLite，Prisma 的 DateTime 底层可能是 TEXT 或 INTEGER）：
 *   · 绝不在 JS 里构造时间值再写回 —— 一律 `UPDATE ... SET col = r.col`
 *   · 比较只在 SQL 内进行，且只比较同源同格式的两个列
 *   · **禁用 `strftime()` / `datetime()`** —— 对非文本存储返回 NULL，会静默抹掉审计时间
 *
 * `vaultExpiresAt` 不在此列 —— 它需要 COALESCE 保护（ChatRoom 有值优先，
 * 否则保留 Conversation 既有值），由调用方单独拼装。
 *
 * `matchId`（G-10）是唯一非 Vault 的条目：它承载会话列表的「匹配分」入口，
 * 漏迁会让 UI 静默少一块（详见 prisma/schema.prisma 的 Conversation 注释）。
 */
export const COPY_FIELDS: ReadonlyArray<{
  room: string;
  conv: string;
  kind: 'text' | 'int' | 'time';
}> = [
  { room: 'vaultStatus', conv: 'vaultStatus', kind: 'text' },
  { room: 'extensionCount', conv: 'extensionCount', kind: 'int' },
  { room: 'extendedAt', conv: 'extendedAt', kind: 'time' },
  { room: 'extendedBy', conv: 'extendedBy', kind: 'text' },
  { room: 'revokedAt', conv: 'revokedAt', kind: 'time' },
  { room: 'revokedBy', conv: 'revokedBy', kind: 'text' },
  { room: 'revokeReason', conv: 'revokeReason', kind: 'text' },
  { room: 'screenshotCount', conv: 'screenshotCount', kind: 'int' },
  { room: 'lastScreenshotAt', conv: 'lastScreenshotAt', kind: 'time' },
  // ── 桥接标量（G-10）：非 Vault，但同样"不迁就丢" ──
  { room: 'matchId', conv: 'matchId', kind: 'text' },
];

/**
 * 「该房间真的持有需要迁移的数据」的判定 —— 任一字段脱离默认值即成立。
 *
 * 用途：区分「实质性未迁移」（会丢能力，必须阻断阶段 5）
 *       与「仅默认值表示差异」（如 NULL vs 'ACTIVE'、NULL vs 0，不影响语义）。
 * 没有这层区分，`ACTIVE` 与 NULL 的表示差异会被误报成数据丢失，
 * 门禁会永远红 —— 而人一旦开始习惯性忽略门禁，门禁就等于不存在。
 *
 * ⚠️ 新增 `COPY_FIELDS` 条目时**必须同步本模板**：模板决定"哪些行需要迁移"，
 *    漏了对应判据，就会出现"字段在差异集里、却没有任何行被判定为需要迁移"的静默漏迁。
 *    `npm run chat:invariants` 会断言两者一致。
 *
 * 占位符 `{r}` 会被替换为 ChatRoom 的 SQL 别名（含引号）。
 */
export const MEANINGFUL_ROOM_CONDITION_TEMPLATE = `(
  {r}."vaultExpiry" IS NOT NULL
  OR {r}."vaultStatus" NOT IN ('ACTIVE')
  OR IFNULL({r}."extensionCount", 0) > 0
  OR IFNULL({r}."screenshotCount", 0) > 0
  OR {r}."revokedAt" IS NOT NULL
  OR {r}."extendedAt" IS NOT NULL
  OR {r}."matchId" IS NOT NULL
)`;

/** 用给定别名生成「实质使用过 Vault」表达式 */
export function meaningfulRoomCondition(roomAlias = 'r'): string {
  return MEANINGFUL_ROOM_CONDITION_TEMPLATE.replaceAll('{r}', roomAlias);
}

/** 默认别名下的表达式（兼容既有调用点） */
export const MEANINGFUL_ROOM_CONDITION = meaningfulRoomCondition('r');

/**
 * 生成「Conversation 与来源 ChatRoom 的 Vault 字段存在差异」的 SQL 条件。
 *
 * 整数列用 `-1` 作哨兵（`IFNULL(x, -1)`），避免 `NULL <> 0` 这类
 * 在 SQL 三值逻辑下结果为 UNKNOWN（既不真也不假）而漏判的陷阱。
 *
 * ⚠️ `convAlias` **必填，且必须与调用方 SQL 里实际使用的别名一致**。
 *
 * 这里曾经有个默认值 `'"Conversation"'`，配套的注释还写着
 * "migrate-vault.ts 中未加别名，直接用表名" —— 但事实上 migrate-vault.ts 的
 * 每一条 SQL 都写的是 `FROM "Conversation" c`。SQLite 一旦给表起了别名，
 * 原表名就不再可用，于是每次预演都抛：
 *
 *     SQLite input error: no such column: Conversation.vaultExpiresAt
 *
 * 也就是说**该脚本从未真正跑通过**，而"注释与代码互相矛盾 + 有默认值可以偷懒"
 * 让这个问题一直没被发现（`retire-legacy.ts` 传了别名所以是好的，
 * 两边行为分叉后差异被掩盖）。
 *
 * 现在取消默认值：调用方必须显式声明别名，由编译器盯着这件事。
 *
 * @param convAlias Conversation 的 SQL 别名（必填，例如 `'c'`）
 * @param roomAlias ChatRoom 的 SQL 别名
 */
export function vaultDiffCondition(convAlias: string, roomAlias = 'r'): string {
  const parts: string[] = [];

  parts.push(
    `IFNULL(${convAlias}."vaultExpiresAt",'') <> IFNULL(${roomAlias}."vaultExpiry",'')`,
  );

  for (const f of COPY_FIELDS) {
    if (f.kind === 'int') {
      parts.push(
        `IFNULL(${convAlias}."${f.conv}", -1) <> IFNULL(${roomAlias}."${f.room}", -1)`,
      );
    } else {
      parts.push(
        `IFNULL(${convAlias}."${f.conv}",'') <> IFNULL(${roomAlias}."${f.room}",'')`,
      );
    }
  }

  return parts.join(' OR ');
}

/**
 * Conversation 上「迁移所必需」的列（`migrate-vault.ts` 与 `retire-legacy.ts` 的前置检查用）。
 *
 * ⚠️ 必须覆盖 `UPDATE` 语句会写到的**每一列**，否则闸门形同虚设：
 *    改造前 `migrate-vault.ts` 只检查了 6 列，漏掉 `extendedAt` / `extendedBy` /
 *    `lastScreenshotAt` / `vaultExpiresAt` —— 任缺其一，预演会通过而 `--apply`
 *    会在 UPDATE 中途失败（部分列已写、部分未写），**留下一个"迁了一半"的中间态**。
 *
 * 本清单由 `COPY_FIELDS` 的全部目标列 + `vaultExpiresAt` 组成。
 * 新增复制字段时**无需手动同步**（下方自动派生）。
 *
 * 命名：原名 `REQUIRED_CONVERSATION_VAULT_COLUMNS` 已不够准确（G-10 起含 `matchId`），
 * 重命名以反映"迁移字段"这一真实语义，避免读者以为只管 Vault。
 */
export const REQUIRED_CONVERSATION_MIGRATION_COLUMNS: readonly string[] = [
  'vaultExpiresAt',
  ...COPY_FIELDS.map((f) => f.conv),
];
