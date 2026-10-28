# V19.5-25 · 焦点算法单测（WB19-51）

> 运行方式：`node node_modules/jest/bin/jest.js tests/a11y`
> 环境：仓库既有 Node Jest（`testEnvironment: 'node'`）——**未引入 jsdom**。
> 最近一次结果：**2 suites / 29 tests / 29 passed**（2026-10-28）

## 1. 为什么不需要 jsdom

纯函数 `focus-trap.ts` 不 import 任何 DOM 类型，输入是「候选元素描述符 + 数量 + 索引」，输出是「该去哪一格」。
所以「禁用元素算不算可聚焦」这件事可以拆成两半：

- **读**：`el.hasAttribute('disabled')` / `offsetParent` —— DOM 侧，归 hook；
- **判**：`disabled === true ⇒ 不可用` —— 纯算术，归单测。

把判定下沉之后，边缘条件（空列表、越界索引、动态删增）在 node 里就能穷举，
不必为了「测一下 disabled 会不会被跳过」去装一整套 DOM 依赖 —— 那会把测试成本转嫁给每一个后续提交。

## 2. 场景覆盖（要求 ≥12，实际 24 + 5）

| 要求场景 | 用例 | 断言要点 |
|---|---|---|
| ① 空元素列表 | `nextFocusIndex(0, …)` / `pickInitialFocusIndex([])` | 返回 `-1`，不抛异常、不返回 0 |
| ② 单元素 | `nextFocusIndex(1,0,false/true)` | 两个方向都停在它自己（`0`），不是 `-1` |
| ③ 多元素（中间） | `nextFocusIndex(3,1,…)` | `-1` = 不干预，交给浏览器默认行为 |
| ④ Tab 到末尾 | `nextFocusIndex(3,2,false)` | 回卷到 `0` |
| ⑤ Shift+Tab 到开头 | `nextFocusIndex(3,0,true)` | 回卷到 `2` |
| ⑥ 当前元素不在列表中 | `nextFocusIndex(4,-1,…)`、索引越界 `(2,5,…)` | 按方向拉回圈内（`0` / `n-1`），越界不透传 |
| ⑦ 禁用元素 | `isUsableCandidate` / `filterUsable` | `disabled` 与 `aria-disabled` 都排除；过滤**保持原顺序** |
| ⑧ 隐藏元素 | 同上 | 隐藏排除，但 `hidden && isCurrent` **保留**（见 §4） |
| ⑨ 动态删除 | `nextFocusIndex(4,3,false)` → `(3,3,false)` → `(3,2,false)` | 列表缩短后旧索引越界 ⇒ 拉回 `0`；新末位同样回卷 |
| ⑩ 动态插入 | `(2,1,false)` vs `(3,1,false)` | 由 `0`（回卷）变 `-1`（不干预）——证明判断跟着列表走，不沿用旧结论 |
| ⑪ 初始焦点候选缺失 | `pickInitialFocusIndex` 4 例 | 有表单项 → 它；无 → 首个；空 → `-1`；首个表单项被禁用 → 跳过 |
| ⑫ 焦点恢复目标失效 | `shouldRestoreFocus` 4 例 | 已卸载 / 不可聚焦 / `null` 都返回 `false`；只有「在 + 可见」才 `true` |
| 附加 | 越界穷举（count 1/2/5/13 × active −2…count+2 × 两方向） | 返回值恒在 `{-1} ∪ [0,count)`；并断言枚举**真的产生了多个取值**（防空集恒真） |
| 附加 | `activeIndexIn` | 合法原样、容器外/越界/空容器统一 `-1` |

## 3. 不在这 29 例里的东西（明确下沉到 E2E）

| 事项 | 归谁 | 在哪个文件 |
|---|---|---|
| 浏览器**真的**把焦点移过去了吗 | Playwright | `tests/e2e-ci/dialogs.spec.ts` |
| `preventDefault()` 有没有漏 | Playwright | 同上（Tab 三轮仍留在 dialog 内） |
| 打开瞬间焦点进容器、关闭后回到触发按钮 | Playwright | 同上 |
| `aria-labelledby` 指向的 id 是否唯一 | Playwright | 同上 |
| 滚动锁**真的**写到了 `document.body` | Playwright | 同上（读 `body.style.overflow`） |

> 一句话：**纯函数测试证明「算得对」，Playwright 证明「按下去真的动了」。**
> 只做前者却宣称「Focus Trap 通过」，是这一轮明确要避免的错误。

## 4. 两个刻意的判定

**⑧「隐藏元素」保留特例**：`offsetParent === null` 不只出现在 `display:none` 上，也会出现在 `position:fixed`
的祖先链里。如果把「正拿着焦点的元素」也一并过滤，`findIndex(activeElement)` 会长期返回 `-1`，
于是每次 Tab 都被当成「焦点在圈外」拉回第一个 —— 用户会觉得 Tab 失灵。所以判据是
`hidden && !isCurrent`，并用 `getClientRects().length > 0` 兜住 `fixed` 布局。

**越界穷举用例必须断言覆盖度**：本仓踩过「空集恒真」的坑（集合断言在先证前置非空）。
所以那条 `for` 循环之后除了逐个 `throw`，还断言 `seen.size > 1 && seen.has(-1) && seen.has(0)` ——
否则一旦循环写错（比如 `count` 传空数组），它会以「零断言」的姿态变绿。

## 5. CI 可行性

`jest.config.js` 的 `testMatch` 只收 `**/tests/**/*.test.ts`，`tests/a11y/*.test.ts` 已在其中；
`testPathIgnorePatterns` 只排除 `tests/e2e/` 与 `tests/e2e-ci/`，不会误伤。
本次新增的 `tests/e2e-ci/dialogs.spec.ts` 是 Playwright 用例，命名 `.spec.ts` 但位于被排除目录，**不会**进 jest。

已实测：`jest tests/a11y` → 29/29 通过，耗时 ~28s（含 ts-jest 编译）。
