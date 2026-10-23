# Legacy B2C 移动端审计（WB18-34）

> UX-08 一直 BLOCKED 的最后一块：`/dashboard/*` 这条 legacy 线**一条版面证据都没有**。
> 本文交付的是**四视口实测 + 新进 CI 的门禁**，以及它第一次跑就抓到的东西。

- 用例：`tests/e2e-ci/legacy-mobile.spec.ts`（24 条版面 + 3 条交互）
- 夹具：`scripts/qa/seed-authed-e2e-user.mjs` 造的隔离库账号（globalSetup 登录一次）
- 视口：**390×844 · 360×800 · 768×1024 · 1440×900**

---

## 1. 先纠正任务书里的路由（实测）

| 任务书写法 | 实测 | 结论 |
|---|---|---|
| `/dashboard/chats` | 未登录 307 → `/login`；登录 200 | ✅ 存在 |
| `/matches` | **404** | ❌ 不存在 |
| `/profile` | **404** | ❌ 不存在 |
| — | `/dashboard/profile` 存在 | 真实资料页 |
| — | `/dashboard/matches` → **308** → `/dashboard/connections` | 真实"匹配操作"面是 `connections` |

**为什么必须纠正**：拿一个 404 页面去量"有没有横向溢出"，结论是"没有"，
但它证明的是"404 页面没有溢出" —— 这类结论比没有结论更糟，因为它看起来像证据。

所以本组按**真实路由**测六屏：
`/dashboard/chats`、`/dashboard/connections`、`/dashboard/profile`、
`/dashboard/notifications`、`/dashboard/explore`、`/dashboard/settings`。

---

## 2. 判据（与主线共用同一份）

| 项 | 判据 | 适用 |
|---|---|---|
| 横向溢出 | `scrollWidth - clientWidth ≤ 1px` | 4 视口全判 |
| 触控目标 | `≥ 24×24`（WCAG 2.2 AA 2.5.8） | **4 视口全判** |
| 真实内容已加载 | 等到该页**专属锚点**（不是骨架）才开量 | 全部 |
| 遮挡 | `elementFromPoint` 命中元素中心必须是它自己 | 关键 CTA |
| 未捕获异常 | `pageerror` 必须为空 | 全部 |
| 控制台错误 | 只统计、不判红 | 全部 |

**关于 1440 为什么也判红**：原计划是"移动端补证"，桌面只统计。
但第一次跑就暴露了一个问题：那段"仅统计"的分支**永远走不到** ——
`assertMobileLayout()` 内部已经把 `tooSmall` 断言掉了，外面的 annotation 分支是死代码。
也就是说，文档里写着"1440 不判红"，代码却在判红。**这种不一致比判据太严更危险。**

于是改成四个视口同一把尺子，然后按它修：1440 当时只报出**页脚 4 个 16px 链接**，
补 `min-h-6 px-1` 即过（只补可点区域，不改字号与间距）。
没有引入 `enforceTouch: false` 这种开关 —— 一个会骗人的开关比一条更严的判据危险得多。

**为什么必须等锚点**：这些页的 `loading.tsx` / `dynamic({loading})` 骨架里
**一个 `<h1>` 都没有**（逐个核过），所以「锚点出现」是"真内容到了"的可证信号。
上一轮 `/console` 的假绿就是因为量到了骨架 —— 同一类错误不能在第二条线上重犯。

---

## 3. 第一轮结果（`1170073`）：1 个真缺陷 + 2 个我自己的错

### 3.1 真缺陷（门禁抓对了）

```
768×1024 · /dashboard/chats
a "Discover people →" → /dashboard/explore   实测 119×20   门槛 24
```

- 位置：`src/app/(dashboard)/dashboard/chats/layout.tsx:314`，`inline-block text-sm`，无纵向内边距。
- **为什么只有 768 报**：手机宽度下列表面板不显示，这条链接不在视口里；平板/桌面才暴露。
  ⇒ 这恰好证明了"只测 390/360"会漏掉哪一类缺陷，也就证明了四视口的价值。
- 修法：`inline-flex items-center min-h-6 px-1`（只补可点区域，不改字号/位置）。

### 3.2 第二个真缺陷：桌面页脚 4 个 16px 链接（第二轮抓到）

```
1440×900 · /dashboard/{chats,connections,profile,notifications,explore,settings}
a "Privacy"  [40×16]   a "Terms" [34×16]
a "Cookies"  [44×16]   a "Support" [44×16]
```

- 位置：`src/components/layout/dashboard-footer.tsx`，四个链接都是纯 `text-xs`、无内边距。
- 为什么只有 1440 报：页脚外层是 `hidden lg:block`，1024px 以下根本不渲染。
- 这四屏在 390/360/768 全部干净 ⇒ **如果没有 1440 这一档，这个缺陷永远不会被发现。**
- 修法：抽一个 `FOOTER_LINK` 常量，统一 `inline-flex items-center min-h-6 px-1`。

### 3.3 两个锚点是我选错了（不是页面的问题）

| 页面 | 我写的锚点 | CI 说了什么 | 真相 |
|---|---|---|---|
| `/dashboard/explore` | `h1:has-text("Discover")` | 20s 等不到 | 该页三态：loading（无标题）/ **空态 h2「No more profiles」** / 有候选人（h1「Discover」）。夹具无候选人 ⇒ 必然落在空态 ⇒ 我等了一个**按设计不会出现**的元素 |
| `/dashboard/chats` | `text=LokFee! Messages` | 解析到了，但 `hidden` | 手机上聊天布局只渲染列表面板，页面那份空态是隐藏的 |

**共同点**：锚点必须是**目标视口下真的可见**的元素。
用 `toBeVisible()` 而不是 `toBeAttached()` 就是为了这个 —— 元素在 DOM 里不算数。

修正后的锚点：

| 页面 | 锚点 | 为什么它稳定 |
|---|---|---|
| `/dashboard/chats` | `input[placeholder="Search or start new chat"]` | 布局内搜索框，所有宽度都渲染 |
| `/dashboard/explore` | `h1「Discover」` 或 `h2「No more profiles」` | 两种终态都接受，loading 态没有标题 |

### 3.4 交互探针（只读）

| 探针 | 结果 |
|---|---|
| 资料页姓名输入框可编辑、可回读、高度 ≥24px | 通过（写入后立刻还原，不提交） |
| 连接页空态给出下一步，CTA 未被底栏遮挡 | 通过 |
| 聊天空态给出「Discover people →」，高度 ≥24px，未遮挡 | 修复后通过（该判据已钉进用例） |
| **聊天输入框** | **NOT_APPLICABLE** |

**为什么聊天输入框是 N/A**：输入框在 `/dashboard/chats/[roomId]`，
夹具里没有任何真实会话；而且长连接页面无法稳定测量。
这条**不拿列表页的空态冒充**"聊天可用"。

### 3.5 第三轮（`dfeb4fb`）：24 条版面全过，3 条探针**全红** —— 全是我自己的选择器

第一轮修完页面、第二轮修完页脚之后，第四轮跑出来的是：

```
Legacy B2C · 交互可用性（390×844 · 只读）
  ✘ 资料页的姓名输入框可编辑、可回读
  ✘ 连接页的空态给出可用的下一步，且没有被底栏压住
  ✘ 聊天列表在手机上给出真实出路，且那条链接够大、没被遮住
24 条视口用例：全部通过
```

三条一起红，而页面本身在同一轮里 24 条版面用例全绿 —— 这个组合本身就在提示：
**红的是尺子，不是产品**。逐条追下去：

| 探针 | 报错 | 真正原因 | 修法 |
|---|---|---|---|
| 连接页 CTA 遮挡 | 「拿不到 boundingBox」 | `a[href].first()` 命中了**隐藏的同名链接**（侧栏/底栏的副本在 DOM 里排前面） | 选择器加 `:visible` |
| 聊天出路链接 | 「元素不存在」 | 用了 `main a[href]`，而该布局的 `<main>` 里没有这个锚点结构 | 改成 `a[href]:visible` |
| 连接页 CTA 遮挡（第二层） | 命中的元素莫名其妙 | `assertNotOccluded` 收的是**选择器字符串**，内部再 `querySelector` 解析一次 ⇒ 与 Playwright 的 `.first()` **可能不是同一个元素**；且 `:visible` 是 Playwright 伪类，`document.querySelector` 根本不认 | 改收 **Locator**，box 与 element 由同一个对象交出 |

三条的共同点值得记下来：

> **Playwright 的 `.first()` 和 `document.querySelector` 的第一个，不保证是同一个元素。**
> 只要中间换过一次解析，"我量到的"和"我断言到的"就可能不是同一个东西 ——
> 这种红看起来像产品缺陷，实际是测量误差，比漏测更难查。

修完后（`bba8c36`）：**24 + 3 = 27 条全绿**，E2E job `success`（run `39920104501`，
步骤「失败时打印服务端日志」与「把 Playwright 失败明细写进 CI 摘要」双双 `skipped` ⇒ 零失败）。

---

## 4. UX-08 的状态（不因为做了一批就升）

| 项 | 之前 | 现在 |
|---|---|---|
| 公开面 6 路由 × 2 视口 | 有证据 | 有证据 |
| 认证面 9 屏 × 2 视口 | 有证据 | 有证据 |
| `/workspace` 6 页签 × 2 视口 | 有证据 | 有证据 |
| **legacy B2C 6 屏 × 4 视口** | **无证据** | **有证据：27 条全绿（`bba8c36`），4 视口同标准，已进 CI** |
| **`/dashboard/chats/[roomId]`** | 无 | **仍无**（无会话夹具 + 长连接不可稳测） |

⇒ **UX-08 仍是 BLOCKED**，但缺的理由从"legacy 六屏全没测"缩小到**只剩一条**：
`/dashboard/chats/[roomId]` 的聊天输入区没有任何证据。
**证据升级不等于状态升级** —— 现在把 BLOCKED 改成 PASS，等于用"做了一批"冒充"做完了"。

两条本轮学到的事实：

1. **768 是比 390 更容易暴露缺陷的视口**：侧栏在 768 出现，手机上被隐藏的元素在那里全部显示。
   如果以后只能挑两个视口，应当选 **390 + 768**，而不是 390 + 360。
2. **1440 同样抓到了只有它才能抓到的东西**（页脚）。四视口不是"多测两遍"，是四种不同的渲染形态。
3. **"页面全绿 + 探针全红"要先怀疑尺子**：27 条里 24 条几何量与 3 条交互探针用的是两套选择器
   （Playwright Locator vs `document.querySelector`），出错的永远是后者。详见 §3.5。

---

## 5. 复现

```bash
# CI 里自动跑；本地需要先造夹具
node scripts/qa/seed-authed-e2e-user.mjs --db=ci-e2e.db
npx playwright test --config=playwright.ci.config.ts tests/e2e-ci/legacy-mobile.spec.ts
```
