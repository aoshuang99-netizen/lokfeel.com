/**
 * Legacy 聊天表代码引用扫描器（静态：不连库、不编译项目）
 *
 * 依赖 TypeScript **仅用于逐文件词法分析**（找出注释/字符串/正则的区间），
 * 不参与项目编译，也不需要 `tsconfig` 或 `tsc` 可用。
 *
 * ## 为什么需要它
 *
 * 阶段 5 的原始计划只有一个数据视角的门禁：**"数据迁完了就能删表"**。
 * 这个判断漏掉了另一半事实 —— **删表还会打断代码**。
 *
 * Prisma 客户端是按 `schema.prisma` 生成的：model 一移除，`db.chatRoom` 就从
 * 「一个可用的查询委托」变成 `undefined`。于是每一个引用点都会变成
 * `TypeError: Cannot read properties of undefined (reading 'findMany')`，
 * 或者更早一步，在 `npx tsc --noEmit` 时报 `Property 'chatRoom' does not exist`。
 *
 * 实测（2026-09-27）：聊天合并之外仍有 16 个文件在读写在用这三张表，
 * 覆盖定时任务（Bot 主动搭话）、匹配创建、用户限额、后台分析看板、Bot 学习调度。
 * 它们**不在** P1-6 的改造范围内，因此不可能靠"聊天模块改完了"就宣布可删。
 *
 * ## 分类规则（三类，人工可审计）
 *
 * | 分类 | 判据 | 是否阻断阶段 5 |
 * |---|---|---|
 * | `stage5-deleted` | 路径在 `STAGE5_DELETED_PATTERNS` 内（Legacy 聊天端点整文件删除） | 否 |
 * | `stage5-branch`  | 文件含显式标注 `@stage5-remove`（本地有已降级的分支待删） | 否 |
 * | `blocker`        | 其余全部 | **是** |
 *
 * 分类刻意用**保守默认**：没被显式识别的前两类，一律算 `blocker`。
 * 宁可多报，也不能漏 —— 漏一个就是一次线上 500。
 *
 * ### 为什么用显式标注而不是"检测到能力探测函数就当安全"
 *
 * 早期版本把「文件里出现 `isLegacyChatModelAvailable`」视为已降级。这是错的：
 * 一个文件完全可能**只在某一条分支**上加了探测，另一条分支照样裸用。这种启发式
 * 会把真实阻断项静默洗白 —— 而门禁一旦会漏报，就等于不存在。
 * 显式标注（`// @stage5-remove`）要求改代码的人**自己声明**"这里是可选分支"，
 * 责任归属清晰，且标注位置会进入代码 review 视野。
 *
 * ⚠️ `blocker` 不等于"必须重写"：有的只需改成读 IM 表，有的应当整段删除。
 *    本扫描器只负责**把它们一条不漏地列出来**，不替人做决定。
 *
 * ## 已知局限
 *
 * ### ① 客户端别名 —— 2026-09-28 修复的一处真实漏报 🔴
 *
 * 早期版本把命中模式硬编码成 `\bdb\.(chatRoom|chatRoomMember|message)\b`，
 * 也就是**只认 `db` 这一个变量名**。但本仓库的 Prisma 客户端有四种绑定形态：
 *
 * | 形态 | 例子 | 旧扫描器 |
 * |---|---|---|
 * | 直接导入 | `import { db } from '@/lib/db'` → `db.chatRoom` | ✅ 命中 |
 * | 别名导入 | `import { db as prisma } from '@/lib/db'` → `prisma.chatRoom` | ❌ **漏报** |
 * | 工厂调用 | `import { getDb } from '@/lib/db'` → `getDb().chatRoom` | ❌ **漏报** |
 * | 事务 / 注入参数 | `$transaction(async (tx) => tx.chatRoom…)`、`config.prisma.chatRoom` | ❌ **漏报** |
 *
 * 注意第二行：`src/lib/prisma.ts` 的内容就是 `export { getDb, db as prisma } from "./db"`
 * —— `prisma` 与 `db` **是同一个实例**，所以这纯粹是扫描器的盲区，不是另一种客户端。
 *
 * 后果不是噪音，而是**假阴性**：门禁会在真正 NO-GO 时报 GO。实测漏报了 10 个文件的
 * Legacy 硬依赖（`matches/react`、`requests/[id]`、`chats/*`、`bot-engine/*`、
 * `bot-automation`、`automated-testing` 等），其中数条是**写入**路径。
 * 一个会漏报的门禁比没有门禁更危险 —— 它给人以安全感。
 *
 * 修法：先从源码**发现**客户端绑定（导入的本地名 + `$transaction` 的形参），
 * 再叠加一份保守的注入参数名清单（客户端可能来自 `any` 类型的配置对象，
 * 静态推断不出来，例如 `bot-engine/schedulers/prisma-adapter.ts` 的 `config.prisma`）。
 *
 * ### ② 注释剔除改成「用解析器打洞」—— 2026-09-28 修复的第二处真实缺陷 🔴
 *
 * 早期版本用一个约 60 行的**手写字符状态机**剔除注释（只跟踪 `inLine` /
 * `inBlock` / `quote` 三个状态）。它在本文件第 185 行被彻底带偏：
 *
 * ```ts
 * const CLIENT_MODULE_RE = /['"](?:@\/lib\/(?:db|prisma)|…)/;
 * //                        ↑ 正则字面量里的引号
 * ```
 *
 * 状态机看到 `'` 就以为进入字符串，此后**整份文件的注释都不再被识别** —— 于是
 * 第 300 行模块文档里的 `db.chatRoom` 被当成真实引用，扫描器**给自己报了误报**。
 *
 * 两处后果叠加起来正好说明为什么不能手写词法器：
 *   · 坑 ①（别名）造成**假阴性** —— 门禁在真正 NO-GO 时报 GO
 *   · 坑 ②（引号）造成**假阳性** —— 门禁报出不必修的活，人开始不信任它
 *
 * 而"没人看的门禁等于不存在"。手写词法器要正确处理正则字面量、模板字面量、
 * 嵌套模板、正则里的 `//`，等价于重新实现一遍 JS 词法规则 —— 而本仓库已经装了
 * 一个正确的实现（TypeScript）。因此改为**只做区间打洞**：解析器负责指出
 * 注释/字符串在哪，我们只把它们涂成等长空格。
 *
 * ### ③ 本扫描器**不能**替代 tsc
 *
 * 2026-09-28 起项目已能真跑 `npx tsc --noEmit`（此前被沙箱拦住，误以为不可用）。
 * 因此阶段 5 的正确验证顺序是：`chat:refs` 看**还有多少活**，`tsc` 看**有没有错**。
 * 两者都要，缺一不可：扫描器会漏（别名、动态属性），tsc 只在你已经改坏时才出声。
 *
 * @module scripts/chat-merge/shared/legacy-refs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

// ═══════════════════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════════════════

export type RefCategory = 'blocker' | 'stage5-branch' | 'stage5-deleted';

export interface RefHit {
  /** 相对仓库根的路径 */
  file: string;
  /** 1-based 行号 */
  line: number;
  /** 命中的 Legacy model 属性名 */
  model: string;
  /** 该行去掉首尾空白后的原文（截断到 160 字符） */
  text: string;
}

export interface FileRefs {
  file: string;
  category: RefCategory;
  models: string[];
  hits: RefHit[];
  /** 分类依据，供人工复核 */
  reason: string;
}

export interface RefReport {
  root: string;
  scannedFiles: number;
  files: FileRefs[];
  blockers: FileRefs[];
  /** 已降级、待阶段 5 删除的分支所在文件 */
  branchFiles: FileRefs[];
  deleted: FileRefs[];
  totalHits: number;
  /** 供门禁使用的判定 */
  ok: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════════════════

/** 被扫描的根目录（相对仓库根） */
const SCAN_ROOTS = ['src', 'scripts'];

/** 扫描的扩展名 */
const EXTENSIONS = ['.ts', '.tsx'];

/** 跳过的目录（构建产物、依赖、缓存） */
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
]);

/** Legacy 三表在 Prisma 客户端上的属性名 */
const LEGACY_MODELS = ['chatRoom', 'chatRoomMember', 'message'] as const;

/** 三个模型名的正则备选串（`\b` 边界确保 `message` 不命中 `messageReceipt`） */
const MODEL_ALT = LEGACY_MODELS.join('|');

/**
 * 保守的「注入式客户端」标识符名清单。
 *
 * 为什么要靠名单：客户端也可以作为**参数**传进来，此时静态推断不出它的类型。
 * 真实例子 —— `src/lib/bot-engine/schedulers/prisma-adapter.ts`：
 *
 * ```ts
 * export interface PrismaDbAdapterConfig { prisma?: any }
 * export function createPrismaAdapter(config: PrismaDbAdapterConfig) {
 *   const prisma = config.prisma ?? new PrismaClient();   // ← 由此开始 prisma.chatRoom 才是查询
 * ```
 *
 * 配置项被标成 `any`，所以类型系统也帮不上忙。名单里的名字在本仓库都只用作
 * Prisma 客户端（已人工核对），不会把 `error.message` 这类普通属性访问算成引用。
 */
const CLIENT_NAME_HINTS: ReadonlyArray<string> = [
  'db',
  'prisma',
  'tx',
  'client',
  'prismaClient',
  'txClient',
];

/**
 * Prisma 客户端的**工厂/单例 getter**：`getDb().chatRoom` 这种调用形态。
 * 这些名字不是绑定，而是函数，不能进 `CLIENT_NAME_HINTS`。
 */
const CLIENT_FACTORY_CALLS: ReadonlyArray<string> = ['getDb'];

/** 会 re-export Prisma 客户端的模块（相对导入与路径别名两种写法） */
const CLIENT_MODULE_RE =
  /['"](?:@\/lib\/(?:db|prisma)|(?:\.{1,2}\/)+(?:lib\/)?(?:db|prisma))['"]/;

/**
 * 从源码中**发现**本文件用到的 Prisma 客户端绑定名。
 *
 * 只做两件确定的事 + 一份保守名单：
 *   1. `import { db } from '@/lib/db'` / `import { db as prisma } from '@/lib/prisma'`
 *      —— 取**本地名**（`as` 之后的名字）
 *   2. `$transaction(async (tx) => …)` —— 取回调形参名
 *   3. 叠加 `CLIENT_NAME_HINTS`（覆盖注入式客户端）
 *
 * 传入的 `code` 必须已经过 `stripComments`，否则注释里的示例会被当成真实导入。
 */
function discoverClientBindings(code: string): Set<string> {
  const names = new Set<string>(CLIENT_NAME_HINTS);

  // 1) import { a, b as c } from '@/lib/db' | '@/lib/prisma' | './db' …
  const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*([^;\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(code)) !== null) {
    const modulePart = m[2];
    if (!CLIENT_MODULE_RE.test(modulePart)) continue;

    for (const rawSpec of m[1].split(',')) {
      const spec = rawSpec.trim();
      if (!spec) continue;

      const [importedRaw, localRaw] = spec.split(/\s+as\s+/);
      const imported = (importedRaw ?? '').trim().replace(/^type\s+/, '');
      // `getDb` 是函数不是客户端 —— 它的调用形态由 CLIENT_FACTORY_CALLS 单独处理
      if (CLIENT_FACTORY_CALLS.includes(imported)) continue;

      const local = (localRaw ?? imported).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(local)) names.add(local);
    }
  }

  // 默认导入：import prisma from '@/lib/prisma'
  const defaultImportRe = /import\s+([A-Za-z_$][\w$]*)\s+from\s*([^;\n]+)/g;
  while ((m = defaultImportRe.exec(code)) !== null) {
    if (!CLIENT_MODULE_RE.test(m[2])) continue;
    if (/^[A-Za-z_$][\w$]*$/.test(m[1])) names.add(m[1]);
  }

  // 2) db.$transaction(async (tx) => …) —— tx 也是客户端
  const txRe = /\$transaction\s*\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)/g;
  while ((m = txRe.exec(code)) !== null) names.add(m[1]);

  return names;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 按**本文件发现到的绑定名**构造命中模式。
 *
 * 形态：`<客户端名>.<模型>` 或 `getDb().<模型>`。
 */
function buildHitPattern(names: Iterable<string>): RegExp {
  const bindingAlt = [...names].map(escapeRe).join('|');
  const factoryAlt = CLIENT_FACTORY_CALLS.map(escapeRe).join('|');

  const left = [
    bindingAlt ? `\\b(?:${bindingAlt})\\s*\\.\\s*` : null,
    factoryAlt ? `\\b(?:${factoryAlt})\\s*\\(\\s*\\)\\s*\\.\\s*` : null,
  ]
    .filter(Boolean)
    .join('|');

  return new RegExp(`(?:${left})(${MODEL_ALT})\\b`, 'g');
}

/**
 * 阶段 5 会**整文件删除**的路径（Legacy 聊天端点）。
 * 这些文件里的引用不算阻断项 —— 它们随表一起消失。
 */
const STAGE5_DELETED_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  {
    re: /^src\/app\/api\/chat\/\[id\]\/messages\/route\.ts$/,
    reason: 'Legacy 消息端点（阶段 5 随表整文件删除）',
  },
  {
    re: /^src\/app\/api\/chat\/\[id\]\/route\.ts$/,
    reason: 'Legacy 会话详情端点（阶段 5 随表整文件删除）',
  },
  {
    re: /^src\/app\/api\/chat\/\[id\]\/vault\/route\.ts$/,
    reason: 'Legacy Vault 端点（阶段 5 随表整文件删除；Vault 已迁到 /api/im/*）',
  },
  {
    re: /^src\/app\/api\/chat\/route\.ts$/,
    reason: 'Legacy 会话列表兼容壳（阶段 4 已降级为转发 /api/im/conversations）',
  },
];

/**
 * 「本文件内的 Legacy 引用位于已降级分支」的**显式标注**。
 *
 * 必须写成**行注释指令**：`// @stage5-remove`（可缩进），或块注释续行的
 * `* @stage5-remove`。仅**注释里**的指令算数。
 *
 * ## 为什么不能简单地 `rawContent.includes(marker)`（2026-09-28 修的真实缺陷）
 *
 * 早期版本就是这么写的，于是任何**提到**这个字符串的文件都会被自动降级成
 * "已降级" —— 实测踩到三次：
 *
 * | 情况 | 后果 |
 * |---|---|
 * | 本扫描器自己的模块注释在解释这个标注怎么用 | 文件自我豁免 |
 * | `const STAGE5_BRANCH_MARKER = '@stage5-remove'`（定义它就是标记） | **整个扫描器对自身免疫** |
 * | 曾有的写入桥文件写着"**不要**给它加 `@stage5-remove`" | 恰恰是最该算作阻断项的文件被洗白 |
 *
 * 也就是说：这条判定会**因为一句警告而失效** —— 门禁把"仍然硬依赖 Legacy"
 * 洗成"可以删表"，正是本模块开头声称要防的那件事。要求指令形态之后，
 * "提到"与"声明"才区分得开。
 *
 * ⚠️ 2026-09-28（第五轮）：上表第三行提到的那个文件（`lib/im/legacy-write.ts`）
 * 已因方向调整（G-15）被删除，但它揭示的陷阱**仍然有效** —— 任何文件只要在注释里
 * 写一句"这里不要加 @stage5-remove"就能自我豁免。因此判定形态的要求保持不变，
 * 且 `check-invariants.js` 保留了扫描器分辨力的**合成正控**（用临时夹具而非真实文件，
 * 这样正控不会随仓库状态漂移而失效）。
 *
 * 另外，判定必须跑在**涂白了字符串字面量**的视图上（见 `blankLiteralsOnly`），
 * 否则一行模板字面量里的 `// @stage5-remove` 也能让文件免疫。
 */
const STAGE5_BRANCH_MARKER = '@stage5-remove';

/** 行注释 / 块注释续行形态的指令标注 */
const STAGE5_BRANCH_MARKER_RE = /(?:^|\n)[ \t]*(?:\/\/|\*)[ \t]*@stage5-remove\b/;

/**
 * 基础函数库自身：它必须访问 `db` 与服务名来探测可用性，不参与"是否可删表"的判定。
 *
 * ⚠️ 这是**唯一**合法的豁免成员，且必须保持极小 —— 它是"连分类都不参与"的白名单，
 * 一旦把业务文件加进来，B9 就会对那个文件**完全失明**（连"未加探测"都不会报）。
 * 因此导出它，由 `check-invariants.js` 断言其成员集合不变。
 */
export const EXEMPT_FILES: ReadonlySet<string> = new Set([
  'src/lib/im/legacy-capability.ts',
]);

// ═══════════════════════════════════════════════════════════════════════════
// 注释 / 字面量剔除（用解析器打洞，保留行号）
// ═══════════════════════════════════════════════════════════════════════════

/** 需要涂白的字面量节点（正则 + 各类模板片段） */
const LITERAL_KINDS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.StringLiteral,
]);

/** 按扩展名挑 TS 方言 —— `.tsx` 必须用 TSX，否则 `<div>` 会被解析成类型断言 */
function scriptKindOf(file: string): ts.ScriptKind {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * 生成两个与原文**逐字符等长**的「涂白视图」，换行全部保留，
 * 因此**行号与原文严格一一对应**。
 *
 * | 视图 | 涂白的内容 | 用途 |
 * |---|---|---|
 * | `commentsBlanked` | 只有注释 | 发现导入绑定（模块路径写在字符串里，**不能**涂白） |
 * | `codeOnly`        | 注释 + 字符串 + 正则 + 模板 | 匹配引用（否则字符串里的 `'db.chatRoom'` 示例会误报） |
 *
 * 只解析一次，两个视图共用同一棵语法树。
 *
 * ## 为什么不用手写状态机
 *
 * 见模块文档「已知局限 ②」：手写状态机被正则字面量里的引号带偏，导致整份文件的
 * 注释不再被识别，扫描器给自己报了误报。区间打洞把"哪段是注释"这个判断
 * 完全交给 TypeScript，我们只负责涂白。
 */
export function makeBlankedViews(
  src: string,
  kind: ts.ScriptKind,
): { commentsBlanked: string; codeOnly: string } {
  const { commentRanges, literalRanges } = collectRanges(src, kind);
  return {
    commentsBlanked: blankRanges(src, commentRanges),
    codeOnly: blankRanges(src, [...commentRanges, ...literalRanges]),
  };
}

/**
 * 只涂白**字符串 / 正则 / 模板**字面量，**保留注释** —— 专门用于判定
 * `// @stage5-remove` 这类**指令标注**：标注必须写在注释里，不能因为
 * 某个字符串"提到"了它就认定文件已降级。
 */
export function blankLiteralsOnly(src: string, kind: ts.ScriptKind): string {
  const { literalRanges } = collectRanges(src, kind);
  return blankRanges(src, literalRanges);
}

/** 一次解析，收集注释区间与字面量区间 */
function collectRanges(
  src: string,
  kind: ts.ScriptKind,
): { commentRanges: Array<[number, number]>; literalRanges: Array<[number, number]> } {
  const sf = ts.createSourceFile('scan.ts', src, ts.ScriptTarget.Latest, true, kind);

  const commentRanges: Array<[number, number]> = [];
  const literalRanges: Array<[number, number]> = [];
  const seenC = new Set<string>();
  const seenL = new Set<string>();

  const pushC = (a: number, b: number) => {
    if (b <= a) return;
    const k = a + ':' + b;
    if (seenC.has(k)) return;
    seenC.add(k);
    commentRanges.push([a, b]);
  };
  const pushL = (a: number, b: number) => {
    if (b <= a) return;
    const k = a + ':' + b;
    if (seenL.has(k)) return;
    seenL.add(k);
    literalRanges.push([a, b]);
  };

  const visit = (node: ts.Node) => {
    for (const r of ts.getLeadingCommentRanges(src, node.getFullStart()) ?? []) pushC(r.pos, r.end);
    for (const r of ts.getTrailingCommentRanges(src, node.getEnd()) ?? []) pushC(r.pos, r.end);
    if (LITERAL_KINDS.has(node.kind)) pushL(node.getStart(sf), node.getEnd());
    ts.forEachChild(node, visit);
  };

  // 刻意不遍历 SourceFile 自身：它的 getFullStart() 为 0，会重复推送同一区间。
  for (const stmt of sf.statements) visit(stmt);
  // 文件末尾的注释挂在 EOF token 的 trivia 上，不在 statements 里 —— 单独补一次。
  for (const r of ts.getLeadingCommentRanges(src, sf.endOfFileToken.getFullStart()) ?? []) {
    pushC(r.pos, r.end);
  }

  return { commentRanges, literalRanges };
}

/** 把给定区间**原地**涂成空格，只保留换行 —— 因此行号与原文严格对齐 */
function blankRanges(src: string, ranges: Array<[number, number]>): string {
  // ⚠️ 必须**原地**涂白（字符数组），不要用 `out.slice(0,a) + … + out.slice(b)`。
  //    后者每处理一段就重建一次整串 —— 对注释密集的文件是 O(段数 × 文件长度)，
  //    实测把全仓扫描从秒级拖到 5 分钟以上。字符数组是 O(被涂白的字符数)。
  const buf = src.split('');
  for (const [a, b] of ranges) {
    for (let i = a; i < b; i++) {
      if (buf[i] !== '\n') buf[i] = ' ';
    }
  }
  return buf.join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// 扫描
// ═══════════════════════════════════════════════════════════════════════════

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 目录不存在/无权限 —— 静默跳过，扫描器不应因环境问题崩溃
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile() && EXTENSIONS.some((x) => e.name.endsWith(x))) {
      out.push(full);
    }
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * 分类。
 *
 * @param markerView **涂白了字符串/正则/模板字面量、保留注释**的源码
 *                   （见 `blankLiteralsOnly`）—— 只有写在**注释**里的
 *                   `// @stage5-remove` 才算"声明"，字符串里提到不算。
 */
function classify(relFile: string, markerView: string): { category: RefCategory; reason: string } {
  if (EXEMPT_FILES.has(relFile)) {
    return { category: 'stage5-branch', reason: '能力探测库自身（基础设施，不参与删表判定）' };
  }

  const deleted = STAGE5_DELETED_PATTERNS.find((p) => p.re.test(relFile));
  if (deleted) {
    return { category: 'stage5-deleted', reason: deleted.reason };
  }

  if (STAGE5_BRANCH_MARKER_RE.test(markerView)) {
    return {
      category: 'stage5-branch',
      reason: `已标注 ${STAGE5_BRANCH_MARKER}（行注释指令）—— 引用位于已降级分支，阶段 5 删除该分支即可`,
    };
  }

  return {
    category: 'blocker',
    reason: '未加能力探测、也未标注 @stage5-remove —— 删表会编译失败或运行时 500',
  };
}

/**
 * 扫描仓库中的 Legacy 表引用。
 *
 * @param root 仓库根目录的绝对路径
 */
export function scanLegacyRefs(root: string): RefReport {
  const files: FileRefs[] = [];
  let totalHits = 0;
  let scannedFiles = 0;

  for (const scanRoot of SCAN_ROOTS) {
    const abs = path.join(root, scanRoot);
    const found: string[] = [];
    walk(abs, found);

    for (const absFile of found) {
      scannedFiles++;
      const rawContent = fs.readFileSync(absFile, 'utf8');
      const relFile = toPosix(path.relative(root, absFile));

      // 两个涂白视图（只解析一次），行号与原文严格对齐 —— 见 makeBlankedViews
      const kind = scriptKindOf(relFile);
      const { commentsBlanked, codeOnly } = makeBlankedViews(rawContent, kind);
      const lines = codeOnly.split('\n');
      const rawLines = rawContent.split('\n');

      // 绑定是**文件级**的：先发现本文件用到的客户端名，再逐行匹配。
      // 这一步正是 2026-09-28 修复漏报的核心 —— 旧版硬编码只看 `db`。
      // ⚠️ 发现绑定必须用 `commentsBlanked`（保留字符串）：模块路径写在字符串字面量里。
      const bindings = discoverClientBindings(commentsBlanked);
      const hitPattern = buildHitPattern(bindings);

      const hits: RefHit[] = [];
      const models = new Set<string>();

      for (let i = 0; i < lines.length; i++) {
        hitPattern.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = hitPattern.exec(lines[i])) !== null) {
          models.add(m[1]);
          hits.push({
            file: relFile,
            line: i + 1,
            model: m[1],
            // 展示用原文（含缩进后的代码），便于人工定位
            text: (rawLines[i] ?? lines[i]).trim().slice(0, 160),
          });
        }
      }

      if (hits.length === 0) continue;

      const { category, reason } = classify(relFile, rawContent);
      totalHits += hits.length;
      files.push({
        file: relFile,
        category,
        models: [...models].sort(),
        hits,
        reason,
      });
    }
  }

  files.sort((a, b) =>
    a.category === b.category
      ? a.file.localeCompare(b.file)
      : order(a.category) - order(b.category),
  );

  const blockers = files.filter((f) => f.category === 'blocker');
  const branchFiles = files.filter((f) => f.category === 'stage5-branch');
  const deleted = files.filter((f) => f.category === 'stage5-deleted');

  return {
    root,
    scannedFiles,
    files,
    blockers,
    branchFiles,
    deleted,
    totalHits,
    ok: blockers.length === 0,
  };
}

function order(c: RefCategory): number {
  return c === 'blocker' ? 0 : c === 'stage5-branch' ? 1 : 2;
}
