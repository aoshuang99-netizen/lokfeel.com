# V25.6 UX04/UX05 · 双浏览器真实聊天端到端证明

- **结论**：PASS（20 PASS / 0 FAIL）
- 生成时间：2026-11-20T07:21:20.915Z
- 会话：`conv_v256_chat_e2e` ｜ 基线消息 0 → 结束 2

## 步骤与判据

| 步骤 | 结果 | 备注 |
|---|---|---|
| DB 基线消息数读取 | PASS |  |
| 夹具：第三用户(不在会话)就绪 | PASS |  |
| 设备A 真实登录 | PASS | status=200 |
| 设备B 真实登录 | PASS | status=200 |
| 设备A 打开真实聊天页并水合 | PASS | status=200 |
| 设备A 页面输入回车发送并自见 | PASS | Hello from device A — real browser 1795159273180 |
| 设备B 打开真实聊天页并水合 | PASS | status=200 |
| 设备B 独立浏览器收到设备A消息 | PASS | seq 增量轮询自动到达，无刷新/无DB脚本注入 |
| 设备B 页面输入回车回复并自见 | PASS | Reply from device B — real browser 1795159273180 |
| 设备A 独立浏览器收到设备B回复 | PASS | seq 增量轮询自动到达 |
| 双端真实浏览器截图落盘 | PASS |  |
| DB 对账：两条消息均由真实浏览器落库 | PASS |  |
| DB 对账：发送者/接收者正确 | PASS |  |
| DB 对账：seq 单调递增 | PASS |  |
| DB 对账：带 clientMsgId（幂等锚点） | PASS |  |
| API receipt：两次 send 均 success | PASS |  |
| 负例：未登录 send → 401 | PASS | status=401 |
| 负例：伪造会话 send → 404 | PASS | status=404 |
| 负例：合法登录但非会话成员读消息 → 403/404 | PASS | status=404 |
| 页面无未捕获 JS 错误 | PASS |  |

## 截图（真实浏览器像素）

- `docs/v25.6/evidence/UX04_05/chat-device-A.png`
- `docs/v25.6/evidence/UX04_05/chat-device-B.png`

## 诚实边界

- 消息由两个隔离 BrowserContext 在真实页面 input 输入并回车发出，经 /api/im/send 鉴权落库，非 DB 脚本写入。
- 接收端靠页面自身的 afterSeq 轮询自动到达；Pusher 实时推送本轮未配置，未宣称实时性。
- 本轮为本地 next start + 隔离 file: 库，非生产；真人盲测、双物理设备、真实模型 AI 草稿不在此证明范围。
