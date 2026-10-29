# 32 · AUTH DIALOG E2E（WB19-61 · V19.6）

日期：2026-10-29　分支：`v19/design-exploration`

## 1. 交付物

`tests/e2e-ci/auth-dialogs.spec.ts` —— 认证面弹窗第一次拥有**真实浏览器键盘证据**：
真实登录表单 → 真实聊天页 → 真实弹窗 → 真实 API（不 mock 任何结果）。

CI 前置：`seed-chat-fixture.mjs` 提供 `E2E_CHAT_A_*` / `E2E_CHAT_C_*` / `E2E_CHAT_CONV_ID`。
**缺夹具 = 硬红**（throw，不做 skip —— skip 会把缺口伪装成通过）。

## 2. 代码修复（先修缺陷，再让用例钉住它）

| 文件 | 缺陷（审计发现） | 修复 |
|---|---|---|
| `page-content.tsx`（聊天头） | MoreVertical 图标按钮**无 accessible name**（读屏用户听不到它是什么），也无 aria-expanded | 补 `aria-label="More actions"` + `aria-expanded` |
| `living-shell.tsx`（移动端证据浮层） | 浮层无 `role="dialog"`/`aria-modal`、无 Escape、无焦点管理、无滚动锁 —— 键盘用户 Tab 会穿到背景页面 | 接 `useDialogA11y`（真实 div 容器，ref 安全）+ `role/aria-modal/aria-label` |

不动的东西：焦点纯函数（`focus-trap.ts`）、滚动锁（`scroll-lock.ts`）、hook 本体 —— 全部复用 V19.5 实现。

## 3. ReportModal 行为矩阵（9 条用例）

| # | 行为 | 判据 |
|---|---|---|
| ① | More 按钮可发现、可键盘打开 | `getByRole('button', { name: 'More actions' })` + Enter → dialog 可见 |
| ② | 语义完整 | role/aria-modal/aria-labelledby，且 labelledby 指向真实存在的标题节点 |
| ③ | 初始焦点 | 第一个举报原因按钮（显式 `initialFocusRef`，不是关闭 X） |
| ④ | Tab 圈定 | 连续 14 次 Tab，`dialog.contains(activeElement)` 恒真 |
| ⑤ | Shift+Tab 反向 | 6 次反向同样不逃逸 |
| ⑥ | Escape + 焦点恢复 + 滚动锁 | Escape 关闭 → 焦点回 More 按钮；打开时 `body.overflow=hidden`，关闭后释放 |
| ⑦ | 提交成功 + 真实落库 | 动态选未用过的原因 → `Report Submitted` → `GET /api/reports?type=my-reports` 看到该条 |
| ⑧ | 重复举报 429 | 错误以 `role=alert` 在弹窗内播报（不无声失败） |
| ⑨ | Cancel | 关闭且不产生 OTHER 举报 |

⑦/⑧ 做了**重跑安全**：原因从「24h 内未举报的池」里动态挑（夹具库跨轮复用不会撞 429 假红）。

## 4. 跨租户（ENV-04）

userC（租户 B、会话外）：
- 契约层：`GET /api/im/conversations/<conv>` → **404**（`resolveConversationRef` 对非参与者返回 null，不泄露会话存在性）；
- UI 层：页面不渲染对方姓名与消息内容。

## 5. VideoCallModal · 适用行为矩阵（UX-03）

审计结论（先记录，不盲目改造）：
- 全屏接管层（`.video-call-modal`），**无 dialog 语义、无焦点管理、无 Escape**；
- 关闭路径只有「挂断」；来电 UI 由 store 的 RINGING 驱动；
- 真实通话链路依赖 WebRTC 信令与对端在线，CI 无法验证"通话质量"。

已验证的适用行为（不伪造通话成功）：
- 点击视频按钮 → 通话 UI 出现（CALLING/CONNECTING/错误均为**真实状态**）；
- 挂断 → 通话层消失 → 聊天输入区仍可用（不破坏聊天、不丢上下文）。
- 浏览器以 `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` 启动
  （config 级 launchOptions，只影响 getUserMedia 调用方，对其他用例零副作用）+ camera/mic 权限。

**遗留 P1**：VideoCallModal 的 dialog 语义与焦点管理未实现 —— 在没有真实双端通话验证
渠道的情况下强行加 focus trap，风险大于收益（与 V19.5 ReportModal 的回退同理）。
解除条件：双用户通话夹具 + 真实信令联调环境。

## 6. 证据渠道

本地构建产物无法起 `next start`（V19.5 已证：Turbopack 拒绝符号链接 node_modules），
因此浏览器证据由 **CI e2e job（本地构建产物 + Playwright）** 产出；
结论以 GitHub check-run 的 E2E job 为准。
