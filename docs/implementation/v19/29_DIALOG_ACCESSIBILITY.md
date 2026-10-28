# V19.5-29 · 对话框可访问性验收（WB19-52 / WB19-56 交叉）

> 用例：`tests/e2e-ci/dialogs.spec.ts`（10 例）
> 运行环境：CI job「E2E（构建产物 · 浏览器冒烟）」——**构建产物 + 真实 Chromium + 真实登录态**
> 结论：`8301454` 该 job **success（4m03s）**；本文逐条列出每条用例想证明什么，以及**没有**证明什么。

## 1. 为什么要另起一份 Playwright，而不是只信单测

`focus-trap.test.ts` 能证明 `nextFocusIndex(3, 2, false) === 0`。
它无法证明「按 Tab 之后 Chromium 真的把焦点移到了第一个按钮」—— 中间还隔着一层：
`event.preventDefault()` 有没有调、`document.activeElement` 到底是谁、浏览器有没有因为元素不可见而拒绝聚焦。

这两层必须分开测，份量也不能互相顶替。

## 2. 用例清单（10 例）

| # | 用例 | 断言的可观察事实 |
|---|---|---|
| 1 | 语义完整 | `role=dialog`、`aria-modal=true`、`aria-labelledby`/`aria-describedby` 指向的 id **在页面上唯一且存在**，标签文本为 `Delete Account`，描述含 `cannot be undone` |
| 2 | 初始焦点 | `document.activeElement` 文本 = `Cancel`；且**不是** `Delete Account` |
| 3 | Tab 圈定（正向） | `Tab` → Delete Account，`Tab` → Cancel，再 `Tab` 仍在 dialog 内（`dialog.contains(activeElement)`） |
| 4 | Shift+Tab 圈定（反向） | `Shift+Tab` → Delete Account，再 `Shift+Tab` → Cancel |
| 5 | Escape 关闭 + 焦点归还 | dialog 隐藏；焦点回到触发按钮（`Delete`） |
| 6 | 取消关闭 + 焦点归还 | 同上，走点击路径 |
| 7 | 背景滚动锁 | 开：`body.style.overflow === 'hidden'`；关：`''` |
| 8 | 焦点不落 body | 关闭后 `activeElement.tagName !== 'BODY'` |
| 9 | 视口 390×844：初始焦点 + Tab 圈定 + 滚动锁 | 移动布局下按钮仍然可见可聚焦（若被挤出视口，`isVisible()` 过滤会让圈少一格，这里能抓到） |
| 10 | 视口 1440×900：同上 | 宽屏下同样成立 |

## 3. 为什么挂在 `/dashboard/settings`

`ConfirmDialog` 的全部消费者都在认证面（`chat-container`、`admin/*`、`dashboard/settings`）。
其中 `/dashboard/settings` 的 **Privacy → Danger Zone → Delete Account** 是唯一「一键可达、
`variant="danger"`、且不会真的改数据（只要不点确认）」的入口 —— 它同时满足：

- 危险操作：初始焦点策略在这里有安全含义，不是审美偏好；
- 两个 ConfirmDialog 常驻挂载：正好能验证 `useId` 消重（改前都是 `id="dialog-title"`）；
- 只打开/关闭：用例**不点**确认，不产生任何写操作。

## 4. 本地为什么没跑成（如实记录）

| 尝试 | 结果 | 原因 |
|---|---|---|
| 在 `/tmp` 隔离工作树 `next build`（Turbopack） | 失败 | `node_modules` 是符号链接，Turbopack 判定「Next 装在工作区之外」，拒绝编译 |
| 同上，改 `--webpack` | 编译成功 16.8min，**类型检查失败** | webpack 模式生成的 `.next/types/**` 与仓库的 typed routes 不兼容（报错全在生成文件里，不在源码），与本次改动无关 |
| 在真实仓库 `next build` | 未执行 | 仓库根有 `.env`（指向生产 Turso），为避免任何误连生产库的风险，不在此树构建 |
| `prisma db push` / 两个迁移脚本 | 成功 | 仅在隔离树、且 `--url=file:...` 显式指向本地库 |

因此：**浏览器证据来自 CI，不是本地**。这在证据强度上没有损失（同为构建产物 + 无头 Chromium），
但意味着本轮没能做「失败→改→重跑」的本地快速迭代；两次 CI 轮次之间只能靠注解定位。

## 5. 没证明的事（不许被 §2 掩盖）

1. **屏幕阅读器体验**：没有 NVDA / VoiceOver 的朗读记录。`role`/`aria-*` 齐全 ≠ 播报顺序合理。
2. **`ReportModal`**：本文件完全没覆盖它（见 `27_REPORT_MODAL_DECISION.md`，BLOCKED）。
3. **axe-core**：本轮**没有**接入 `@axe-core/playwright`。任务书把它列为 P0 工具，
   本轮的实际替代是「逐条手写断言 + 单测」，覆盖面小于 axe 的规则集；
   这是本轮的明确缺口，已记入 `30_V19_5_ACCEPTANCE.md` 的 P1。
4. **四视口全覆盖**：只做了 1280（默认）+ 390 + 1440，768 未单独一档（理由见用例注释：
   与 390 同属单列断点）。任务书要求 4 档，这里是 3 档。
