# V19.5-24 · 焦点 Hook 审计（WB19-50）

> 分支 `v19/design-exploration`｜审计基线 `6fe9ece`｜审计时间 2026-10-28
> 本文只记录**读码 + 实测**得到的结论，不含推测。凡未验证的一律写「未验证」。

## 1. 被审对象

| 文件 | 角色 | 基线状态 |
|---|---|---|
| `src/lib/a11y/focus-trap.ts` | 纯算术：Tab 该去哪一格 | 2 个导出函数（`activeIndexIn` / `nextFocusIndex`） |
| `src/lib/a11y/use-dialog-a11y.ts` | DOM 生命周期：读现状 → 调纯函数 → 写回 | Escape / Tab / 初始焦点 / 恢复焦点 |
| `src/lib/a11y/scroll-lock.ts` | 背景滚动锁 | **不存在**（每个组件各自写 `body.style.overflow`） |
| `src/components/shared/confirm-dialog.tsx` | 使用方（危险操作确认） | 自带 Escape 监听 + 自带滚动锁 + 硬编码 `id="dialog-title"` |
| `src/components/chat/report-modal.tsx` | 使用方（举报弹窗，`MotionDiv` 容器） | 直接接 hook，容器 ref 挂在 `next/dynamic` 包装上 |
| `src/app/(auth)/register/page.tsx` | 使用方（多步注册） | 单一 `#reg-error` 横幅，字段级关联缺失 |

## 2. 十项检查逐条结论

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 是否只有一套焦点算法 | **现在是**（改造前也是，但只有 2 个函数，切分不清） | 全部 Tab 判断收敛到 `nextFocusIndex`；hook 内不再有 `if (isLast)` |
| 2 | 空列表如何处理 | 纯函数返回 `-1`；hook 捕获后 `preventDefault()` 并把焦点摁回容器 | `use-dialog-a11y.ts` 的 `usable.length === 0` 分支 |
| 3 | 初始焦点如何选择 | 优先级：显式 `initialFocusRef` → 首个可见表单项 → 首个可聚焦元素 → 容器本身 | `pickInitialFocusIndex` |
| 4 | Tab / Shift+Tab 如何循环 | 末位 Tab → 首位；首位 Shift+Tab → 末位；中间不干预（交浏览器） | `nextFocusIndex` + 单测 ①–⑥b |
| 5 | 禁用 / 隐藏 / 不可见如何排除 | `disabled` / `aria-disabled` 排除；隐藏排除，**但正持焦点的隐藏元素保留** | `isUsableCandidate`；`isVisible()` 并用 `offsetParent` 与 `getClientRects()` |
| 6 | DOM 动态变化后如何重算 | 每次 keydown **现场**重查 + 重过滤，不缓存列表 | `collect(container)` 在 handler 内调用 |
| 7 | Escape 由谁处理 | 唯一一处：`document` 捕获阶段监听，`stopPropagation` 后调 `onCloseRef.current()` | 捕获阶段是有意的：先于控件自己的 keydown，避免「Escape 关了下拉、弹窗没关」 |
| 8 | 关闭后焦点如何恢复 | 记录打开前的 `activeElement`；关闭时校验「仍连接 + 仍可见」才还回去 | `shouldRestoreFocus`；`body` 不作为恢复目标 |
| 9 | 多弹窗 / 嵌套弹窗 | 焦点：各自圈定（后开的 effect 后注册，捕获阶段先触发）；滚动锁：引用计数，归零才恢复 | `createScrollLock` 的 `depth` |
| 10 | 卸载时清理 | 取消 rAF、摘监听、释放滚动锁、按需还焦点 | effect cleanup |

## 3. 审计发现（6 项，均已处理或定性）

### D1 · Escape 被监听两次（已修）
`confirm-dialog.tsx` 自带 `document.addEventListener("keydown", …)`，同时 hook 也装了同一个键。
两个 handler 都会调 `onClose()` —— 单次关闭时看不出问题，但重复调用会把「关闭」的副作用（重置表单、打断动画）执行两遍。
**修法**：删掉组件内的监听，只留 hook 一处。

### D2 · 硬编码 `id="dialog-title"`（已修）
`ConfirmDialog` 用固定 id，页面上同时挂两个实例（`/dashboard/settings` 的 Delete 与 Export 两个 ConfirmDialog 就是常驻挂载）时产生重复 id，`aria-labelledby` 可能解析到另一份标题。
**修法**：`useId()` 生成 `titleId` / `descriptionId`，并补 `aria-describedby`（改造前描述文本根本没被关联）。
**验证**：`tests/e2e-ci/dialogs.spec.ts` 断言 `labelledby` / `describedby` 指向的 id 在页面上**唯一且存在**。

### D3 · 滚动锁互相踩（已修）
两个弹窗叠加时，先关的那个把 `body.style.overflow = ""`，底下还开着的弹窗页面就跟着滚；且原值从未被保存（页面若本来有内联 overflow，一开一关就丢了）。
**修法**：`scroll-lock.ts` 引用计数 + 保存原值；`confirm-dialog` 自己的锁删掉，统一由 hook 的 `lockScroll`（默认开）负责。
**验证**：`tests/a11y/scroll-lock.test.ts` 5 例（嵌套、幂等释放、原值恢复）；`dialogs.spec.ts` 断言开时 `hidden`、关后恢复 `""`。

### D4 · 懒挂载容器的首帧拿不到节点（已修）
`ReportModal` 的容器在 `LazyAnimatePresence` + `next/dynamic` 里，effect 跑完那一刻 DOM 可能还是 fallback，于是「初始聚焦」静默失败，焦点留在遮罩后面的触发按钮上。
**修法**：按帧重试（上限 30 帧 ≈ 500ms），一旦焦点已进入容器立即停手。
**未验证**：真实浏览器下的最终行为（Modal 在认证聊天面，无登录账号 ⇒ 见 `27`）。

### D5 · 恢复焦点前不校验目标（已修）
原实现无条件 `previouslyFocused.focus()`。触发按钮若在弹窗开着期间被卸载（列表刷新、路由切换），焦点会被丢到 `<body>`，读屏用户当场失去位置。
**修法**：`shouldRestoreFocus({stillConnected, focusable})` 双重校验。**验证**：单测 ⑫ 系列 4 例 + E2E「关闭后 activeElement 不是 BODY」。

### D6 · 危险操作确认框的初始焦点靠巧合（已修）
改造前初始焦点是「首个可聚焦元素」= DOM 里第一个按钮 = 取消。**结论对，但理由不对**：只要有人在取消按钮前插一个图标按钮，焦点就会落到破坏性动作旁边，「回车 = 删账号」变成一次误触。
**修法**：hook 支持 `initialFocusRef`，`ConfirmDialog` 显式指向取消按钮。
**验证**：E2E 断言初始焦点为 `Cancel` 且**不是** `Delete Account`。

## 4. 报出但本轮不处理（定性）

| 编号 | 事项 | 为什么不修 |
|---|---|---|
| O1 | 关闭动画期间（`AnimatePresence` exit）焦点已恢复、滚动锁已释放，视觉上弹窗还在 | 属动画与语义的时序问题，需要按组件评估 exit 时长；`ConfirmDialog` 无 exit 动画，`ReportModal` 有但无法实测（见 D4/`28`） |
| O2 | 嵌套弹窗的焦点不隔离（后开的弹窗关掉后，前一个弹窗不再抢回焦点） | 当前产品无嵌套场景；`confirm-dialog` 是叶子节点。等出现嵌套再设计，不预先过度工程 |
| O3 | `FOCUSABLE_SELECTOR` 未包含 `[contenteditable]` / `summary` / `audio[controls]` | 本产品无这些控件。加上会改变既有 Tab 序列，属于「无收益的风险」 |

## 5. 分工原则（本轮确立，后续沿用）

```
focus-trap.ts   ← 只算，不碰 DOM，可在 node 里跑
use-dialog-a11y ← 只读 DOM + 调纯函数 + 写 DOM
scroll-lock.ts  ← 只做计数，target 可注入
组件            ← 只声明语义（role/aria/ref/initialFocusRef），不写键盘逻辑
```

判据：**如果一段逻辑需要 DOM 才能算，它就不该进纯函数；如果需要算才能写 DOM，它就不该留在组件里。**
