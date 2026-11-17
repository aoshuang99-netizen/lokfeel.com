# V25.3 · T03（V25-05/07/08）双人跨设备真实聊天 — 状态：BLOCKED / NOT_TESTED

**裁决：本轮无法完成，且不以模拟接收端冒充真人通信（spec 明确禁止）。**

## 1. 硬阻塞项（环境事实，非借口）

| 要求 | 本环境实况 |
|------|-----------|
| 两个真实测试账号 + 两个浏览器上下文/设备 | 仅有 fixture 占位（`.qa-chat-e2e.local.json`：`@example.invalid`），**非真实账号** |
| 真实 Pusher 实时推送（接收端实际收到） | `PUSHER_APP_ID/KEY/SECRET/NEXT_PUBLIC_PUSHER_KEY` 全部 **MISSING**；Pusher emit 只能是 mock |
| ≥20 条双向实际通信 + ≥50 次网络扰动、送达/已读绑定接收端行为 | 无可用多上下文 E2E 规格（`tests/e2e-ci` 无 chat/im spec；`/dashboard/chats` 因 WebSocket 稳定性被 E2E 列表刻意排除） |
| 禁止 AI/模拟用户代替真实接收端 | 无真实接收端 ⇒ 任何"通过"都是假绿，故不产出 |

## 2. 本轮实际做的（不冒充 T03 完成）

- 完成 T02 媒体披露全路径护栏（Pusher 载荷在**服务端 emit 前**经统一判决，Receive 侧零原文）——这是 T03 安全通信的**前置**，但不含"两真人实际收发"证据。
- `/api/im/send` 的发送行为由 Jest 集成层钉住（write-side 门禁 + 实时载荷脱敏 + Bot 上下文脱敏）。

## 3. 解除阻塞所需（交 Owner / 环境）

1. 两个**真实**注册测试账号（跨组织成员）+ 两独立浏览器上下文/真机；
2. 配置 Pusher 凭据（或明确批准用轮询模式并据此调整"送达"判据）；
3. 授权真实多上下文 E2E 脚本（Playwright multi-context + network throttling）及脱敏证据留存路径。

## 4. 结论

`VERDICT = NOT_TESTED`（不是 FAIL、更不是 PASS）。任何声称"两名用户已能真实可靠通信"的说法都缺乏接收端原始证据，不予输出。
