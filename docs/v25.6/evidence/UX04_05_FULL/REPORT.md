# V25.6 UX04/UX05 FULL · 满配双浏览器真实聊天端到端证明

- **结论**：PASS（21 PASS / 0 FAIL）
- 生成时间：2026-11-21T05:50:47.385Z
- 消息：20 条真实 UI 双向发送 ｜ DB 终态 20 条
- 扰动：总计 86 次（send 延迟 20 / messages 延迟+500 41，其中 500 5 次 / 幂等重放 20，duplicate 成功 20）

## 步骤与判据

| 步骤 | 结果 | 备注 |
|---|---|---|
| 夹具与干净基线就绪 | PASS |  |
| 设备A/B 真实登录 | PASS |  |
| 设备A/B 打开真实聊天页并水合 | PASS |  |
| AI 能力诚实态：显示不可用提示且无 Stub 建议 | PASS |  |
| 网络扰动注入器已装载（send 延迟 / messages 延迟+500） | PASS |  |
| 消息 1–5/20 全部双向可达 | PASS |  |
| 消息 1–10/20 全部双向可达 | PASS |  |
| 消息 1–15/20 全部双向可达 | PASS |  |
| 消息 1–20/20 全部双向可达 | PASS |  |
| 20 条消息全部真实 UI 发送 + 对方自动收到 | PASS |  |
| 幂等重放 20 次全部 duplicate 且不新增 | PASS |  |
| 双端真实浏览器截图落盘 | PASS |  |
| DB 对账：20 条全部落库且内容一致 | PASS |  |
| DB 对账：幂等重放未产生重复/垃圾消息 | PASS |  |
| DB 对账：seq 单调递增 | PASS |  |
| DB 对账：发送者/接收者方向与 UI 一致 | PASS |  |
| 负例：未登录 send → 401 | PASS | status=401 |
| 负例：伪造会话 send → 404 | PASS | status=404 |
| 负例：合法登录但非成员读消息 → 403/404 | PASS | status=404 |
| 页面无未捕获 JS 错误 | PASS |  |
| 网络扰动次数 ≥ 50 | PASS |  |

## 录屏与截图

- `videos/chat-device-A.webm`
- `videos/chat-device-B.webm`
- `chat-device-A.png`
- `chat-device-B.png`

## 诚实边界

- 20 条消息全部由两个独立浏览器 context 在真实页面输入回车发出，经 /api/im/send 鉴权落库，非 DB 脚本写入。
- 接收方靠页面 visibilitychange → refreshMessages（seq 增量）自动到达；注入的 500 由页面 catch 后下一轮恢复，验证最终一致性。
- 幂等重放 20 次均返回 duplicate:true，DB 未新增消息，证明 clientMsgId 幂等在扰动下成立。
- 录屏为真实浏览器像素；PREMIUM 订阅为隔离库测试夹具，无真实支付/扣款，生产商业门未受影响。
- 本轮为本地 next start + 隔离 file: 库，非真人盲测、非生产；真人 5 秒/90 秒/180 秒指标与 150 条 AI 效果盲评不在本证明范围。
