# V25.3 · T04（V25-13/14/19）私人生成式沟通 — 溯源/零外发护栏证据与边界

**状态：CODE_COMPLETE → LOCAL_TESTED（护栏契约层）；未接聊天侧栏、未跑真实模型评测、未真人盲测。** 不声称"AI 沟通效果已验收"。

## 1. 交付内容

新增纯契约层 `src/lib/social-ai/private-draft.ts`（零 IO / 零网络 / 零 Prisma）：

- 六字段溯源 `DraftProvenance`：`consent_ref / purpose / recipient_scope / model_id / input_data_scope / request_id`，缺任一 ⇒ `validateProvenance` 报错、`makePrivateDraft` 拒绝构造（fail closed）。
- `AI_PRIVATE_DRAFT` vs `HUMAN_SENT`：草稿只能是 `AI_PRIVATE_DRAFT`；`authorizeDraftSend()` 是升级为 `HUMAN_SENT` 的**唯一**许可，必须显式给确认用户 + 时间戳。⇒ "用户未点击发送时数据库消息写增量 0、外发 0"在代码里不可达。
- 对方私聊内容：`usedCounterpartyPrivateChat=true` ⇒ 拒绝构造（零云端外发）。
- 身份标注：`labelDraftSource()` 带模型来源 / 降级标记，避免冒充真人；`needsUncertaintyCaveat()` 对"一定/绝对/必然 + 情绪动词"要求不确定性说明（不当事实）。

## 2. 与既有资产的关系（不重复造轮子）

模型调用 / 注入防护 / 披露投影 / 审批状态机已成熟存在：
- `src/lib/agent`（`guard.wrapUntrusted`、`INTRO_DRAFT` 技能 strictObject 契约、`runSkill`）；
- `src/lib/agents`（`resolveRuntimeProvider` 真实 WorkBuddy/OpenAI、`delivery-target` 对外送达复验、outbound gate）。
本轮护栏只补"草稿何时能变真人消息 / 溯源字段齐全"这一层，不重复实现模型调用。

## 3. 验证

- `tests/social-ai/private-draft.test.ts`：**17 tests PASS**（六字段缺失、对方私聊拒绝、零外发许可、来源标注、不确定性）。
- 定向 eslint / tsc：EXIT 0（见 V25.3_STATUS 汇总）。
- 负向对照：正控存在（合规草稿成功构造、用户确认后可授权），避免"全拒绝"假绿。

## 4. 改动文件与 SHA256

| 文件 | SHA256 |
|------|--------|
| src/lib/social-ai/private-draft.ts | `7e26b691f172b3de82a9dabc8c68c480484d8864d3be13f4b557bc3b50cd4ac3` |
| tests/social-ai/private-draft.test.ts | `11a39c26146f25e0bdb88dde73fed5e2a957b61873e845c0ba0aa4fc5089237e` |

## 5. 诚实边界 / 未闭合（如实）

- **未接聊天侧栏**：本轮只做契约护栏，未在聊天 UI 挂接翻译 / 表达建议 / 回复草稿按钮。真实功能闭环未完成。
- **150 条独立双语评测、10 人真人盲测**：本沙箱无评测集 / 真人，未做；不能报"效果达标"。
- **真实模型调用未在本轮重跑**：provider 连通性此前生产 28/28，但本轮未对草稿链路发真实请求。
- **未独立复核**：实施者自测 ⇒ 非 INDEPENDENT_VERIFIED。
