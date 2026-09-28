# 双聊天系统合并 · 阶段 3 数据统一报告 · 2026-09-28

> 模式：**APPLY（已写入）**
> 生成者：`scripts/chat-merge/migrate-messages.ts`

## 计划汇总

| 指标 | 值 |
|---|---|
| 会话总数 | 1 |
| 需处理会话 | 1 |
| 待迁消息总数 | 5 |
| 可认领既有行 | 0 |
| 已迁入历史 | 0 |
| 因序号交错跳过 | 0 |
| 因阻塞跳过 | 0 |

## 执行结果

| 指标 | 值 |
|---|---|
| 处理会话 | 1 |
| 认领既有 IM 行 | 0 |
| 新迁入消息 | 5 |
| 失败会话 | 0 |

## 回滚

```sql
DELETE FROM "IMMessage" WHERE "legacyMessageId" IS NOT NULL;
```
