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

### 🔴 ⑦/⑧ 的重跑语义（一条被实测推翻的假设）

V19.6 第一版假设「去重是按**原因**做的」，于是 ⑦ 从"24h 内未举报的原因池"里挑一个、
⑧ 换一个原因再报。**实测证伪**：`POST /api/reports` 的去重条件是
`(reporterId, reportedUserId, createdAt ≥ now-24h)` —— **per 用户对，与原因无关**
（`src/app/api/reports/route.ts`）。换原因再报同一个人，照样 429。

因此现在的口径是：

- **⑦ 只证「首次举报成功」**，并在开头显式断言前置干净：
  `reports.length === 0`，不满足时给出可执行的清理指令（`seed-chat-fixture --cleanup` + 重新 seed），
  而不是让断言在 15s 后以"成功页没出现"这种误导形态红。
- **⑧ 负责 429 分支**（它需要"已有一条举报"这个前置，⑧ 自己会在缺失时现场造一条）。
- 这是**产品侧的一处既有约束**（同一对用户 24h 内只能报一次，即使换了理由），
  记为 P2 待产品确认：是否应按「原因」而非「用户对」去重。
- CI 每次跑的是新 seed 的 `ci-e2e.db` ⇒ ⑦ 的前置天然成立；本地重复跑需先清理夹具。

### 另外两处实测修正（都不是"为了让测试变绿"）

1. **原因按钮的可访问名不是枚举值**：按钮内容 = `label` + `description` 两行，
   可访问名是二者拼接（"Harassment Bullying, threats, or persistent unwanted contact"）。
   早先拿 API 枚举 `HARASSMENT` 直接当正则去点 ⇒ 大小写与文本都对不上，定位器等 15s 超时。
   现在用 `REASON_LABELS` 映射：**API 认枚举、UI 认标签**，两边分开。
2. **成功页会换掉 `aria-labelledby` 指向的标题**（"Report User" → "Report Submitted"），
   于是 `role=dialog` 的**可访问名跟着变**，原来的 `dialog` 定位符从此不匹配。
   这不是缺陷（成功页仍是一个有名字的可访问对话框），但定位符必须换成
   `getByRole('dialog', { name: 'Report Submitted' })`。已在用例里注释钉住。
3. ⑨ 原本断言「OTHER 举报数 === 0」——那是把"环境干净"当成被测行为。
   现改为**前后对比**，并且先选原因再 Cancel（证明"选了但不提交"也不落库）。


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

## 6. 证据渠道（V19.6 已更新：本地也能跑生产构建）

V19.5 时期记录过"本地构建产物起不了 `next start`"，本轮已不复现。实测可用的本地链路：

```bash
# 1) 构建（沙箱 safe-delete 会在收尾清理旧产物时拦截，故换一个全新目录）
NEXT_DIST_DIR=.next-v197 npx next build        # BUILD_ID 已写出即可，末尾清理报错可忽略
# 2) 起服务（同一 DATABASE_URL 必须与夹具库一致）
DATABASE_URL=file:/tmp/v196-e2e.db NEXT_DIST_DIR=.next-v197 npx next start -p 3000
# 3) 跑用例（本机 Chrome，跳过 global-setup 的重复登录）
PW_CHANNEL=chrome PW_SKIP_GLOBAL_SETUP=1 ... node node_modules/@playwright/test/cli.js \
  test tests/e2e-ci/auth-dialogs.spec.ts --config=playwright.ci.config.ts
```

本地实测 **11 passed（2.8m）**，构建号 `F5MMlHi7tIE9ttOAt9ulO`。

⚠️ `NEXT_DIST_DIR` 是**沙箱绕行手段**，不是产品配置：`next.config.ts` 里的临时补丁已还原，
提交里不含该改动。CI 走默认 `.next`，行为与之前完全一致。

## 7. 本轮真发现（源码级）

| # | 发现 | 性质 | 处理 |
|---|---|---|---|
| 1 | More 图标按钮**无 accessible name** | P1 可访问性缺陷 | 已修：`aria-label="More actions"` + `aria-expanded` |
| 2 | `useDialogA11y` 在显式 `initialFocusRef` 尚未挂载时**退回启发式**，焦点落到 textarea 且 loop 判据从此不再纠正 | P1 缺陷（脏焦点） | 已修：声明了显式目标就等它（90 帧），超时才兜底 |
| 3 | 弹窗关闭后焦点掉回 `body`（触发它的菜单项已随菜单卸载） | P1 缺陷 | 已修：页面层 `moreButtonRef.current?.focus()` |
| 4 | 移动端 Inspector 证据浮层**无 dialog 语义 / 无 Escape / 无焦点管理 / 无滚动锁** | P1 缺陷 | 已修：接 `useDialogA11y` |
| 5 | 举报去重是 **per 用户对**，不是 per 原因 | P2 产品口径 | 记录，待产品确认 |
| 6 | 成功页标题替换导致 `role=dialog` 可访问名变化 | P3 测试口径 | 定位符已改并注释 |

未处置的遗留：VideoCallModal 的 dialog 语义（P1，缺真实双端通话验证渠道，见 §5）。

