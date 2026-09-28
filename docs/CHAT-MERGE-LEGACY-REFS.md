# P1-6 阶段 5 · Legacy 表代码引用报告

> **本文件由 `npm run chat:refs -- --write` 自动生成，请勿手工编辑。**
> 生成时间：2026-09-28 · 扫描范围：`src/`、`scripts/`（535 个 TS/TSX 文件）

## 为什么需要这份报告

阶段 5 的原始门禁只看数据（Vault 总量、消息血缘），得出的结论是「数据迁完就能删表」。
但 **Prisma 客户端是按 schema 生成的**：model 一移除，对应的查询委托就从
「可用对象」变成 `undefined`，所有引用点要么在 `tsc` 阶段报错，要么在运行时抛 `TypeError`。

因此「可删表」必须同时满足两个条件：**数据迁完** 且 **代码引用清空**。本报告负责后者。

## 判定

| 指标 | 值 |
|---|---|
| Legacy 表引用点总数 | 53 |
| 🔴 阻断引用（必须处理） | 0 个文件 |
| ✅ 已降级（标注 @stage5-remove） | 11 个文件 |
| ⬜ 阶段 5 随表删除 | 3 个文件 |

**结论：✅ 无阻断引用 —— 代码侧已就绪，可进入阶段 5。**

## 一、🔴 阻断引用（删表即报错或静默丢功能）

（无）

## 二、✅ 已降级分支（标注 @stage5-remove，阶段 5 删该分支即可）

### `src/app/api/auto-match/route.ts`

- 触及 model：`chatRoom`、`chatRoomMember`、`message`
- 分类依据：已标注 @stage5-remove（行注释指令）—— 引用位于已降级分支，阶段 5 删除该分支即可

| 行 | model | 代码 |
|---|---|---|
| 213 | `chatRoom` | `const existingChatRoom = await tx.chatRoom.findFirst({` |
| 220 | `chatRoom` | `const chatRoom = await tx.chatRoom.create({` |
| 225 | `chatRoomMember` | `await tx.chatRoomMember.createMany({` |
| 319 | `message` | `await tx.message.create({` |
| 323 | `chatRoom` | `await tx.chatRoom.update({` |

### `src/app/api/im/conversations/[id]/route.ts`

- 触及 model：`chatRoom`
- 分类依据：已标注 @stage5-remove（行注释指令）—— 引用位于已降级分支，阶段 5 删除该分支即可

| 行 | model | 代码 |
|---|---|---|
| 70 | `chatRoom` | `? db.chatRoom.findFirst({` |

### `src/app/api/matches/[id]/route.ts`

- 触及 model：`chatRoom`、`message`
- 分类依据：已标注 @stage5-remove（行注释指令）—— 引用位于已降级分支，阶段 5 删除该分支即可

| 行 | model | 代码 |
|---|---|---|
| 187 | `chatRoom` | `? await db.chatRoom.create({` |
| 206 | `message` | `const systemMessage = await db.message.create({` |

### `src/app/api/matches/inbox/route.ts`

- 触及 model：`chatRoom`
- 分类依据：已标注 @stage5-remove（行注释指令）—— 引用位于已降级分支，阶段 5 删除该分支即可

| 行 | model | 代码 |
|---|---|---|
| 269 | `chatRoom` | `? await db.chatRoom.create({` |

### `src/app/api/matches/react/route.ts`

- 触及 model：`chatRoom`、`chatRoomMember`、`message`
- 分类依据：已标注 @stage5-remove（行注释指令）—— 引用位于已降级分支，阶段 5 删除该分支即可

| 行 | model | 代码 |
|---|---|---|
| 99 | `chatRoom` | `? prisma.chatRoom.findFirst({` |
| 178 | `chatRoom` | `? await prisma.chatRoom.findFirst({` |
| 193 | `chatRoom` | `chatRoom = await prisma.chatRoom.create({` |
| 202 | `chatRoomMember` | `await prisma.chatRoomMember.createMany({` |
| 212 | `message` | `const systemMessage = await prisma.message.create({` |
| 227 | `message` | `const existingSystemMessage = await prisma.message.findFirst({` |

### `src/app/api/requests/[id]/route.ts`

- 触及 model：`chatRoom`、`chatRoomMember`、`message`
- 分类依据：已标注 @stage5-remove（行注释指令）—— 引用位于已降级分支，阶段 5 删除该分支即可

| 行 | model | 代码 |
|---|---|---|
| 102 | `chatRoom` | `? await prisma.chatRoom.findFirst({ where: { matchId: match.id } })` |
| 109 | `chatRoom` | `const newChatRoom = await prisma.chatRoom.create({` |
| 119 | `chatRoomMember` | `await prisma.chatRoomMember.createMany({` |
| 133 | `message` | `const systemMessage = await prisma.message.create({` |

### `src/lib/im/list.ts`

- 触及 model：`chatRoomMember`
- 分类依据：已标注 @stage5-remove（行注释指令）—— 引用位于已降级分支，阶段 5 删除该分支即可

| 行 | model | 代码 |
|---|---|---|
| 251 | `chatRoomMember` | `? await db.chatRoomMember.findMany({` |
| 294 | `chatRoomMember` | `const counterparts = await db.chatRoomMember.findMany({` |

### `src/lib/im/message-guards.ts`

- 触及 model：`message`
- 分类依据：已标注 @stage5-remove（行注释指令）—— 引用位于已降级分支，阶段 5 删除该分支即可

| 行 | model | 代码 |
|---|---|---|
| 69 | `message` | `? db.message.count({ where: { roomId: chatRoomId, senderId: userId } })` |
| 87 | `message` | `? db.message.count({ where: { senderId: userId } })` |

### `src/lib/im/resolve.ts`

- 触及 model：`chatRoom`
- 分类依据：已标注 @stage5-remove（行注释指令）—— 引用位于已降级分支，阶段 5 删除该分支即可

| 行 | model | 代码 |
|---|---|---|
| 128 | `chatRoom` | `const room = await db.chatRoom.findFirst({` |

### `src/lib/im/stats.ts`

- 触及 model：`chatRoom`、`chatRoomMember`、`message`
- 分类依据：已标注 @stage5-remove（行注释指令）—— 引用位于已降级分支，阶段 5 删除该分支即可

| 行 | model | 代码 |
|---|---|---|
| 141 | `message` | `return isLegacyChatModelAvailable('message') ? db.message : null;` |
| 233 | `chatRoom` | `legacyAvailable ? db.chatRoom.count() : Promise.resolve(0),` |
| 258 | `chatRoom` | `? db.chatRoom.count({` |
| 291 | `chatRoomMember` | `? db.chatRoomMember.count({` |
| 344 | `chatRoom` | `? db.chatRoom.findMany({` |
| 380 | `chatRoom` | `? db.chatRoom.count({ where: { members: { some: { userId } } } })` |
| 408 | `chatRoom` | `? db.chatRoom.findMany({` |

### `src/lib/im/write-message.ts`

- 触及 model：`chatRoom`、`message`
- 分类依据：已标注 @stage5-remove（行注释指令）—— 引用位于已降级分支，阶段 5 删除该分支即可

| 行 | model | 代码 |
|---|---|---|
| 242 | `message` | `const legacy = await db.message.create({` |
| 263 | `chatRoom` | `await db.chatRoom.update({` |
| 276 | `message` | `await db.message.delete({ where: { id: legacyMessageId } });` |

## 三、⬜ 阶段 5 随表删除（无需处理）

### `src/app/api/chat/[id]/messages/route.ts`

- 触及 model：`chatRoom`、`chatRoomMember`、`message`
- 分类依据：Legacy 消息端点（阶段 5 随表整文件删除）

| 行 | model | 代码 |
|---|---|---|
| 64 | `chatRoomMember` | `const member = await db.chatRoomMember.findUnique({` |
| 81 | `message` | `const messages = await db.message.findMany({` |
| 93 | `message` | `await db.message.updateMany({` |
| 98 | `chatRoomMember` | `await db.chatRoomMember.update({` |
| 219 | `chatRoomMember` | `const member = await db.chatRoomMember.findUnique({` |
| 235 | `message` | `const message = await db.message.create({` |
| 240 | `chatRoom` | `await db.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: new Date() } })` |
| 262 | `chatRoomMember` | `const otherMember = await db.chatRoomMember.findFirst({` |
| 276 | `message` | `const botMessage = await db.message.create({` |
| 288 | `chatRoom` | `await db.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: new Date() } })` |

### `src/app/api/chat/[id]/route.ts`

- 触及 model：`chatRoom`、`chatRoomMember`
- 分类依据：Legacy 会话详情端点（阶段 5 随表整文件删除）

| 行 | model | 代码 |
|---|---|---|
| 18 | `chatRoomMember` | `const member = await db.chatRoomMember.findUnique({` |
| 27 | `chatRoom` | `const room = await db.chatRoom.findUnique({` |

### `src/app/api/chat/[id]/vault/route.ts`

- 触及 model：`chatRoom`、`chatRoomMember`、`message`
- 分类依据：Legacy Vault 端点（阶段 5 随表整文件删除；Vault 已迁到 /api/im/*）

| 行 | model | 代码 |
|---|---|---|
| 28 | `chatRoomMember` | `const membership = await db.chatRoomMember.findFirst({` |
| 67 | `chatRoom` | `await db.chatRoom.update({` |
| 109 | `chatRoomMember` | `const membership = await db.chatRoomMember.findFirst({` |
| 188 | `chatRoom` | `const updatedRoom = await db.chatRoom.update({` |
| 229 | `chatRoomMember` | `const membership = await db.chatRoomMember.findFirst({` |
| 273 | `chatRoom` | `const updatedRoom = await db.chatRoom.update({` |
| 285 | `message` | `await db.message.updateMany({` |

## 处置建议

⚠️ 数字语义提醒：本表的阻断数在 2026-09-28 之前**被严重低估**（当年报 3，
实际 16）—— 旧扫描器只认 `db.` 前缀，而仓库里还大量使用
`import { db as prisma }`（同一实例的别名）与 `$transaction(tx)`。
修复漏报后首轮为 17，经第五、六轮改造后当前为 0。

⚠️ **第五轮曾误报"已归零"**：那次 `chat:refs` 被沙箱拦在半途（`CODEBUDDY_BROKER_DENY`），
"0 个阻断"是在拦截下**推断**出来的，并未真正执行完。第六轮实测为 **1 个** ——
而且那 1 个正是第五轮为修 G-15 新建的 `lib/im/write-message.ts`（见下 G-16）。
**没有跑过的"通过"不是通过。** 这条教训比数字本身重要。
**不要**把任何历史数字当成目标 —— 唯一的判据是 0。

| 性质 | 文件 | 处置 | 状态 |
|---|---|---|---|
| **统计读取** | 后台分析 ×3、dashboard/summary、bots/status、cron/status、user/limits、dashboard/analytics、bot-automation/route | 收敛到 `lib/im/stats`（`max(Legacy, IM)` 口径） | ✅ 已完成（9 个） |
| **业务写入 · 匹配** | `matches/react`、`matches/[id]`、`matches/inbox`、`requests/[id]`、`auto-match` | 补全 IM 写入（`createConversation` + 血缘回填）后，Legacy 写入降级为 `@stage5-remove` 分支 | ✅ 已完成（5 个） |
| **业务写入 · Bot** | `bot-learning/scheduler`、`bot-automation/{route,lib}`、`bot-engine/*`、`cron/bot-chat` | 读写全部改终局模型；写入走 `lib/im/write-message` | ✅ 已完成（6 个） |
| **旧聊天端点** | `chats/route`、`chats/unread-count` | 改为转发 `buildConversationList` 的兼容壳（保留端点，消除 Legacy 引用） | ✅ 已完成（2 个） |
| **开发/运维脚本** | `scripts/bot/*`、`scripts/seed-*`、`lib/automated-testing` | 改读/写 IM（顺带修掉一个必然 404 的路由与一处自相矛盾的预期） | ✅ 已完成（4 个） |
| **统一写入入口** | `lib/im/write-message` | **IM 主 + Legacy 可选副本**，Legacy 副本受 `CHAT_TWIN_WRITE` 与能力探测双重保护 | ✅ 已定型 |

### ⚠️ 关于"写入型引用点能否用能力探测豁免"（判据已更正）

原表述是"写入型引用点**不得**用能力探测豁免"，理由是"跳过一次写入 = 静默丢功能"。
这个理由本身没错，但它有**前提**：**Legacy 是主数据源**。
一旦 IM 侧承接完整（终局模型可写），Legacy 就退化为**兼容副本**，
此时"Legacy 写入可跳过"是安全的。因此真正的判据不是"有没有加探测"，而是：

| 组合 | 判定 |
|---|---|
| 探测 + **IM 写入齐全** | ✅ 安全 —— 删表零功能损失 |
| 探测 + **无 IM 写入** | 🔴 **静默丢功能，比裸写更危险**（裸写至少会当场报错） |

`check-invariants.js` 第 12 节把这条判据固化为断言（要求「探测 ∧ IM 承接 ∧ 标注」
三者同时成立），防止后续有人只加探测不补 IM 写入。
本轮实测该禁令救了一次：`/api/requests/[id]` 原先**只有 Legacy 写入、IM 侧一行都没有** ——
正是"探测 + 无 IM 写入"这个最危险形态。

### 🔴 G-11：Bot 消息在 IM 侧整体缺失（已修复）

阶段 4 换源后，写入出现了**两个方向相反**的缺口，而它们都是静默的：

| 写入方 | 落在哪 | 后果 |
|---|---|---|
| 人类用户（`/api/im/send`） | **只有 IM** | ✅ 用户看得到 |
| Bot 引擎（`cron/bot-chat`、`bot-learning/scheduler`） | **只有 Legacy** | ❌ **用户在 IM 里看不到 Bot 说的任何一句话** |

根因不是"忘了写 IM"，而是**没有单一写入点** —— 5 处 Legacy 写入各写各的，
其中只有 1 处手工调了镜像。现在 Bot 侧全部改走终局模型，
且 `writeMessage` 会把 **Legacy 副本的写入结果回传**（不是静默吞掉）。

### 🔴 G-15：双写方向与文档相反（本轮发现并修复）

上一轮建立的 `lib/im/legacy-write.ts` 是 **Legacy 主 + 前向镜像到 IM**，
而 `chat:retire --sql` 的执行清单写的是「移除 `CHAT_TWIN_WRITE`，
**让线上不再写 Legacy 表**」。方向与文档相反，后果是：

> 照文档操作会让 Bot 消息**只写 Legacy、不进 IM**，而阶段 4 之后前端只读 IM ——
> 于是用户面前会连续 24 小时看不到任何 Bot 消息。

本轮把方向摆正为 **IM 主 + Legacy 可选副本**（这正是 `legacy-write.ts` 自己的
模块注释预告的终局形态），于是"关镜像"这个动作才真正等于"停止写 Legacy"。
旧模块失去全部调用方后已删除，能力迁到 `lib/im/write-message.ts`。

⚠️ **回滚语义的变化（知情项）**：翻转后 `CHAT_TWIN_WRITE` 未设置时新消息**只存在于 IM**。
若此时回滚到旧版部署（旧版只读 Legacy），回滚窗口内的新消息在界面上不可见。
这是执行清单早已接受的取舍；需要保留完整回滚能力就在观察期保持 `CHAT_TWIN_WRITE=1`。

### 🔴 G-16：统一写入入口自己就是最后一个阻断项（第六轮发现并修复）

`lib/im/write-message.ts` **就是**为修 G-15 而新建的那个文件 ——
但它自己的 Legacy 副本分支**没加** `@stage5-remove` 标注。两层后果：

1. B9 扫描把它报成**唯一阻断项**，而 `chat:retire --sql` 的【4】同时写着
   "它可按 `@stage5-remove` 标注删除" —— **那个标注根本不存在**。
   文档在承诺一件没人做的事。
2. 更隐蔽的**跨模块耦合**：原实现从 `mirror.ts` 导入 `TWIN_WRITE_ENABLED`，
   而 `mirror.ts` 在删表清单【3】里被**整文件删除**、【4】才删本文件的标注块 ——
   照清单执行会在【3】与【4】之间制造一个"清单自己造出来的编译错误"。

一句话：**待删的东西，不能被保留的东西依赖。**
修复：开关改为本地定义（不再 import `mirror.ts`），并给 5 个删除单元加标注 ——
`check-invariants.js` 第 10 节已加 3 条断言（归类为分支 / 不依赖 mirror / 标注数 = 5）。

### 🟠 G-17：`check-invariants.js` 第 10 节有 4 对互斥断言（第六轮发现并修复）

同一批文件被两条断言要求**相反的结果**：

| 断言 | 要求 |
|---|---|
| 别名绑定正控（旧） | `auto-match` / `matches/react` / `chats/route` / `prisma-adapter` **必须是阻断项** |
| 已解除阻断清单 | 同样这 4 个文件 **必须不是阻断项** |

必然有一条失败。根因是这条正控绑在**仓库的真实状态**上：第五轮把那 4 个文件
全改造完之后，它就自动变成了"要求门禁报错"的断言，还会**诱使人为了修断言去改代码**。
已改为**合成夹具**（4 种绑定形态 + 假阳性，与仓库状态完全解耦）。
同节另有两处：一条带字符串实参的断言跑在**涂白了字符串**的视图上（恒假），
一条名叫"豁免名单为空"却断言"分类非空"（真正重要的不变量从未被检查）。均已修正。
教训：**正控必须验证"工具的分辨力"，不能验证"仓库此刻长什么样"。**

### 🔴 G-18：`IMMessageType` 与 `MessageType` 是两套枚举，直接赋值必然编译失败（第六轮发现并修复）

**这是唯一一个语法诊断、引用扫描、不变式门禁全都看不见的缺陷** ——
它是在人工把写入入口对着 schema 与生成客户端**逐字段核对**时抓出来的。

`Message.messageType` 的类型是 `MessageType`，而写入入口传进去的是 `IMMessageType`：

| 枚举 | 值域 |
|---|---|
| `IMMessageType` | TEXT / IMAGE / VOICE / **FILE** / SYSTEM / **CONSENT_REQUEST** / **CONSENT_RESPONSE** / **RULE_UPDATE** / **TYPING** / **READ_RECEIPT** |
| `MessageType`（Legacy） | TEXT / IMAGE / SYSTEM / VOICE |

前者是**更宽的联合** → TS2322；绕过类型检查则运行时被 Prisma 拒绝（非法枚举值），
被 catch 吞成 `reason='error'`，表现为**每天刷告警、副本静默失败**。

线索：`mirror.ts` 里**已有**反方向映射表 `LEGACY_TO_IM_TYPE`，说明作者知道两者值域不同；
新建的 IM → Legacy 方向**漏了对称的那一半**。
修复：在块 5/5 内加 `toLegacyMsgType()` 显式收窄，取**交集**，不在 Legacy 值域内的
IM 类型**不镜像**（新增 `reason='unsupported-msg-type'`）—— 刻意**不**降级成 TEXT，
否则 `READ_RECEIPT` 会在 Legacy 看板里变成一条**凭空多出来的假消息**。
`check-invariants.js` 第 12 节加 2 条断言（必须收窄 / 不得 `messageType: msgType`）。

### 读侧改 IM 的判据（`cron/bot-chat` 已采用）

该文件原按 `ChatRoom.isArchived = false` 筛房间。IM 侧的等价物**不是**
`Conversation.state`（该字段除创建外无人写入，恒为 `ACTIVE`），而是
**`Conversation.vaultStatus !== 'REVOKED'`** —— 因为全仓唯一设置
`isArchived: true` 的地方就是 vault 撤销路径（`api/chat/[id]/vault`），
它同时写入 `vaultStatus: 'REVOKED'`。

⚠️ 这依赖 `chat:vault:apply` 已执行（Vault 字段从 ChatRoom 迁到 Conversation），
   否则 Conversation 侧全是默认值 `ACTIVE`，会把已撤销的会话重新纳入。
   `check-invariants.js` 已加断言：读侧不得出现 `state:` 过滤条件。

## 相关文档

- `docs/CHAT-MERGE-AUDIT.md` §11.3 —— 缺口登记表（G-1…G-19）
- `docs/CHAT-MERGE-AUDIT.md` §17 —— 阶段 5 代码侧第五轮（**⚠️ 其"阻断归零"结论已被 §18 修正**）
- `docs/CHAT-MERGE-AUDIT.md` §18 —— 阶段 5 代码侧第六轮（G-16 / G-17 / G-18 / G-19，全部实测收口）
- `docs/CHAT-MERGE-RUNBOOK.md` §10 —— 阶段 5 执行手册与门禁清单
- `src/lib/im/stats.ts` —— 统计的迁移安全口径（单一数据源）
- `src/lib/im/write-message.ts` —— 消息写入的单一入口（IM 主 + Legacy 可选副本）
