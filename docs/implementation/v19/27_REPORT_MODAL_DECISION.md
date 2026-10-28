# V19.5-27 · ReportModal 的 ref 决策（WB19-54）

> 文件：`src/components/chat/report-modal.tsx`
> 结论：**不再依赖 `MotionDiv` 的 ref 透传**，语义与焦点容器换成动画层内部的真实 `div`。
> 浏览器验收状态：**BLOCKED**（认证聊天面，无可用登录账号），解除条件见 §5。

## 1. 争议点

上一轮给 `ReportModal` 接 `useDialogA11y` 时写成 `<MotionDiv ref={dialogRef} role="dialog">`，
随后因为「无法确认 `next/dynamic` 会不会把 ref 传到 DOM」主动回退了。
这个回退是对的：**没有证据的改动不该进生产聊天链路**。本轮先把证据补齐。

## 2. ref 链路的实际结构（读 next 源码，非推测）

`@/components/ui/motion-lazy` 的 `MotionDiv` 是：

```tsx
const MotionDiv = dynamic(
  () => import('framer-motion').then((mod) => {
    const Div = ({ children, ...props }: any) => <mod.motion.div {...props}>{children}</mod.motion.div>;
    return { default: Div };
  }),
  { ssr: false, loading: () => <MotionFallback /> }
);
```

`next/dynamic`（v16.4.2）在 `dist/shared/lib/app-dynamic.js` → `lazy-dynamic/loadable.js` 里实现为：

```js
const Lazy = React.lazy(() => opts.loader().then(convertModule));
function LoadableComponent(props) {           // ← 注意：普通函数组件，没有 forwardRef
  ...
  return <Lazy {...props} />;
}
```

所以这条链是：

```
<MotionDiv ref={x}>
  → LoadableComponent(props)        普通函数组件，无 forwardRef
  → <Lazy {...props}>               React.lazy
  → Div({children, ...props})       普通函数组件，无 forwardRef
  → <mod.motion.div {...props}>     framer-motion
  → 真实 DOM 节点
```

`ref` 能不能到达最后一层，取决于 **React 19 的「ref 作为 props 传递」** 在贯穿「lazy + 两层普通函数组件」时是否保留该字段。
这不是文档里能读到的一句话，而是实现细节；在本仓既没有先例、也没有测试可以证明。
**结论：不能声称 ref 可靠。**

## 3. 决定：让这个问题消失，而不是赌它能通

采用任务书给出的替代方案（"在动画容器内放置真实 DOM Dialog 容器，并将 Hook 绑定到该元素"）：

```
<MotionDiv 遮罩层 …>                      ← 只有动画 + 点击关闭，不承载语义
  <MotionDiv 面板动画 …>                  ← 只有 scale/opacity，不承载语义
    <div ref={dialogRef} role="dialog"    ← 真实 DOM，ref 100% 有值
         aria-modal aria-labelledby>
      内容
    </div>
  </MotionDiv>
</MotionDiv>
```

收益不只是「ref 可靠」：

- `aria-modal` / `role` / `aria-labelledby` 挂在一个**非动画**节点上，读屏不会因为动画层的属性透传规则而拿到意外的语义；
- 焦点圈定的容器就是用户视觉上看到的那个面板，边界与视觉一致；
- 万一 `next/dynamic` 升级后改了透传行为，这段代码**不受影响**（它本来就不依赖）。

同批修掉的语义缺陷：

| 项 | 改前 | 改后 |
|---|---|---|
| 对话框名字 | `aria-label="Report user"`（写死英文） | `aria-labelledby` → 真实 `<h3>`（成功态与表单态都用 `useId` 的同一个 id，二者互斥渲染，不会重复） |
| 错误播报 | 红字，无 `role` | `role="alert"` + `id` + 面板 `aria-describedby` |
| 原因选择 | 6 个无状态按钮，外观变蓝但读屏不知道选了谁 | `role="group"` + `aria-labelledby`（原 `<label>` 没有可关联控件）+ 每个按钮 `aria-pressed` |
| 初始焦点 | 首个可聚焦元素（右上角关闭按钮） | 显式指向第一个原因按钮（任务就是选原因） |
| 关闭按钮 | 有 `aria-label`（上一轮已补） | 保留 |

## 4. 为什么这一轮判定为 BLOCKED 而不是 PASS

任务书要求「只有真实浏览器测试通过，才能判为 PASS」。
`ReportModal` 唯一的入口是 `/dashboard/chats/[roomId]`，需要**已登录且存在一个聊天室**：

- 生产库的 QA 账号已于上一轮清理，登录会 401（`qa:probe:login` 定性过）；
- 本地隔离环境（`/tmp` 工作树 + `ci-e2e.db`）本轮用于跑公开面与 `ConfirmDialog`，
  没有构造「两个用户 + 一个聊天室」的夹具；
- 给聊天面造夹具会写真实的聊天/举报链路数据，属「不可逆迁移」范畴，需要单独授权。

因此：**实现**（结构、语义、焦点策略）已完成且可静态核验；**行为**（真实浏览器 8 类键盘行为）未验证。

## 5. 解除条件（缺一不可）

1. 可登录的测试账号（D-06），或本地夹具脚本 `scripts/qa/seed-chat-e2e.mjs`（需新建，含 2 用户 + 1 room）；
2. 在该环境跑一遍：初始焦点 = 第一个原因按钮 / Tab 圈定 / Shift+Tab 圈定 / Escape 关闭 / 焦点回到触发按钮 /
   关闭动画期间不出现「焦点已回、视觉还在」的可操作窗口 / `aria-pressed` 随选择变化 / 提交失败时 `role="alert"` 播报；
3. 结果写入本文件 §6 并把状态改为 PASS。

## 6. 行为验收记录

| 用例 | 状态 | 证据 |
|---|---|---|
| 初始焦点 = 第一个原因按钮 | 未验证 | — |
| Tab / Shift+Tab 圈定 | 未验证 | — |
| Escape 关闭 | 未验证 | — |
| 焦点归还触发按钮 | 未验证 | — |
| `aria-pressed` 跟随选择 | 未验证 | — |
| 提交失败播报 | 未验证 | — |
| 关闭动画期间焦点/滚动锁时序 | 未验证 | — |
| 生产聊天链路未被破坏 | 已保证 | 改动仅在弹窗内部节点层级，未触碰 `chat-container.tsx` 与 `/api/reports` |
