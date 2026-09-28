#!/usr/bin/env node
/**
 * P1-6 双聊天系统合并 · 回归不变式检查（无需编译，纯 Node）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么需要它
 * ═══════════════════════════════════════════════════════════════════════════
 * 本次合并修掉的三个缺陷都属于**同一类**：同一条业务规则在仓库里有多个副本，
 * 改动时只改了其中一处。具体是：
 *
 *   · G-3/G-6  Bot 文案模板 + 分类函数散落在 3 个文件里（逐字重复 90 行），
 *             且 Legacy 分发器分支不检查 BotProfile.sleepUntil / isActive
 *   · 前置检查的列清单与实际 UPDATE 写入的列不一致（漏 4 列）
 *   · npm script `chat:backfill` 硬编码 `--apply`，与 Runbook 描述的
 *             "先看 dry-run 清单" 相反 —— 照文档操作会直接写入生产库
 *
 * 这类缺陷不会让 `tsc` 报错、不会让构建失败，但会在生产上以"静默行为不一致"
 * 的形式出现。因此把不变式固化成可重复运行的检查。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 用法
 * ═══════════════════════════════════════════════════════════════════════════
 *   node scripts/chat-merge/check-invariants.js
 *   # 或
 *   npm run chat:invariants
 *
 * 退出码：全部通过 0，任一失败 1（可直接用作 CI 门禁）。
 *
 * 注意：本检查使用 TypeScript 解析器做**语法 + 文本结构**断言，
 * 它不是 `tsc --noEmit` 的替代品。两者应当都跑。
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/**
 * 用 TypeScript 把 .ts 转成 CommonJS 后加载，用于**运行时**断言导出值。
 *
 * 为什么需要：本检查的一大类不变式是关于"共享定义的内容"（例如
 * `MEANINGFUL_ROOM_CONDITION` 是否覆盖每个 `COPY_FIELDS` 来源列）。
 * 只做文本匹配会得到脆弱的断言（改个格式就失效）；实际调用函数拿到返回值再断言，
 * 才是真正的行为约束。
 *
 * 注意：这些模块只能依赖 node: 内置模块或同目录相对导入 —— 它们不得引入
 * Next.js/Prisma 运行时，否则此处会加载失败（`redis/index.ts` 这类就不在此加载，
 * 改为文本 + 结构断言）。
 */
function loadTsModule(relPath) {
  const abs = path.join(ROOT, relPath);
  const js = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  const localRequire = (spec) => {
    if (spec.startsWith('./') || spec.startsWith('../')) {
      let p = path.resolve(path.dirname(abs), spec);
      if (!fs.existsSync(p) && fs.existsSync(p + '.ts')) p += '.ts';
      return loadTsModule(path.relative(ROOT, p));
    }
    return require(spec);
  };
  new Function('exports', 'module', 'require', js)(mod.exports, mod, localRequire);
  return mod.exports;
}

let ts;
try {
  ts = require(path.join(ROOT, 'node_modules', 'typescript'));
} catch {
  console.error('✗ 找不到 typescript。请先在项目根目录执行 npm install。');
  process.exit(1);
}

let pass = 0;
let fail = 0;

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  \u2713 ' + name);
  } else {
    fail++;
    console.log('  \u2717 ' + name + (extra ? '  \u2192 ' + extra : ''));
  }
}

function section(t) {
  console.log('\n' + t);
}

/**
 * 去掉注释与字符串字面量，只留可执行代码 —— 避免"注释里提到 DROP TABLE"造成误报。
 *
 * ⚠️ 旧实现有两个**真实缺陷**（2026-09-27 修复），都值得记录，因为它们的表现
 *    不是"报错"而是**断言静默失真**（门禁全绿但什么都没检查）：
 *
 *   1. **偏移错位**：旧实现把要剔除的区间用 `src.slice(0,a) + src.slice(b)` **删掉**。
 *      可区间会重复（同一段注释被多个节点各报一次），而区间又是**原始字符串的绝对偏移**。
 *      删掉第一段后，后面所有偏移都往前移了；再按原偏移去删，删掉的就是**错位后的内容**
 *      —— 于是文件被越删越多。实测 `src/lib/im/redis/index.ts` 前半段函数声明整段消失。
 *   2. **遍历了 SourceFile 自身**：`SourceFile.getFullStart()` 是 0，导致"文件头那段
 *      文档注释"被当成 leading comment。对长文档注释（该文件约 8000 字符）尤其致命。
 *
 *   修正：① 区间**去重**；② 用**等长空格替换**而非删除（偏移永不错位，行号亦与原文对齐）；
 *   ③ 只从 `sf.statements` 开始遍历（首个语句的 `getFullStart()` 同样是 0，
 *      因此文件头注释仍会被正确剔除，且不会误伤后续代码）。
 *
 *   为防退化，第 4 节有一条**自检断言**：必须确认输出里含有已知标识符。
 *   否则下游那些"无 DDL / 无 DML"的**否定式**断言会在空串上假通过。
 */
function codeOnly(src, kind) {
  const sf = ts.createSourceFile('x.ts', src, ts.ScriptTarget.Latest, true, kind);
  const seen = new Set();
  const ranges = [];

  const push = (start, end) => {
    if (end <= start) return;
    const key = start + ':' + end;
    if (seen.has(key)) return;
    seen.add(key);
    ranges.push([start, end]);
  };

  const DROP_KINDS = new Set([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.RegularExpressionLiteral,
  ]);

  const visit = (node) => {
    const leading = ts.getLeadingCommentRanges(src, node.getFullStart()) || [];
    const trailing = ts.getTrailingCommentRanges(src, node.getEnd()) || [];
    for (const r of leading) push(r.pos, r.end);
    for (const r of trailing) push(r.pos, r.end);
    if (DROP_KINDS.has(node.kind)) push(node.getStart(), node.getEnd());
    ts.forEachChild(node, visit);
  };

  // 关键：不遍历 SourceFile 自身（见上文缺陷 2）
  for (const stmt of sf.statements) visit(stmt);

  // 从后往前替换为等长空格 —— 等长意味着偏移不会错位，重复/嵌套区间也天然安全
  let out = src;
  for (const [a, b] of ranges.sort((x, y) => y[0] - x[0])) {
    const blanked = out.slice(a, b).replace(/[^\n]/g, ' ');
    out = out.slice(0, a) + blanked + out.slice(b);
  }
  return out;
}

const FILES = [
  'src/lib/im/bot-templates.ts',
  'src/lib/im/bot-gate.ts',
  'src/lib/im/bot-reply.ts',
  // P1-6 阶段 5（2026-09-28）：原 'src/app/api/chat/[id]/messages/route.ts'
  // 已随 Legacy 三表删除而整文件移除，不再参与语法检查。
  'src/app/api/im/send/route.ts',
  'src/app/(dashboard)/dashboard/chats/[roomId]/page-content.tsx',
  'scripts/chat-merge/retire-legacy.ts',
  'scripts/chat-merge/shared/vault-diff.ts',
  'scripts/chat-merge/migrate-vault.ts',
];

console.log('P1-6 合并 · 回归不变式检查');

// ── 0. 语法 ────────────────────────────────────────────────────────────────
section('0. 语法解析');
for (const f of FILES) {
  const src = read(f);
  const kind = f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, kind);
  ok(f, (sf.parseDiagnostics || []).length === 0);
}

// ── 1. G-3/G-6：Bot 模板只有一份 ──────────────────────────────────────────
section('1. G-3/G-6 · Bot 模板单一来源');

const CANARY = 'Hey! Great to match with you!';
const holders = FILES.filter((f) => read(f).includes(CANARY));
ok(
  '模板特征串仅出现在 bot-templates.ts 一处',
  holders.length === 1 && holders[0] === 'src/lib/im/bot-templates.ts',
  '出现于: ' + JSON.stringify(holders),
);

// ── P1-6 阶段 5（2026-09-28）：过渡期分发器已整文件删除 ────────────────────
// 原 'src/app/api/chat/[id]/messages/route.ts'（含 BOT_RESPONSES/KEYWORDS 等
// 9 条"分发器不再内联模板"断言）随 Legacy 三表退场一并删除；
// 其守的"模板单一来源"不变式由上方 CANARY 断言继续覆盖。
// 统一写入入口断言移至 G-11/G-15 节（write-message.ts 已是纯 IM 写入）。

const botReply = read('src/lib/im/bot-reply.ts');
ok('bot-reply 不再持有模板', !botReply.includes(CANARY));
ok('bot-reply 不再自行声明 shouldBotReply 实现体', !/export async function shouldBotReply/.test(botReply));
ok('bot-reply 导入 generateBotResponse', /from "@\/lib\/im\/bot-templates"/.test(botReply));
ok('bot-reply 导入 checkBotReplyEligibility', /import \{ checkBotReplyEligibility \} from "@\/lib\/im\/bot-gate"/.test(botReply));
ok('bot-reply 用 shouldReply 做判定（未把 reason 当布尔）', !/if \(!reason\)/.test(botReply));

const gate = read('src/lib/im/bot-gate.ts');
ok('bot-gate 导出 checkBotReplyEligibility', /export async function checkBotReplyEligibility/.test(gate));
ok('bot-gate 保留 shouldBotReply 兼容别名', /export async function shouldBotReply/.test(gate));
ok('bot-gate 检查 sleepUntil', /sleepUntil/.test(gate));
ok('bot-gate 检查 isActive', /isActive/.test(gate));

// ── 2. G-7：图片消息渲染 ──────────────────────────────────────────────────
section('2. G-7 · 图片消息渲染');
const page = read('src/app/(dashboard)/dashboard/chats/[roomId]/page-content.tsx');
ok('定义 ChatImageBubble', /function ChatImageBubble\(/.test(page));
ok('定义 isRenderableImageUrl', /function isRenderableImageUrl\(/.test(page));
ok('气泡内接上图片分支', /msg\.type === "image" && isRenderableImageUrl\(msg\.content\)/.test(page));
ok('图片加载失败降级为链接', /setBroken\(true\)/.test(page));
ok('外链带 noopener', (page.match(/rel="noopener noreferrer"/g) || []).length >= 2);
ok('文本渲染分支仍保留（不丢内容）', /whitespace-pre-wrap break-words \[word-break:break-word\]/.test(page));

// ── 3. Vault 字段定义单一来源 ─────────────────────────────────────────────
section('3. Vault 字段定义单一来源');
const vdPath = 'scripts/chat-merge/shared/vault-diff.ts';
const vd = read(vdPath);
ok('shared/vault-diff 存在', /export const COPY_FIELDS/.test(vd));

const mv = read('scripts/chat-merge/migrate-vault.ts');
ok('migrate-vault 不再内联 COPY_FIELDS', !/const COPY_FIELDS: ReadonlyArray/.test(mv));
ok('migrate-vault 从 shared 导入', /from '\.\/shared\/vault-diff'/.test(mv));
ok('migrate-vault 前置检查改用共享列清单', /const required = REQUIRED_CONVERSATION_MIGRATION_COLUMNS;/.test(mv));

const js = ts.transpileModule(vd, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'module', js)(mod.exports, mod);
const V = mod.exports;

ok('COPY_FIELDS 共 10 项（Vault 9 + matchId 1，G-10）', V.COPY_FIELDS.length === 10, 'got ' + V.COPY_FIELDS.length);
ok(
  '必需列 = 复制列 + vaultExpiresAt',
  V.REQUIRED_CONVERSATION_MIGRATION_COLUMNS.length === V.COPY_FIELDS.length + 1,
  'got ' + V.REQUIRED_CONVERSATION_MIGRATION_COLUMNS.length,
);
ok(
  '必需列覆盖全部被写入列（含 vaultExpiresAt）',
  V.COPY_FIELDS.every((f) => V.REQUIRED_CONVERSATION_MIGRATION_COLUMNS.includes(f.conv)) &&
    V.REQUIRED_CONVERSATION_MIGRATION_COLUMNS.includes('vaultExpiresAt'),
);
ok(
  '必需列无重复',
  new Set(V.REQUIRED_CONVERSATION_MIGRATION_COLUMNS).size === V.REQUIRED_CONVERSATION_MIGRATION_COLUMNS.length,
);
ok('diff 接受别名参数', V.vaultDiffCondition('c', 'r').startsWith('IFNULL(c."vaultExpiresAt"'));
ok('meaningful 无残留占位符', !/\{r\}/.test(V.meaningfulRoomCondition('q')));

// ── 4. 阶段 5 门禁脚本必须只读 ────────────────────────────────────────────
section('4. 阶段 5 放行门禁');
const rl = read('scripts/chat-merge/retire-legacy.ts');
const rlCode = codeOnly(rl, ts.ScriptKind.TS);
for (const id of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9']) {
  ok('收录门禁 ' + id, rl.includes("id: '" + id + "'"));
}
ok('可执行代码中无 DDL', !/\b(DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE)\b/i.test(rlCode));
ok('可执行代码中无 DML 写入', !/\b(DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO)\b/i.test(rlCode));
ok('默认只读（无 --apply 开关）', !/hasFlag\('apply'\)/.test(rl));
ok('NO-GO 时退出码为 2', /process\.exitCode = 2/.test(rl));
ok('复用共享 Vault 定义', /from '\.\/shared\/vault-diff'/.test(rl));
// 自检：防止 codeOnly 再次退化（本次修复前它曾误删掉半个文件，
// 使上面几条**否定式**断言在空串上假通过）。必须确认可执行代码里
// 确实含有已知标识符，否则下面的"无 DDL / 无 DML"毫无意义。
ok(
  'codeOnly 未失真（含已知标识符且长度合理）',
  /process\.exitCode/.test(rlCode) && rlCode.length > rl.length * 0.3,
  `codeOnly=${rlCode.length} / 原文=${rl.length}`,
);
ok('复用共享回执谓词', /from '\.\/shared\/receipt-coverage'/.test(rl));
ok('复用共享引用扫描器', /from '\.\/shared\/legacy-refs'/.test(rl));
ok('B6 已升级为阻断项（G-2 可无损还原，不应接受丢失）', /id: 'B6'[\s\S]{0,200}?severity: 'block'/.test(rl));

// ── 5. （编号空缺，刻意保留）──────────────────────────────────────────────
// 历史遗留：早期草稿里第 5 节是"Vault 字段清单"，后来并入了第 3 节
// （同一份 `shared/vault-diff.ts` 的导出），但下游编号没有回填。
// **刻意保持空缺而不重排** —— 本文件多处注释按编号互相引用
// （"第 3 节"、"第 4 节"），重排会让那些引用静默指错地方。

// ── 6. G-10 · matchId 迁移目标列 ──────────────────────────────────────────
section('6. G-10 · matchId 迁移（防静默丢失匹配分）');
// V 已在第 3 节加载（同一个 shared/vault-diff.ts），此处直接复用，避免重复加载与重名
ok('COPY_FIELDS 含 matchId', V.COPY_FIELDS.some((f) => f.conv === 'matchId'));
ok(
  '必需列含 matchId（自动派生）',
  V.REQUIRED_CONVERSATION_MIGRATION_COLUMNS.includes('matchId'),
);
ok(
  '必需列数 = 复制字段数 + 1（vaultExpiresAt）',
  V.REQUIRED_CONVERSATION_MIGRATION_COLUMNS.length === V.COPY_FIELDS.length + 1,
  `got ${V.REQUIRED_CONVERSATION_MIGRATION_COLUMNS.length}`,
);
ok(
  '必需列覆盖全部被写入列',
  V.COPY_FIELDS.every((f) => V.REQUIRED_CONVERSATION_MIGRATION_COLUMNS.includes(f.conv)) &&
    V.REQUIRED_CONVERSATION_MIGRATION_COLUMNS.includes('vaultExpiresAt'),
);
ok(
  '必需列无重复',
  new Set(V.REQUIRED_CONVERSATION_MIGRATION_COLUMNS).size ===
    V.REQUIRED_CONVERSATION_MIGRATION_COLUMNS.length,
);
// 「实质持有需迁移数据」的判定必须覆盖每一个复制字段的来源列，
// 否则会出现"字段在差异集里、却没有任何行被判定为需要迁移"的静默漏迁。
const meaningful = V.meaningfulRoomCondition('r');
ok('MEANINGFUL 判定含 matchId', /"matchId"/.test(meaningful));
ok('MEANINGFUL 判定含 vaultStatus', /"vaultStatus"/.test(meaningful));
ok('差异表达式含 matchId', /"matchId"/.test(V.vaultDiffCondition('c', 'r')));
// P0-5：schema 已拆分为多文件目录（core.prisma + bot.prisma），Conversation
// 属核心模型，断言对象指向 core.prisma。
const schemaSrc = read('prisma/schema/core.prisma');
const convModel = schemaSrc.slice(
  schemaSrc.indexOf('model Conversation {'),
  schemaSrc.indexOf('model Conversation {') + schemaSrc.slice(schemaSrc.indexOf('model Conversation {')).indexOf('\n}'),
);
ok('Conversation 模型含 matchId 列', /^\s*matchId\s+String\?/m.test(convModel));
ok('Conversation 保留 chatRoomId 标量列（G-8 旧书签别名）', /^\s*chatRoomId\s+String\?\s+@unique/m.test(convModel));
ok('Conversation 有 matchId 索引', /@@index\(\[matchId\]\)/.test(convModel));

// ── 7. G-8 · 旧书签别名解析（阶段 5 后形态）──────────────────────────────
// ChatRoom 表已删除：路径 3（ChatRoom 实体解析）随之消失；
// 路径 2（Conversation.chatRoomId @unique 别名反查）是旧书签的唯一入口，
// 能力探测保留（反射式、恒 false、编译安全）。
section('7. G-8 · 旧书签永久可解析（阶段 5 后）');
const resolveSrc = read('src/lib/im/resolve.ts');
ok('存在按 chatRoomId 反查的别名路径', /chatRoomId: id, OR: \[/.test(resolveSrc));
ok('ref 暴露 legacyRoomAvailable', /legacyRoomAvailable: boolean/.test(resolveSrc));
ok('ref 暴露 resolvedFrom（可观测）', /resolvedFrom:/.test(resolveSrc));
ok('路径 3 已删除（不再直接查 db.chatRoom）', !/db\.chatRoom\./.test(resolveSrc));
ok('能力探测仍守住残余分支（删表后恒 false，编译安全）', resolveSrc.includes("isLegacyChatModelAvailable('chatRoom')"));
const convRouteSrc = read('src/app/api/im/conversations/[id]/route.ts');
ok('详情端点已无 ChatRoom 富化查询', !/db\.chatRoom\./.test(convRouteSrc));
ok('详情端点仍透出 legacyRoomAvailable（可观测）', /legacyRoomAvailable/.test(convRouteSrc));

// ── 8. G-4 · Redis 降级路径 ───────────────────────────────────────────────
section('8. G-4 · Redis 降级路径可用性');
const redisSrc = read('src/lib/im/redis/index.ts');
const redisCode = codeOnly(redisSrc, ts.ScriptKind.TS);
ok(
  '内存后端为单例（不存在"每次调用新建"的 return）',
  /_memory = createInMemoryFallback\(\)/.test(redisCode) &&
    !/return\s+createInMemoryFallback\(\)/.test(redisCode),
);
ok('导出 getRedisBackend', /export function getRedisBackend/.test(redisCode));
ok('导出 isRedisConfigured', /export function isRedisConfigured/.test(redisCode));
ok('导出 getRedisStatus（供 /api/health 上报）', /export function getRedisStatus/.test(redisCode));
ok('导出 markRedisUnavailable（熔断入口）', /export function markRedisUnavailable/.test(redisCode));
ok('导出 clearRedisDegradation（运维回切）', /export function clearRedisDegradation/.test(redisCode));
ok('导出 probeRedis（主动探测）', /export (?:async )?function probeRedis/.test(redisCode));
ok('熔断窗口内不续期（否则永不回切）', /if \(now < _degradedUntil\) return;/.test(redisCode));
ok('哈希参数归一化（支持 hmset 对象形式）', /normalizeHashArgs/.test(redisCode));
ok('哈希写入为合并语义', /\.\.\.readHash\(key\)/.test(redisCode));
const paceSrc = read('src/lib/im/services/pace-controller.ts');
ok('PaceController 失败时触发熔断', /markRedisUnavailable\(/.test(paceSrc));
const presenceSrc = read('src/lib/im/services/presence-manager.ts');
const guardedCalls = (presenceSrc.match(/onRedisError\(/g) || []).length;
ok('PresenceManager 全部公开方法 fail-open（≥8 处守卫）', guardedCalls >= 8, `got ${guardedCalls}`);
ok('PresenceManager 触发熔断', /markRedisUnavailable\(/.test(presenceSrc));
ok(
  'PresenceManager 不再有裸 await redis 抛错路径',
  /catch \(e\) \{\s*onRedisError/.test(presenceSrc),
);
const healthSrc = read('src/app/api/health/route.ts');
ok('健康检查上报 redis 状态', /getRedisStatus/.test(healthSrc) && /redis: getRedisStatus\(\)/.test(healthSrc));
ok('存在 Redis 降级矩阵文档', fs.existsSync(path.join(ROOT, 'docs/IM-REDIS-DEGRADATION.md')));

// ── 9. G-2 · 已读回执谓词单一来源 ─────────────────────────────────────────
section('9. G-2 · 已读回执迁移');
const RC = loadTsModule('scripts/chat-merge/shared/receipt-coverage.ts');
ok('谓词要求 isRead = 1', /"isRead"\s*=\s*1/.test(RC.RECEIPTS_NEEDED_WHERE));
ok(
  '谓词不含未读分支（未读消息绝不能被建回执）',
  !/"isRead"\s*=\s*0/.test(RC.RECEIPTS_NEEDED_WHERE) && !/isRead"\s*!=\s*1/.test(RC.RECEIPTS_NEEDED_WHERE),
);
ok('谓词要求接收方有效', /"receiverId" IS NOT NULL/.test(RC.RECEIPTS_NEEDED_WHERE));
ok('谓词含 NOT EXISTS（幂等：不重复建）', /NOT EXISTS/.test(RC.RECEIPTS_NEEDED_WHERE));
ok('存在 should-have 上界谓词', /"isRead"\s*=\s*1/.test(RC.RECEIPTS_SHOULD_HAVE_WHERE));
const mrSrc = read('scripts/chat-merge/migrate-receipts.ts');
ok('迁移脚本复用共享谓词', /from '\.\/shared\/receipt-coverage'/.test(mrSrc));
ok('迁移脚本默认 dry-run', !/const APPLY = true/.test(mrSrc) && /hasFlag\('apply'\)/.test(mrSrc));
ok('时间用原值搬运（COALESCE 跨列复制）', /COALESCE\(m\."readAt", m\."createdAt"\)/.test(mrSrc));
// 必须用 codeOnly：这些禁用词会出现在**说明性注释**里（"不用 strftime()/datetime()"），
// 直接匹配原文会把正确实现判成违规 —— 正是 codeOnly 要解决的问题。
ok(
  '禁用 strftime/datetime（会静默抹掉时间）',
  !/\b(strftime|datetime)\s*\(/i.test(codeOnly(mrSrc, ts.ScriptKind.TS)),
);
ok('含反向断言（未读未被误标已读）', /badRows/.test(mrSrc));
ok('有 --verify 复核模式', /--verify/.test(mrSrc) || /VERIFY_ONLY/.test(mrSrc));

// ── 10. B9 · Legacy 引用扫描器 ────────────────────────────────────────────
section('10. B9 · Legacy 引用扫描器');
const LR = loadTsModule('scripts/chat-merge/shared/legacy-refs.ts');
ok('导出 scanLegacyRefs', typeof LR.scanLegacyRefs === 'function');
const refReport = LR.scanLegacyRefs(ROOT);
ok('扫描到文件（>300）', refReport.scannedFiles > 300, String(refReport.scannedFiles));
// ⚠️ 只针对**扫描器自身所在目录**。
//    不能写成 `startsWith('scripts/')` —— `scripts/bot/*`、`scripts/seed-*` 里
//    **确实**有 Legacy 引用（它们是真的阻断项）。把"scripts/ 下没有任何阻断项"
//    当成不变量，会在那些脚本被如实扫出来后误报 —— 而这正是 2026-09-28
//    修好别名漏报后立刻发生的事。
ok(
  '无脚本自身误报（注释/字符串已剔除）',
  !refReport.blockers.some((f) => f.file.startsWith('scripts/chat-merge/')),
  refReport.blockers.filter((f) => f.file.startsWith('scripts/chat-merge/')).map((f) => f.file).join(','),
);

// ⚠️ 扫描器自报误报的**正控**（2026-09-28 新增）。
//    扫描器自己的文件里到处是 "`db.chatRoom`" 这类示例文本，全在注释里 ——
//    所以它必须**零命中**。早期版本用手写字符状态机剔除注释，在第 185 行被
//    正则字面量里的引号（`/['"]…/`）带偏，此后整份文件的注释都不再被识别，
//    于是扫描器给自己报了 1 处误报。
//    注意：它当时被归到 `stage5-branch`（因为本文件里定义了 `@stage5-remove`
//    这个字符串），所以上面那条"无脚本自身误报"的断言**没能**拦住它 ——
//    这正是本条断言存在的理由：看 hits，不看 category。
const selfFile = refReport.files.find((f) => f.file === 'scripts/chat-merge/shared/legacy-refs.ts');
ok(
  '扫描器自身零命中（注释剔除有效 · 正控）',
  !selfFile,
  selfFile ? `命中 ${selfFile.hits.length} 处 @ L${selfFile.hits.map((h) => h.line).join(', L')}` : '',
);

// ── 别名绑定的**正控**（2026-09-28 新增）─────────────────────────────────
// 这 4 个文件用的是**同一个** Prisma 客户端，只是绑定名不叫 `db`：
//   · `import { db as prisma } from '@/lib/db'`  → `prisma.chatRoom`
//   · `db.$transaction(async (tx) => …)`         → `tx.chatRoom`
//   · 注入参数（`config.prisma`，any 类型，静态推不出）→ `prisma.chatRoom`
// 旧扫描器把命中模式硬编码成 `\bdb\.`，于是**全部漏报** —— 门禁会在真正
// NO-GO 时报 GO。实测漏报 10 个文件（含写入路径）。
// 这几条断言一旦失败，说明"绑定发现"被回退了。
// ⚠️ 2026-09-28（第六轮 · G-17）：这里**原先**是一个用真实文件做的正控：
//
//     for (const file of ['bot-engine/schedulers/prisma-adapter.ts',
//                         'api/auto-match/route.ts',
//                         'api/matches/react/route.ts',
//                         'api/chats/route.ts'])
//       ok('别名绑定也能识别', refReport.blockers.some(f => f.file === file))
//
//     它与下方 `cleared` 清单里"这 4 个文件必须**不再**是阻断项"的断言
//     **直接互斥** —— 两条断言作用于同一批文件、要求相反的结果，必然有一条失败。
//     根因是这条正控绑在**仓库的真实状态**上：第五轮把那 4 个文件全改造完，
//     它就自动变成了"要求门禁报错"的断言。而且它还会**诱使人为了修断言去改代码**，
//     把门禁变成自我实现的预言。
//
//     已改为下方**合成夹具**（覆盖 4 种绑定形态，与仓库状态完全解耦）。
//     教训：正控必须验证"扫描器的分辨力"，不能验证"仓库此刻长什么样"。

// 反向断言：扫描器必须**仍然**能发现真实阻断项。
// 若有人靠"加豁免"把门禁刷绿，这几条会失败 —— 这正是我们要防的。
//
// 注意这几条用的是**当前仍是阻断**的文件（业务写入类）。当它们也被改造后，
// 本清单应把它们平移到下面的 `cleared` 里，而不是删除断言 ——
// 断言的作用是"扫描器还有没有分辨力"，删掉就等于放弃验证。
//
// ⚠️ 2026-09-28（第五轮）：真实阻断点已在这一轮全部清零，因此**不能**再拿
//    真实文件当"必须报阻断"的正控 —— 那会与下方"已解除阻断"断言自相矛盾，
//    且一旦有人为了修好这条断言而去改代码，门禁就变成了自我实现的预言。
//
// 改为**合成夹具**：造一个最小的命中文件，验证扫描器仍然：
//   · 认得出**别名绑定**（`db as prisma`）—— 这正是历史上漏报 14 个文件的写法
//   · 对**字符串/注释里的同形文本**不误报（假阳性会让人开始无视门禁）
// 这样做的好处是正控与仓库的真实状态解耦：无论仓库改到什么程度，这条都成立。
//
// ⚠️ 夹具必须放在**仓库内**（`.stage5-probe/`），不能放 `os.tmpdir()`：
//    运行环境（CodeBuddy CLI 的文件代理）会拒绝读取工作区之外的路径，
//    表现为整个进程被 SIGTERM —— 一个"环境限制"被误读成"扫描器坏了"。
//    放在仓库内还有一个好处：它不在 `SCAN_ROOTS`（`src`/`scripts`）里，
//    因此不会污染主扫描结果。
const probeRoot = path.join(ROOT, '.stage5-probe');
let probeReport = null;
let probeErr = '';
try {
  fs.rmSync(probeRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(probeRoot, 'src'), { recursive: true });
  // 夹具刻意覆盖**全部 4 种绑定形态**（分别对应历史上漏报的 4 类写法），
  // 而不是只用其中一种 —— 少了任何一种，"绑定发现"退化成硬编码都测不出来。
  const probeFiles = {
    // ① 别名导入 —— 历史漏报 14 个文件的主因
    'probe-alias.ts': [
      "import { db as prisma } from '@/lib/db';",
      'export async function probeAlias() {',
      '  const n = await prisma.message.count();',
      "  const s = 'prisma.chatRoom.findMany()';", // 字符串里的同形文本：不得命中
      '  // prisma.chatRoomMember.count()', // 注释里的同形文本：不得命中
      '  return n + s.length;',
      '}',
      '',
    ].join('\n'),
    // ② $transaction 的回调形参
    'probe-tx.ts': [
      "import { db } from '@/lib/db';",
      'export async function probeTx() {',
      '  return db.$transaction(async (tx) => tx.chatRoom.count());',
      '}',
      '',
    ].join('\n'),
    // ③ 注入式客户端（参数标成 any，类型系统帮不上忙）—— prisma-adapter.ts 的形态
    'probe-inject.ts': [
      'export async function probeInject(config: any) {',
      '  return config.prisma.chatRoomMember.count();',
      '}',
      '',
    ].join('\n'),
    // ④ 工厂 getDb()
    'probe-factory.ts': [
      "import { getDb } from '@/lib/db';",
      'export async function probeFactory() {',
      '  return getDb().chatRoom.count();',
      '}',
      '',
    ].join('\n'),
  };
  for (const [name, body] of Object.entries(probeFiles)) {
    fs.writeFileSync(path.join(probeRoot, 'src', name), body);
  }
  probeReport = LR.scanLegacyRefs(probeRoot);
} catch (err) {
  probeErr = err && err.message ? err.message : String(err);
} finally {
  try {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  } catch {
    /* 清理失败时下面有一条断言会报出来 */
  }
}
ok('合成正控：夹具已清理', !fs.existsSync(probeRoot), '残留 ' + probeRoot);
ok(
  '合成正控可运行（夹具读取成功）',
  !!probeReport,
  probeErr || '扫描未返回结果',
);
const probeByName = new Map((probeReport?.files ?? []).map((f) => [f.file, f]));

ok(
  '合成正控：4 种绑定形态全部识别为阻断项',
  !!probeReport && probeReport.blockers.length === 4,
  probeReport
    ? `实际阻断 ${probeReport.blockers.length} 个：` +
      probeReport.blockers.map((f) => f.file).join(',')
    : '（无结果）',
);
for (const [file, model, why] of [
  ['src/probe-alias.ts', 'message', 'import { db as prisma }'],
  ['src/probe-tx.ts', 'chatRoom', '$transaction 的 tx'],
  ['src/probe-inject.ts', 'chatRoomMember', '注入参数 config.prisma'],
  ['src/probe-factory.ts', 'chatRoom', '工厂 getDb()'],
]) {
  const f = probeByName.get(file);
  ok(
    `合成正控：别名绑定也能识别（${why}）`,
    !!f && f.category === 'blocker' && f.models.join(',') === model,
    f ? `${f.category} / [${f.models.join(',')}]` : '未生成结果（夹具写失败？）',
  );
}
// 假阳性正控：夹具的 probe-alias.ts 里刻意放了 1 条字符串 + 1 条注释的同形文本，
// 因此它的命中**必须恰好 1 处**（只有真实代码那一行）。这条断言守的是
// "涂白策略" —— 涂白一旦失效，扫描器会开始报不必修的活，然后人就开始无视门禁。
ok(
  '合成正控：字符串/注释里的同形文本不误报',
  probeByName.get('src/probe-alias.ts')?.hits.length === 1,
  probeByName.get('src/probe-alias.ts')
    ? `命中 ${probeByName.get('src/probe-alias.ts').hits.length} 处`
    : '未生成结果',
);

// 正向断言：这批文件已在 P1-6 阶段 5 改造完毕，**必须不再**出现在阻断清单里。
// 分三组记录它们的性质，因为"解除阻断"的三种方式风险等级完全不同：
//   · 统计读取组 → 收敛到 lib/im/stats（读路径，删表后自动退化）
//   · 写入组     → 写入收敛到 lib/im/write-message（IM 主 + Legacy 可选副本）
//   · 整段迁 IM  → 读写都改读终局模型
// 若有人回退改动（比如又把 db.message 写回来），这条会立刻失败 ——
// 这比"文档里写一句已完成"强得多。
for (const cleared of [
  // ── 统计读取（收敛到 lib/im/stats）──
  'src/app/api/admin/analytics/route.ts',
  'src/app/api/admin/analytics/realtime/route.ts',
  'src/app/api/admin/analytics/funnel/route.ts',
  'src/app/api/admin/dashboard/summary/route.ts',
  'src/app/api/bots/status/route.ts',
  'src/app/api/cron/status/route.ts',
  'src/app/api/user/limits/route.ts',
  'src/app/api/dashboard/analytics/route.ts', // 第五轮：unread / messagesThisWeek → stats
  'src/app/api/bot-automation/route.ts', // 第五轮：totalMessages → countMessages()
  // ── 匹配写入（IM 承接完整后，Legacy 写入降级为 @stage5-remove 分支）──
  'src/app/api/matches/[id]/route.ts',
  'src/app/api/matches/inbox/route.ts',
  'src/app/api/matches/react/route.ts', // 第五轮：补能力探测 + 血缘保留
  'src/app/api/requests/[id]/route.ts', // 第五轮：**原先完全没有 IM 写入**（最危险形态）
  'src/app/api/auto-match/route.ts', // 第五轮：顺带修掉 B3 孤儿房（从不写 chatRoomId）
  // ── 旧端点（阶段 5：'src/app/api/chats/route.ts' 兼容壳已整文件删除，
  //    不再列入本清单；unread-count 由 bottom-nav 使用，保留）──
  'src/app/api/chats/unread-count/route.ts', // 第五轮：顺带修 G-14（徽章 sum 翻倍）
  // ── 整段迁到 IM（读写都改读终局模型）──
  'src/lib/bot-learning/scheduler.ts',
  'src/lib/bot-automation.ts',
  'src/lib/automated-testing.ts', // 第五轮：顺带修错路由 /dashboard/chat → /chats
  'src/lib/bot-engine/BotBehaviorEngine.ts',
  'src/lib/bot-engine/schedulers/prisma-adapter.ts',
  'src/app/api/cron/bot-chat/route.ts', // 第五轮：读侧改 vaultStatus 判据 + 写侧走 writeMessage
]) {
  ok('已解除阻断 ' + cleared, !refReport.blockers.some((f) => f.file === cleared));
}

// 死代码清理：`/api/bot/chat` 经全仓核查**零调用方**（前端走 `/api/im/send`，
// 其 `handleBotReply` 已覆盖"立即要一条 Bot 回复"这个用途；cron-runner 也不打它）。
// 删掉它同时消掉一个阻断点 —— 但**必须先证明无调用方**，不能凭感觉删。
ok(
  '死代码 /api/bot/chat 已删除',
  !fs.existsSync(path.join(ROOT, 'src/app/api/bot/chat/route.ts')),
);

// ── G-11 / G-15 · 消息写入的单一入口不变式 ────────────────────────────────
//
// G-11 是什么：阶段 4 把前端换源到 IM 之后，**人类**消息写 IM（用户看得到），
// 而 **Bot 引擎**仍只写 Legacy —— Bot 说的话一条都没进用户实际读的表，
// 且全程静默（接口 200、日志无错、Legacy 数据齐全）。根因是"没有单一写入点"。
//
// G-15 是什么（第五轮）：上一轮建立的 `lib/im/legacy-write.ts` 是 **Legacy 主 +
// 前向镜像**，而 `chat:retire --sql` 的执行清单写的是「关掉 `CHAT_TWIN_WRITE`，
// **让线上不再写 Legacy 表**」。方向与文档相反 —— 照文档操作会让 Bot 消息
// **只写 Legacy、不进 IM**，而前端只读 IM，于是用户连续 24 小时看不到 Bot 消息。
// 本轮把它翻转为 **IM 主 + Legacy 可选副本**（正是 `legacy-write.ts` 自己的
// 模块注释里预告的终局形态），并让"关镜像"这个动作真正等于"停止写 Legacy"。
//
// 翻转之后 `legacy-write.ts` 失去全部调用方，随之删除。下面把新的形态固化：
ok(
  '旧的 Legacy 主写入桥已删除（方向反了，见 G-15）',
  !fs.existsSync(path.join(ROOT, 'src/lib/im/legacy-write.ts')),
);

const writeSrc = read('src/lib/im/write-message.ts');
const writeCode = codeOnly(writeSrc, ts.ScriptKind.TS);
// 只涂白**注释**、保留字符串的视图 —— 需要断言"某个字符串字面量的实参"时必须用它。
// `writeCode` 会把字符串一起涂成空格，拿它去匹配 `isLegacyChatModelAvailable('message')`
// 这类**带字符串实参**的调用会永远不匹配。这正是 G-17 的第二处：
// 一条恒假的断言（门禁上显示 ✗，人只会以为"代码还没改完"）。
const writeNoComments = LR.makeBlankedViews(writeSrc, ts.ScriptKind.TS).commentsBlanked;

// 1) 阶段 5 后（2026-09-28）：本文件必须是**纯 IM 写入入口**。
//    原"IM 优先顺序 / CHAT_TWIN_WRITE 开关 / 表探测 / 血缘回填"四条断言
//    守的都是双写期形态，随 Legacy 副本一并退役；现在的完成态是
//    "Legacy 构造一个都不剩"—— 任何一条被写回来都会在这里当场报错。
const imWriteIdx = writeCode.indexOf('createMessage(');
const legacyWriteIdx = writeCode.indexOf('db.message.create(');
ok('写入入口调用 createMessage（IM 单一写入点）', imWriteIdx >= 0);
ok('Legacy 副本写入已删除（db.message 不再出现）', legacyWriteIdx < 0);
ok('TWIN_WRITE 开关已删除（阶段 5 完成态）', !/TWIN_WRITE_ENABLED/.test(writeCode));
ok('写入路径不再使用能力探测', !/isLegacyChatModelAvailable/.test(writeNoComments));
ok('写入不再回填血缘（B4 已 126/126 收口）', !/legacyMessageId/.test(writeCode));

// 4) Bot 写入点不得再裸调 Legacy 写入，也不得再 import 已删除的桥。
const BARE_LEGACY_WRITE = /\b(?:db|prisma|tx)\s*\.\s*message\s*\.\s*create\b/;
for (const f of [
  'src/app/api/cron/bot-chat/route.ts',
  'src/lib/bot-learning/scheduler.ts',
  'src/lib/bot-engine/BotBehaviorEngine.ts',
  'src/lib/bot-engine/schedulers/prisma-adapter.ts',
  'src/lib/bot-automation.ts',
]) {
  const src = codeOnly(read(f), ts.ScriptKind.TS);
  ok('Bot 写入不裸调 Legacy（已收敛）—— ' + f, !BARE_LEGACY_WRITE.test(src));
}
ok(
  'cron/bot-chat 已改用 IM 优先的写入入口',
  /writeMessage\s*\(/.test(codeOnly(read('src/app/api/cron/bot-chat/route.ts'), ts.ScriptKind.TS)),
);

// ── G-16 · 统一写入入口与待删模块的解耦（阶段 5 后为完成态）────────────────
//
// 历史教训保留：**待删的东西，不能被保留的东西依赖。**
// 阶段 5 已执行：mirror.ts 整文件删除；write-message.ts 的 5 个标注块已消费，
// 因此它从"待删分支"分类里消失是**预期**的 —— 断言随之反转为"不再出现"。
ok(
  'mirror.ts 已整文件删除（阶段 5 完成态）',
  !fs.existsSync(path.join(ROOT, 'src/lib/im/mirror.ts')),
);
ok(
  'write-message.ts 已不在任何 Legacy 分类里（标注已消费）',
  !refReport.blockers.some((f) => f.file === 'src/lib/im/write-message.ts') &&
    !refReport.branchFiles.some((f) => f.file === 'src/lib/im/write-message.ts'),
);
ok(
  'write-message.ts 不依赖待删模块 mirror.ts（G-16 解耦）',
  !/from\s*['"]\.\/mirror['"]/.test(writeNoComments) &&
    !/from\s*['"]@\/lib\/im\/mirror['"]/.test(writeNoComments),
);
// 标注数必须为 0 —— 阶段 5 的执行证据就是"指令形态的标注一个不剩"。
// 只数**指令形态**（`// @stage5-remove` / `* @stage5-remove`），
// 注释里"提到"这个字符串的历史段落不算。
const writeMarkerLines = writeSrc
  .split('\n')
  .filter((l) => /(?:^|\n)[ \t]*(?:\/\/|\*)[ \t]*@stage5-remove\b/.test('\n' + l));
ok(
  'write-message.ts 的 @stage5-remove 指令数归零（阶段 5 已执行）',
  writeMarkerLines.length === 0,
  `实际 ${writeMarkerLines.length} 处`,
);

// 6) G-18：`IMMessageType` ≠ `MessageType`（两套独立枚举，值域不同）。
//    阶段 5 后：Legacy 写入路径（含 IM → Legacy 的 `toLegacyMsgType` 收窄）
//    已随 Legacy 副本删除，完成态是"收窄逻辑不再存在于写入入口"。
//    若有人把 Legacy 写入写回来，本条与上方"db.message 已消失"会一起报错。
ok(
  'write-message.ts 已无 Legacy 枚举收窄与直接赋值（G-18 完成态）',
  !/toLegacyMsgType\s*\(/.test(writeNoComments) &&
    !/messageType:\s*legacyMsgType/.test(writeNoComments) &&
    !/messageType:\s*msgType\b/.test(writeNoComments),
);

// 5) 读侧判据（docs/CHAT-MERGE-AUDIT.md §16.8）：
//    `Conversation.state` 除创建时写 ACTIVE 外**无人写入**（`updateConversationState`
//    导出但零调用），拿它当"未归档"判据等于不过滤 —— 会把已撤销的会话重新纳入
//    Bot 处理队列。正确判据是 `vaultStatus !== 'REVOKED'`。
const botChatCode = codeOnly(read('src/app/api/cron/bot-chat/route.ts'), ts.ScriptKind.TS);
ok('cron/bot-chat 读侧用 vaultStatus 判据（不是 state）', /vaultStatus/.test(botChatCode));
ok('cron/bot-chat 读侧未用 Conversation.state 当过滤条件', !/\bstate\s*:/.test(botChatCode));

// ── G-10 的另一半：创建路径必须真的把 matchId 接上 ────────────────────────
// schema 加了列 ≠ 列表拿得到匹配分。三个匹配路由都必须在 `createConversation`
// 的 options 里带上 matchId，否则 `Conversation.matchId` 恒为 null，
// 而 `lib/im/list.ts` §2.5 的批量回查会一无所获 —— 匹配分静默消失。
for (const f of [
  'src/app/api/matches/react/route.ts',
  'src/app/api/matches/inbox/route.ts',
  'src/app/api/matches/[id]/route.ts',
]) {
  ok(
    'createConversation 传了 matchId —— ' + f,
    /createConversation[\s\S]{0,400}?matchId\s*:/.test(codeOnly(read(f), ts.ScriptKind.TS)),
  );
}

// 阶段 5 后（2026-09-28）：这些文件里的标注块已全部消费，
// 完成态是"既不是阻断项、也不再含 @stage5-remove 标注"。
// 若有人把 Legacy 分支写回来却忘了删标注，第一条会拦住；删了标注却不改代码，
// chat:refs（B9）会拦住 —— 两道闸各管一边。
for (const clearedFile of [
  'src/lib/im/resolve.ts',
  'src/lib/im/list.ts',
  'src/lib/im/message-guards.ts',
  'src/lib/im/stats.ts',
  'src/app/api/im/conversations/[id]/route.ts',
  'src/app/api/matches/[id]/route.ts',
  'src/app/api/matches/inbox/route.ts',
]) {
  ok(
    '阶段 5 完成态（非阻断且无标注）' + clearedFile,
    !refReport.blockers.some((f) => f.file === clearedFile) &&
      !refReport.branchFiles.some((f) => f.file === clearedFile) &&
      !/@stage5-remove/.test(read(clearedFile)),
  );
}
// ⚠️ 这里**原先**写的是 `ok('豁免名单为空（不允许用豁免替代改造）', 三分类之和 > 0)`
//    —— 名字与断言说的不是同一件事（G-17 的第三处）。断言实际在检查"分类非空"。
//    阶段 5 前它守的是"扫描器没有整体失灵"；阶段 5 后三分类**归零就是成功态**，
//    但"扫描器还有没有分辨力"不能跟着丢 —— 那由上方的**合成夹具**正控继续验证。
ok(
  '阶段 5 完成态：全仓 Legacy 引用三分类归零',
  refReport.blockers.length + refReport.branchFiles.length + refReport.deleted.length === 0,
  `阻断 ${refReport.blockers.length} / 分支 ${refReport.branchFiles.length} / 随删 ${refReport.deleted.length}`,
);
// 豁免名单是"连分类都不参与"的白名单 —— 一旦把业务文件加进去，B9 会**完全失明**。
// 唯一合法成员是能力探测库自身。
ok(
  '豁免名单只剩能力探测库自身',
  [...LR.EXEMPT_FILES].join(',') === 'src/lib/im/legacy-capability.ts',
  [...LR.EXEMPT_FILES].join(','),
);
const lrSrc = read('scripts/chat-merge/shared/legacy-refs.ts');
ok('未使用"检测到能力探测即算安全"的启发式', !/GUARD_MARKERS\.find/.test(lrSrc));
ok('使用显式标注 @stage5-remove', lrSrc.includes('STAGE5_BRANCH_MARKER'));

// ── 11. 统计口径 lib/im/stats ─────────────────────────────────────────────
//
// 这一节锁的是 P1-6 阶段 5 第二轮的**核心设计决策**。它们不是"代码风格偏好"，
// 每一条背后都有一个会导致静默数据错误的失效模式 —— 见各断言的说明。
section('11. 统计口径 lib/im/stats');
const statsSrc = read('src/lib/im/stats.ts');

// (a) 五个语义化入口必须齐全（调用方靠它们收敛裸引用）
for (const fn of [
  'countMessages',
  'countDistinctMessageSenders',
  'countConversations',
  'countUserActiveConversations',
  'countActiveBotChats',
]) {
  ok('导出 ' + fn, new RegExp('export async function ' + fn + '\\b').test(statsSrc));
}

// (b/c/d) 阶段 5 后（2026-09-28）：stats 已是**纯 IM 单一口径**。
//    原三条断言守的是双写期口径（能力探测包住 Legacy 分支、max 合并原语、
//    Set 并集去重）—— 双写结束、Legacy 表删除后，"合并"这件事本身消失了。
//    完成态：探测/标注/合并原语一个不剩；任何一条被写回来都说明有人
//    在向已不存在的表发查询。
ok('stats 已无能力探测（纯 IM 口径）', !/isLegacyChatModelAvailable/.test(statsSrc));
ok('stats 已无 @stage5-remove 标注（阶段 5 已执行）', !/@stage5-remove/.test(statsSrc));
ok('max 合并原语已删除（不再有双口径可合并）', !/function maxOf\b/.test(statsSrc));
ok(
  '未用 sum 合并标量计数（回退防护）',
  !/legacyCount\s*\+\s*imCount/.test(statsSrc),
);

// (e) 七个调用方必须已接入本模块，且自身不再出现裸 Legacy 引用。
//     第 (e) 条是 B9 门禁的"局部复刻"，但作用不同：B9 看全仓库，
//     这里盯的是"本轮改造是否被回退" —— 回退时能立刻指名道姓。
const statsCallers = [
  'src/app/api/admin/analytics/route.ts',
  'src/app/api/admin/analytics/realtime/route.ts',
  'src/app/api/admin/analytics/funnel/route.ts',
  'src/app/api/admin/dashboard/summary/route.ts',
  'src/app/api/bots/status/route.ts',
  'src/app/api/cron/status/route.ts',
  'src/app/api/user/limits/route.ts',
];
const BARE_LEGACY = /\bdb\.(chatRoom|chatRoomMember|message)\b/;
// 注意：import 路径是**字符串字面量**，而 `codeOnly` 的 DROP_KINDS 刻意包含
// StringLiteral（否则"无 DML/DDL"类断言会被字符串误报）。因此这一条要在**原文**上
// 匹配，并且必须匹配完整的 `from '...'` 形式 —— 只匹配路径会让"注释里提了一嘴"
// 也算通过，那是无效断言。
const STATS_IMPORT = /from\s+['"]@\/lib\/im\/stats['"]/;
for (const caller of statsCallers) {
  const callerCode = codeOnly(read(caller), ts.ScriptKind.TS);
  ok('已接入 stats —— ' + caller, STATS_IMPORT.test(read(caller)));
  ok('无裸 Legacy 引用 —— ' + caller, !BARE_LEGACY.test(callerCode));
}

// (f) 付费墙口径必须与限额展示同源。
//     user/limits 的"剩余条数"若与实际门禁（message-guards 的 countScopedMessages）
//     各算各的，用户就会看到"还剩 1 条"却被拒发。这里断言它确实复用了同一个函数。
const limitsCode = codeOnly(read('src/app/api/user/limits/route.ts'), ts.ScriptKind.TS);
ok('user/limits 复用 countScopedMessages（与门禁同源）', /countScopedMessages/.test(limitsCode));
ok('user/limits 经 resolveConversationRef 归一化 id', /resolveConversationRef/.test(limitsCode));
ok(
  'user/limits 不再直接计数 Legacy Message',
  !/db\.message\.count/.test(limitsCode),
);

// ── 12. 写入型 Legacy 降级的**前提条件** ─────────────────────────────────
//
// 本轮最重要的安全断言。
//
// `legacy-capability` 的模块注释写着"写入型引用点不得用能力探测豁免"，
// 理由是：跳过一次 Legacy 写入 = 静默丢功能。但这个禁令**有前提** ——
// 它成立于"Legacy 是主数据源"之时。
//
// 一旦 IM 侧承接完整（终局模型可写），Legacy 就退化为兼容副本，
// 此时"Legacy 写入可跳过"是安全的。因此判据不是"有没有加探测"，而是
// "**IM 侧有没有对应的写入**"：
//
//   探测 + IM 写入齐全 → ✅ 安全（Legacy 是可选副本，删表零功能损失）
//   探测 + 无 IM 写入   → 🔴 静默丢功能，**比裸写更危险**（裸写至少会当场报错）
//
// 下面逐个断言该前提，防止后续有人"只加探测、不补 IM 写入"来刷绿门禁。
section('12. 写入型降级的前提（阶段 5 后 = 完成态核验）');
// 历史教训保留：判定标准从来不是"有没有加探测"，而是"IM 侧有没有对应写入"。
// 阶段 5 后：Legacy 分支与探测**整体删除**，完成态 = 只剩 IM 写入、探测与标注归零。
// 若有人把 Legacy 写入写回来，本条与 chat:refs（B9）会一起报错。
for (const f of [
  'src/app/api/matches/[id]/route.ts',
  'src/app/api/matches/inbox/route.ts',
]) {
  const src = read(f);
  const hasImWrite = /createConversation\(/.test(src);
  const legacyLeftover = /isLegacyChatModelAvailable/.test(src) || /@stage5-remove/.test(src);
  ok('IM 侧写入齐全（createConversation）—— ' + f, hasImWrite);
  ok('Legacy 探测与标注已删除（阶段 5 完成态）—— ' + f, !legacyLeftover);
}

// createConversation 的 Vault 参数**必须只落在 create 分支**。
// 若误放进 upsert 的 update 分支，重复接受同一匹配会把一个已被女性用户
// REVOKED（终结对话）的会话重新激活 —— 那是"撤销权失效"的产品事故，
// 且因为不报错，只能靠用户投诉发现。
const convFnSrc = read('src/lib/im/queries.ts');
const convStart = convFnSrc.indexOf('export async function createConversation');
const convEnd = convFnSrc.indexOf('export async function getConversationsByUserId');
const convBody = convStart >= 0 && convEnd > convStart ? convFnSrc.slice(convStart, convEnd) : '';
ok('createConversation 函数体可取（断言前提）', convBody.length > 200, String(convBody.length));
const upsertCreateIdx = convBody.indexOf('create: {');
const upsertUpdateIdx = convBody.indexOf('update: {');
const upsertCreatePart = convBody.slice(upsertCreateIdx, upsertUpdateIdx);
const upsertUpdatePart = convBody.slice(upsertUpdateIdx);
ok('createConversation 接受 Vault 参数', /vaultExpiresAt\?: Date/.test(convBody));
ok(
  'Vault 参数写入 create 分支',
  /vaultExpiresAt/.test(upsertCreatePart) && /vaultStatus/.test(upsertCreatePart),
);
// 判定必须精确到"**赋值**"，不能用 `/vault/i.test(...)`。
// `upsertUpdatePart` 从 `update: {` 一直切到函数末尾（含 `include` 与 return），
// 所以任何注释里出现 "chat:vault:apply" 这类字样都会假失败（2026-09-28 实测踩到）。
// 真正要防的是"update 分支写了 vault 字段"—— 那才会把已 REVOKED 的会话复活。
ok(
  'update 分支不重置 Vault（避免复活已 REVOKED 会话）',
  !/\bvault(Status|ExpiresAt)\s*:/.test(upsertUpdatePart),
  upsertUpdatePart.match(/\bvault(Status|ExpiresAt)\s*:/)?.[0] ?? '',
);

// ── 13. npm scripts ───────────────────────────────────────────────────────
section('13. npm scripts 破坏性语义');
const S = JSON.parse(read('package.json')).scripts;
ok('chat:backfill 是 dry-run（不含 --apply）', !/--apply/.test(S['chat:backfill'] || ''), S['chat:backfill']);
ok('chat:backfill:apply 才含 --apply', /--apply/.test(S['chat:backfill:apply'] || ''));
ok('chat:migrate 是 dry-run', !/--apply/.test(S['chat:migrate'] || ''));
ok('chat:vault 是 dry-run', !/--apply/.test(S['chat:vault'] || ''));
ok('chat:receipts 是 dry-run', !/--apply/.test(S['chat:receipts'] || ''), S['chat:receipts']);
ok('chat:receipts:apply 才含 --apply', /--apply/.test(S['chat:receipts:apply'] || ''));
ok('chat:retire 存在且只读', !!S['chat:retire'] && !/--apply/.test(S['chat:retire']));
ok('chat:retire:sql 存在', !!S['chat:retire:sql']);
ok('chat:refs 存在（B9 独立可跑）', !!S['chat:refs']);
ok('chat:repair 是 dry-run 默认（不含 --apply）', !!S['chat:repair'] && !/--apply/.test(S['chat:repair']), S['chat:repair']);
ok('chat:repair:apply 才含 --apply', /--apply/.test(S['chat:repair:apply'] || ''));
ok('chat:refs:write 存在', !!S['chat:refs:write']);
ok('check:redis 存在（降级路径回归）', !!S['check:redis']);

// ── 14. tsc 可信度 ────────────────────────────────────────────────────────
//
// 2026-09-28 的发现值得固化成断言：这个项目**本来就能跑 `tsc --noEmit`**
// （此前误以为沙箱不可用，于是长期只靠静态扫描）。第一次真跑时报了 25 个错，
// 但其中 5 个是**幻影错误** —— `src/generated` 是 16 天前生成的，落后于
// `schema.prisma`，于是客户端根本不认识 `Conversation.vaultStatus` / `matchId` 等列，
// 报出"属性不存在"。跑一次 `prisma generate` 后那 5 个当场消失。
//
// 反过来说：**生成客户端陈旧 = 类型检查不可信**，它既可能多报（幻影错误），
// 也可能少报（新列的类型约束完全没生效）。所以把"客户端不得陈旧于 schema"
// 固化成断言 —— 它比在文档里写一句"记得先 generate"可靠得多。
section('14. tsc 可信度（生成客户端不得陈旧于 schema）');
// P0-5：schema 拆分为目录后，以 core.prisma + bot.prisma 的最新 mtime 为准 ——
// 任一 schema 文件更新而客户端未重新生成，都视为陈旧。
const schemaDir = path.join(ROOT, 'prisma/schema');
const schemaMtime = fs
  .readdirSync(schemaDir)
  .filter(f => f.endsWith('.prisma'))
  .map(f => fs.statSync(path.join(schemaDir, f)).mtimeMs)
  .reduce((a, b) => Math.max(a, b), 0);
const clientMtime = fs.statSync(path.join(ROOT, 'src/generated/index.d.ts')).mtimeMs;
ok(
  'src/generated 不比 schema（core+bot）旧',
  clientMtime >= schemaMtime,
  `client=${new Date(clientMtime).toISOString()} schema=${new Date(schemaMtime).toISOString()}` +
    ' → 跑 `npx prisma generate`，然后重跑 `npx tsc --noEmit`',
);

// ═══════════════════════════════════════════════════════════════════════════
section('15. 迁移脚本自身的静态缺陷（2026-09-28 首次真跑时暴露）');
// ═══════════════════════════════════════════════════════════════════════════
//
// 这一节的由来：P1-6 数据侧开始真正执行后，暴露出 4 个**脚本自身**的缺陷。
// 共同特征是「干跑/静态读代码都看不出来，只有真跑才炸」，而且其中三个
// 正好长在**门禁**身上 —— 门禁坏掉时人看到的是绿灯，不是红灯。
//
// 所以这里不断言行为（那要连库），只断言**源码里不再出现这几种写法**。

const vaultDiffSrc = read('scripts/chat-merge/shared/vault-diff.ts');
const vaultMigrateSrc = read('scripts/chat-merge/migrate-vault.ts');
const retireSrc = read('scripts/chat-merge/retire-legacy.ts');

// ① 共享 SQL 条件构造函数有别名默认值 → 调用方 SQL 用了别名却不传，静默错位。
//    实测：migrate-vault 的每条 SQL 都写 `FROM "Conversation" c`，
//    却调用 diffCondition()，于是生成 `"Conversation"."vaultExpiresAt"`，
//    SQLite 报 no such column —— 该脚本从未真正跑通过。
ok(
  'vaultDiffCondition 的 convAlias 无默认值（强制调用方声明真实别名）',
  /export function vaultDiffCondition\(\s*convAlias:\s*string\s*,/.test(vaultDiffSrc),
  '加回默认值后，漏传别名不会报错，只会生成表名错位的 SQL',
);
ok(
  'migrate-vault 中不存在无参数的 diffCondition() 调用',
  !/\bdiffCondition\(\)/.test(vaultMigrateSrc),
);

// ② SET 子句引用子查询里的 JOIN 别名 → 纯 SELECT 的干跑通过，--apply 才炸。
ok(
  'migrate-vault 的 UPDATE 改用 UPDATE ... FROM（SET 能引用 ChatRoom 的列）',
  /UPDATE "Conversation"[\s\S]{0,600}?\n\s*FROM "ChatRoom" r/.test(vaultMigrateSrc),
  '旧写法 `UPDATE ... SET x = r.x WHERE id IN (SELECT ... JOIN r ...)` 只在写入时失败',
);

// ③ 读共享接口里已不存在的字段 → 门禁跑到一半 TypeError 崩掉。
//    实测：RefReport 重构后没有 `guarded` 了，retire-legacy 仍在读 refs.guarded.length。
const refReportIface =
  (read('scripts/chat-merge/shared/legacy-refs.ts').match(/export interface RefReport \{([\s\S]*?)\n\}/) || [])[1] || '';
const refReportFields = new Set([...refReportIface.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]));
const usedRefFields = [
  // 先剥掉 `//` 注释行 —— 否则"解释这个 bug 的注释"会把断言弄红。
  // 本轮真实发生过：注释里引用了 refs.guarded 作为反面例子，断言随即误报。
  ...new Set([...retireSrc.replace(/^\s*\/\/.*$/gm, '').matchAll(/\brefs\.(\w+)/g)].map((m) => m[1])),
];
const unknownRefFields = usedRefFields.filter((f) => !refReportFields.has(f));
ok(
  'retire-legacy 只引用 RefReport 中确实存在的字段',
  unknownRefFields.length === 0,
  `未知字段：${unknownRefFields.join(', ')}（现有：${[...refReportFields].join(', ')}）`,
);

// ④ 把同步的 close() 当 Promise 用 → 抛第二个错，真实失败原因被埋掉。
for (const f of [
  'scripts/chat-merge/migrate-vault.ts',
  'scripts/chat-merge/migrate-messages.ts',
  'scripts/chat-merge/migrate-receipts.ts',
  'scripts/chat-merge/retire-legacy.ts',
  'scripts/chat-merge/verify-migration.ts',
]) {
  ok(
    `${f.replace('scripts/chat-merge/', '')} 未把 client.close() 当 Promise（不接 .catch）`,
    !/client\.close\(\)\.catch/.test(read(f)),
  );
}

// ⑤ B3 必须区分「可桥接」与「成员 < 2 的空房间」，
//    否则空房间会让门禁永久卡在 NO-GO（实测：本库有 1 个）。
ok(
  'B3 已区分「可桥接」与「无法桥接的空房间」',
  /unbridgeableRooms/.test(retireSrc),
  'Conversation 需要两个不同用户，成员 < 2 的房间建不出来，删它不丢入口',
);

// ── 汇总 ──────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(fail === 0 ? `✅ 全部通过（${pass} 项）` : `🔴 失败 ${fail} 项 / 通过 ${pass} 项`);
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
