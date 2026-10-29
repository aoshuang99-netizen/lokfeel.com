# 31 · TEST FIXTURE AUDIT（WB19-60 · V19.6）

日期：2026-10-29　分支：`v19/design-exploration`　基线 HEAD：`3968f8f`

## 1. 为什么需要新夹具

V18.06 的 `seed-authed-e2e-user.mjs` 只造「1 用户 + 1 mission」，够测登录后的页面与
ConfirmDialog，但**不够测 ReportModal / VideoCallModal** —— 两个弹窗只挂在
`/dashboard/chats/[roomId]` 的真实会话里，需要「我 + 对方 + 一条会话」。
V19.5 把 ReportModal 的键盘行为判为 BLOCKED，缺的就是这个夹具。

## 2. 夹具内容（`scripts/qa/seed-chat-fixture.mjs`）

| 资源 | id / 前缀 | 说明 |
|---|---|---|
| 租户 A | `e2e_org_chat_a` | userA（OWNER）+ userB（MEMBER） |
| 会话 | `e2e_conv_chat` | Conversation(userA↔userB) + 2 参与者 + 2 条 IMMessage（seq 1/2） |
| 租户 B | `e2e_org_chat_b` | userC（OWNER）—— 会话外，跨租户负向用例（ENV-04）的访问方 |
| 邮箱 | `e2e.chat.{a,b,c}@example.invalid` | `@example.invalid` 保证不可送达、不与真实用户冲突 |

口令运行时拼接（gitleaks 形状纪律）；id 固定 → `--cleanup` 可精确删除。

## 3. 隔离纪律（与既有种子脚本同一口径）

1. **只写本地 file: 库**：`isRemoteDb()` 检测到 `turso|libsql://` 直接 exit 2；
2. 数据标记 `e2e_` / `@example.invalid` 前缀，清理范围**只限本次创建的 id**；
3. 不写生产库、不外发真实消息、不触发外部 Provider（举报走本地 `/api/reports`，仅写本地库）。

## 4. 已验证的行为（本地 /tmp/v196-fixture.db）

| 项 | 结果 |
|---|---|
| 可重复创建（连跑两次不撞唯一约束） | ✓（参与者/消息全部 upsert） |
| 创建后行数 | Organization 2 · User 3 · Membership 3 · Conversation 1 · Participant 2 · IMMessage 2 |
| `--cleanup` 残留 | 0 行（含 E2E 过程可能产生的 `UserReport`） |
| 清理后可重建 | ✓ |
| 远程库闸门 | turso/libsql URL → exit 2 |

## 5. CI 接线

- `e2e` job 在 `seed-authed-e2e-user` 之后插入「造聊天夹具」步骤；
  邮箱/口令/会话 id 写进 `$GITHUB_ENV`（`E2E_CHAT_A_*` / `E2E_CHAT_C_*` / `E2E_CHAT_CONV_ID`）。
- `if: always()` 的清理步骤新增 `seed-chat-fixture --cleanup`（与认证夹具同批）。

## 6. 未做 / 边界

- 夹具没有为 userB 写 Profile 头像等富化数据：会话头渲染依赖 `User.name`，已够用；
- 未造第二个会话：负向用例的「跨租户」由 userC 承担，「同租户但会话外」暂无独立样本（P2）；
- Mission/Workspace 夹具沿用 `seed-authed-e2e-user.mjs` 的 mission，未新建。
