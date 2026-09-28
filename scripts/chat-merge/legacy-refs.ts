/**
 * Legacy 聊天表代码引用报告（阶段 5 的 B9 门禁 · 独立可运行版）
 *
 * 用法：
 *   npm run chat:refs               # 打印引用点分类表（无需连库、无需编译）
 *   npm run chat:refs -- --json     # 机器可读（供 CI 判退）
 *   npm run chat:refs -- --write    # 生成 docs/CHAT-MERGE-LEGACY-REFS.md
 *
 * 退出码：
 *   0 = 无阻断引用（可以进入阶段 5）
 *   2 = 存在阻断引用（**不要**从 schema 删 model）
 *
 * 为什么单独成一个脚本而不是只塞进 `retire-legacy.ts`：
 *   `retire-legacy.ts` 需要连库（Turso）。而"代码引用是否清干净"是**纯静态**问题，
 *   应当在 CI、在无网络、在任何改代码的人本地都能随时跑 —— 让它可以独立运行，
 *   才可能被养成"改完代码顺手跑一下"的习惯。
 *
 * @module scripts/chat-merge/legacy-refs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { scanLegacyRefs, type RefReport } from './shared/legacy-refs';

const argv = process.argv.slice(2);
const hasFlag = (n: string) => argv.includes(`--${n}`);
const WANT_JSON = hasFlag('json');
const WANT_WRITE = hasFlag('write');

const log = (...a: unknown[]) => console.log(...a);
const hr = (t: string) => log(`\n${'─'.repeat(70)}\n${t}\n${'─'.repeat(70)}`);

const REPO_ROOT = path.resolve(__dirname, '../..');

function reportPath(): string {
  return path.resolve(REPO_ROOT, 'docs/CHAT-MERGE-LEGACY-REFS.md');
}

function renderMarkdown(r: RefReport): string {
  const now = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push('# P1-6 阶段 5 · Legacy 表代码引用报告');
  lines.push('');
  lines.push('> **本文件由 `npm run chat:refs -- --write` 自动生成，请勿手工编辑。**');
  lines.push(`> 生成时间：${now} · 扫描范围：\`src/\`、\`scripts/\`（${r.scannedFiles} 个 TS/TSX 文件）`);
  lines.push('');
  lines.push('## 为什么需要这份报告');
  lines.push('');
  lines.push('阶段 5 的原始门禁只看数据（Vault 总量、消息血缘），得出的结论是「数据迁完就能删表」。');
  lines.push('但 **Prisma 客户端是按 schema 生成的**：model 一移除，对应的查询委托就从');
  lines.push('「可用对象」变成 `undefined`，所有引用点要么在 `tsc` 阶段报错，要么在运行时抛 `TypeError`。');
  lines.push('');
  lines.push('因此「可删表」必须同时满足两个条件：**数据迁完** 且 **代码引用清空**。本报告负责后者。');
  lines.push('');
  lines.push('## 判定');
  lines.push('');
  lines.push(`| 指标 | 值 |`);
  lines.push(`|---|---|`);
  lines.push(`| Legacy 表引用点总数 | ${r.totalHits} |`);
  lines.push(`| 🔴 阻断引用（必须处理） | ${r.blockers.length} 个文件 |`);
  lines.push(`| ✅ 已降级（标注 @stage5-remove） | ${r.branchFiles.length} 个文件 |`);
  lines.push(`| ⬜ 阶段 5 随表删除 | ${r.deleted.length} 个文件 |`);
  lines.push('');
  lines.push(
    r.ok
      ? '**结论：✅ 无阻断引用 —— 代码侧已就绪，可进入阶段 5。**'
      : `**结论：🔴 NO-GO —— ${r.blockers.length} 个文件仍在引用 Legacy 表，` +
          '此时从 schema 删 model 会直接打断编译。**',
  );
  lines.push('');

  const section = (title: string, rows: RefReport['files']) => {
    lines.push(`## ${title}`);
    lines.push('');
    if (rows.length === 0) {
      lines.push('（无）');
      lines.push('');
      return;
    }
    for (const f of rows) {
      lines.push(`### \`${f.file}\``);
      lines.push('');
      lines.push(`- 触及 model：${f.models.map((m) => `\`${m}\``).join('、')}`);
      lines.push(`- 分类依据：${f.reason}`);
      lines.push('');
      lines.push('| 行 | model | 代码 |');
      lines.push('|---|---|---|');
      for (const h of f.hits.slice(0, 12)) {
        lines.push(`| ${h.line} | \`${h.model}\` | \`${h.text.replace(/\|/g, '\\|')}\` |`);
      }
      if (f.hits.length > 12) {
        lines.push(`| … | … | 另有 ${f.hits.length - 12} 处，见脚本输出 |`);
      }
      lines.push('');
    }
  };

  section('一、🔴 阻断引用（删表即报错或静默丢功能）', r.blockers);
  section('二、✅ 已降级分支（标注 @stage5-remove，阶段 5 删该分支即可）', r.branchFiles);
  section('三、⬜ 阶段 5 随表删除（无需处理）', r.deleted);

  lines.push('## 处置建议');
  lines.push('');
  lines.push('⚠️ 数字语义提醒：本表的阻断数在 2026-09-28 之前**被严重低估**（当年报 3，');
  lines.push('实际 16）—— 旧扫描器只认 `db.` 前缀，而仓库里还大量使用');
  lines.push('`import { db as prisma }`（同一实例的别名）与 `$transaction(tx)`。');
  lines.push('修复漏报后首轮为 17，经第五、六轮改造后当前为 ' + r.blockers.length + '。');
  lines.push('');
  lines.push('⚠️ **第五轮曾误报"已归零"**：那次 `chat:refs` 被沙箱拦在半途（`CODEBUDDY_BROKER_DENY`），');
  lines.push('"0 个阻断"是在拦截下**推断**出来的，并未真正执行完。第六轮实测为 **1 个** ——');
  lines.push('而且那 1 个正是第五轮为修 G-15 新建的 `lib/im/write-message.ts`（见下 G-16）。');
  lines.push('**没有跑过的"通过"不是通过。** 这条教训比数字本身重要。');
  lines.push('**不要**把任何历史数字当成目标 —— 唯一的判据是 0。');
  lines.push('');
  lines.push('| 性质 | 文件 | 处置 | 状态 |');
  lines.push('|---|---|---|---|');
  lines.push('| **统计读取** | 后台分析 ×3、dashboard/summary、bots/status、cron/status、user/limits、dashboard/analytics、bot-automation/route | 收敛到 `lib/im/stats`（`max(Legacy, IM)` 口径） | ✅ 已完成（9 个） |');
  lines.push('| **业务写入 · 匹配** | `matches/react`、`matches/[id]`、`matches/inbox`、`requests/[id]`、`auto-match` | 补全 IM 写入（`createConversation` + 血缘回填）后，Legacy 写入降级为 `@stage5-remove` 分支 | ✅ 已完成（5 个） |');
  lines.push('| **业务写入 · Bot** | `bot-learning/scheduler`、`bot-automation/{route,lib}`、`bot-engine/*`、`cron/bot-chat` | 读写全部改终局模型；写入走 `lib/im/write-message` | ✅ 已完成（6 个） |');
  lines.push('| **旧聊天端点** | `chats/route`、`chats/unread-count` | 改为转发 `buildConversationList` 的兼容壳（保留端点，消除 Legacy 引用） | ✅ 已完成（2 个） |');
  lines.push('| **开发/运维脚本** | `scripts/bot/*`、`scripts/seed-*`、`lib/automated-testing` | 改读/写 IM（顺带修掉一个必然 404 的路由与一处自相矛盾的预期） | ✅ 已完成（4 个） |');
  lines.push('| **统一写入入口** | `lib/im/write-message` | **IM 主 + Legacy 可选副本**，Legacy 副本受 `CHAT_TWIN_WRITE` 与能力探测双重保护 | ✅ 已定型 |');
  lines.push('');
  lines.push('### ⚠️ 关于"写入型引用点能否用能力探测豁免"（判据已更正）');
  lines.push('');
  lines.push('原表述是"写入型引用点**不得**用能力探测豁免"，理由是"跳过一次写入 = 静默丢功能"。');
  lines.push('这个理由本身没错，但它有**前提**：**Legacy 是主数据源**。');
  lines.push('一旦 IM 侧承接完整（终局模型可写），Legacy 就退化为**兼容副本**，');
  lines.push('此时"Legacy 写入可跳过"是安全的。因此真正的判据不是"有没有加探测"，而是：');
  lines.push('');
  lines.push('| 组合 | 判定 |');
  lines.push('|---|---|');
  lines.push('| 探测 + **IM 写入齐全** | ✅ 安全 —— 删表零功能损失 |');
  lines.push('| 探测 + **无 IM 写入** | 🔴 **静默丢功能，比裸写更危险**（裸写至少会当场报错） |');
  lines.push('');
  lines.push('`check-invariants.js` 第 12 节把这条判据固化为断言（要求「探测 ∧ IM 承接 ∧ 标注」');
  lines.push('三者同时成立），防止后续有人只加探测不补 IM 写入。');
  lines.push('本轮实测该禁令救了一次：`/api/requests/[id]` 原先**只有 Legacy 写入、IM 侧一行都没有** ——');
  lines.push('正是"探测 + 无 IM 写入"这个最危险形态。');
  lines.push('');
  lines.push('### 🔴 G-11：Bot 消息在 IM 侧整体缺失（已修复）');
  lines.push('');
  lines.push('阶段 4 换源后，写入出现了**两个方向相反**的缺口，而它们都是静默的：');
  lines.push('');
  lines.push('| 写入方 | 落在哪 | 后果 |');
  lines.push('|---|---|---|');
  lines.push('| 人类用户（`/api/im/send`） | **只有 IM** | ✅ 用户看得到 |');
  lines.push('| Bot 引擎（`cron/bot-chat`、`bot-learning/scheduler`） | **只有 Legacy** | ❌ **用户在 IM 里看不到 Bot 说的任何一句话** |');
  lines.push('');
  lines.push('根因不是"忘了写 IM"，而是**没有单一写入点** —— 5 处 Legacy 写入各写各的，');
  lines.push('其中只有 1 处手工调了镜像。现在 Bot 侧全部改走终局模型，');
  lines.push('且 `writeMessage` 会把 **Legacy 副本的写入结果回传**（不是静默吞掉）。');
  lines.push('');
  lines.push('### 🔴 G-15：双写方向与文档相反（本轮发现并修复）');
  lines.push('');
  lines.push('上一轮建立的 `lib/im/legacy-write.ts` 是 **Legacy 主 + 前向镜像到 IM**，');
  lines.push('而 `chat:retire --sql` 的执行清单写的是「移除 `CHAT_TWIN_WRITE`，');
  lines.push('**让线上不再写 Legacy 表**」。方向与文档相反，后果是：');
  lines.push('');
  lines.push('> 照文档操作会让 Bot 消息**只写 Legacy、不进 IM**，而阶段 4 之后前端只读 IM ——');
  lines.push('> 于是用户面前会连续 24 小时看不到任何 Bot 消息。');
  lines.push('');
  lines.push('本轮把方向摆正为 **IM 主 + Legacy 可选副本**（这正是 `legacy-write.ts` 自己的');
  lines.push('模块注释预告的终局形态），于是"关镜像"这个动作才真正等于"停止写 Legacy"。');
  lines.push('旧模块失去全部调用方后已删除，能力迁到 `lib/im/write-message.ts`。');
  lines.push('');
  lines.push('⚠️ **回滚语义的变化（知情项）**：翻转后 `CHAT_TWIN_WRITE` 未设置时新消息**只存在于 IM**。');
  lines.push('若此时回滚到旧版部署（旧版只读 Legacy），回滚窗口内的新消息在界面上不可见。');
  lines.push('这是执行清单早已接受的取舍；需要保留完整回滚能力就在观察期保持 `CHAT_TWIN_WRITE=1`。');
  lines.push('');
  lines.push('### 🔴 G-16：统一写入入口自己就是最后一个阻断项（第六轮发现并修复）');
  lines.push('');
  lines.push('`lib/im/write-message.ts` **就是**为修 G-15 而新建的那个文件 ——');
  lines.push('但它自己的 Legacy 副本分支**没加** `@stage5-remove` 标注。两层后果：');
  lines.push('');
  lines.push('1. B9 扫描把它报成**唯一阻断项**，而 `chat:retire --sql` 的【4】同时写着');
  lines.push('   "它可按 `@stage5-remove` 标注删除" —— **那个标注根本不存在**。');
  lines.push('   文档在承诺一件没人做的事。');
  lines.push('2. 更隐蔽的**跨模块耦合**：原实现从 `mirror.ts` 导入 `TWIN_WRITE_ENABLED`，');
  lines.push('   而 `mirror.ts` 在删表清单【3】里被**整文件删除**、【4】才删本文件的标注块 ——');
  lines.push('   照清单执行会在【3】与【4】之间制造一个"清单自己造出来的编译错误"。');
  lines.push('');
  lines.push('一句话：**待删的东西，不能被保留的东西依赖。**');
  lines.push('修复：开关改为本地定义（不再 import `mirror.ts`），并给 5 个删除单元加标注 ——');
  lines.push('`check-invariants.js` 第 10 节已加 3 条断言（归类为分支 / 不依赖 mirror / 标注数 = 5）。');
  lines.push('');
  lines.push('### 🟠 G-17：`check-invariants.js` 第 10 节有 4 对互斥断言（第六轮发现并修复）');
  lines.push('');
  lines.push('同一批文件被两条断言要求**相反的结果**：');
  lines.push('');
  lines.push('| 断言 | 要求 |');
  lines.push('|---|---|');
  lines.push('| 别名绑定正控（旧） | `auto-match` / `matches/react` / `chats/route` / `prisma-adapter` **必须是阻断项** |');
  lines.push('| 已解除阻断清单 | 同样这 4 个文件 **必须不是阻断项** |');
  lines.push('');
  lines.push('必然有一条失败。根因是这条正控绑在**仓库的真实状态**上：第五轮把那 4 个文件');
  lines.push('全改造完之后，它就自动变成了"要求门禁报错"的断言，还会**诱使人为了修断言去改代码**。');
  lines.push('已改为**合成夹具**（4 种绑定形态 + 假阳性，与仓库状态完全解耦）。');
  lines.push('同节另有两处：一条带字符串实参的断言跑在**涂白了字符串**的视图上（恒假），');
  lines.push('一条名叫"豁免名单为空"却断言"分类非空"（真正重要的不变量从未被检查）。均已修正。');
  lines.push('教训：**正控必须验证"工具的分辨力"，不能验证"仓库此刻长什么样"。**');
  lines.push('');
  lines.push('### 🔴 G-18：`IMMessageType` 与 `MessageType` 是两套枚举，直接赋值必然编译失败（第六轮发现并修复）');
  lines.push('');
  lines.push('**这是唯一一个语法诊断、引用扫描、不变式门禁全都看不见的缺陷** ——');
  lines.push('它是在人工把写入入口对着 schema 与生成客户端**逐字段核对**时抓出来的。');
  lines.push('');
  lines.push('`Message.messageType` 的类型是 `MessageType`，而写入入口传进去的是 `IMMessageType`：');
  lines.push('');
  lines.push('| 枚举 | 值域 |');
  lines.push('|---|---|');
  lines.push('| `IMMessageType` | TEXT / IMAGE / VOICE / **FILE** / SYSTEM / **CONSENT_REQUEST** / **CONSENT_RESPONSE** / **RULE_UPDATE** / **TYPING** / **READ_RECEIPT** |');
  lines.push('| `MessageType`（Legacy） | TEXT / IMAGE / SYSTEM / VOICE |');
  lines.push('');
  lines.push('前者是**更宽的联合** → TS2322；绕过类型检查则运行时被 Prisma 拒绝（非法枚举值），');
  lines.push("被 catch 吞成 `reason='error'`，表现为**每天刷告警、副本静默失败**。");
  lines.push('');
  lines.push('线索：`mirror.ts` 里**已有**反方向映射表 `LEGACY_TO_IM_TYPE`，说明作者知道两者值域不同；');
  lines.push('新建的 IM → Legacy 方向**漏了对称的那一半**。');
  lines.push('修复：在块 5/5 内加 `toLegacyMsgType()` 显式收窄，取**交集**，不在 Legacy 值域内的');
  lines.push("IM 类型**不镜像**（新增 `reason='unsupported-msg-type'`）—— 刻意**不**降级成 TEXT，");
  lines.push('否则 `READ_RECEIPT` 会在 Legacy 看板里变成一条**凭空多出来的假消息**。');
  lines.push('`check-invariants.js` 第 12 节加 2 条断言（必须收窄 / 不得 `messageType: msgType`）。');
  lines.push('');
  lines.push('### 读侧改 IM 的判据（`cron/bot-chat` 已采用）');
  lines.push('');
  lines.push('该文件原按 `ChatRoom.isArchived = false` 筛房间。IM 侧的等价物**不是**');
  lines.push('`Conversation.state`（该字段除创建外无人写入，恒为 `ACTIVE`），而是');
  lines.push('**`Conversation.vaultStatus !== \'REVOKED\'`** —— 因为全仓唯一设置');
  lines.push('`isArchived: true` 的地方就是 vault 撤销路径（`api/chat/[id]/vault`），');
  lines.push('它同时写入 `vaultStatus: \'REVOKED\'`。');
  lines.push('');
  lines.push('⚠️ 这依赖 `chat:vault:apply` 已执行（Vault 字段从 ChatRoom 迁到 Conversation），');
  lines.push('   否则 Conversation 侧全是默认值 `ACTIVE`，会把已撤销的会话重新纳入。');
  lines.push('   `check-invariants.js` 已加断言：读侧不得出现 `state:` 过滤条件。');
  lines.push('');
  lines.push('## 相关文档');
  lines.push('');
  lines.push('- `docs/CHAT-MERGE-AUDIT.md` §11.3 —— 缺口登记表（G-1…G-19）');
  lines.push('- `docs/CHAT-MERGE-AUDIT.md` §17 —— 阶段 5 代码侧第五轮（**⚠️ 其"阻断归零"结论已被 §18 修正**）');
  lines.push('- `docs/CHAT-MERGE-AUDIT.md` §18 —— 阶段 5 代码侧第六轮（G-16 / G-17 / G-18 / G-19，全部实测收口）');
  lines.push('- `docs/CHAT-MERGE-RUNBOOK.md` §10 —— 阶段 5 执行手册与门禁清单');
  lines.push('- `src/lib/im/stats.ts` —— 统计的迁移安全口径（单一数据源）');
  lines.push('- `src/lib/im/write-message.ts` —— 消息写入的单一入口（IM 主 + Legacy 可选副本）');
  lines.push('');
  return lines.join('\n');
}

function main() {
  hr('P1-6 阶段 5 · Legacy 表代码引用扫描');
  log(`仓库：${REPO_ROOT}`);
  log('模式：只读（不修改任何文件，除非显式加 --write）');

  const report = scanLegacyRefs(REPO_ROOT);

  hr('汇总');
  log(`扫描文件数                  : ${report.scannedFiles}`);
  log(`Legacy 表引用点总数          : ${report.totalHits}`);
  log(`🔴 阻断引用（文件数）        : ${report.blockers.length}`);
  log(`✅ 已降级分支（@stage5-remove）: ${report.branchFiles.length}`);
  log(`⬜ 阶段 5 随表删除            : ${report.deleted.length}`);

  if (report.blockers.length > 0) {
    hr('🔴 阻断引用清单（删表前必须处理）');
    for (const f of report.blockers) {
      log(`  ${f.file}`);
      log(`      触及：${f.models.join('、')}   命中 ${f.hits.length} 处`);
      for (const h of f.hits.slice(0, 3)) {
        log(`      L${h.line}: ${h.text.slice(0, 110)}`);
      }
      if (f.hits.length > 3) log(`      … 另有 ${f.hits.length - 3} 处`);
    }
  }

  if (report.branchFiles.length > 0) {
    hr('✅ 已加能力探测（阶段 5 可安全删表）');
    for (const f of report.branchFiles) {
      log(`  ${f.file}  →  ${f.models.join('、')}`);
    }
  }

  if (report.deleted.length > 0) {
    hr('⬜ 阶段 5 随表删除');
    for (const f of report.deleted) {
      log(`  ${f.file}`);
    }
  }

  if (WANT_WRITE) {
    const p = reportPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, renderMarkdown(report), 'utf8');
    hr('已生成报告');
    log(`✓ ${p}`);
  }

  if (WANT_JSON) {
    log(
      '\n' +
        JSON.stringify(
          {
            verdict: report.ok ? 'GO' : 'NO-GO',
            scannedFiles: report.scannedFiles,
            totalHits: report.totalHits,
            blockers: report.blockers.map((f) => ({
              file: f.file,
              models: f.models,
              hits: f.hits.length,
            })),
            branchFiles: report.branchFiles.map((f) => f.file),
            deleted: report.deleted.map((f) => f.file),
          },
          null,
          2,
        ),
    );
  }

  hr('判定');
  if (report.ok) {
    log('✅ GO —— 代码侧无 Legacy 表引用，可与数据门禁一并放行阶段 5。');
  } else {
    log(`🔴 NO-GO —— ${report.blockers.length} 个文件仍在引用 Legacy 表。`);
    log('   此时从 schema.prisma 删除 ChatRoom / ChatRoomMember / Message');
    log('   会让 npx tsc --noEmit 直接失败，或部署后运行时 500。');
    log('   处置清单见上方「阻断引用清单」，或生成报告：');
    log('     npm run chat:refs -- --write');
    process.exitCode = 2;
  }
}

main();
