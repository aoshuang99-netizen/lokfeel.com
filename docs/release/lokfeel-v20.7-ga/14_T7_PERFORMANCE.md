# T7 · 性能（G10）：归因、修复、以及一个必须先说的测量问题

> 执行：2026-11-13 · 全部数字来自本仓脚本落盘的 JSON（`docs/release/lokfeel-v20.7-ga/evidence/t7-*.json`）
> 阈值：**TBT ≤ 200ms（移动端实验室，4× CPU + 4G）** —— 未修改、未放宽。

## 1. 方法（先固定，再测）

| 项 | 值 |
|---|---|
| 脚本 | `scripts/perf/measure-vitals.mjs`（5 轮取中位数，首轮单独记为冷启动） |
| 归因 | `scripts/perf/attribute-tbt.mjs`（Trace 的 `RunTask` × 子事件，与 Lighthouse 同口径） |
| 视口 | 390×844，DPR 3，`isMobile` |
| 网络 | 1.6 Mbps / 750 kbps / RTT 150ms |
| CPU | 4× 降速 |
| 目标 | 8 页：`/` `/login` `/product` `/solutions` `/stories` `/how-it-works` `/help` `/pricing` |

## 2. 归因（改之前，实测）

`attribute-tbt.mjs` 对 `/` 与 `/product` 的长任务做时间窗归因：

| 页面 | 长任务 | 最大三项 |
|---|---|---|
| `/` | 32 | `Layout 1028ms` · `O@2xt73…js 684ms` · `UpdateLayoutTree 591ms` |
| `/product` | 22 | `RunMicrotasks 1636ms` · `EvaluateScript@2xt73…js 1484ms` · `Layout 1237ms` |

`2xt73imog50f2.js` = **396 KB**，同时含 react-dom 与 Sentry 浏览器 SDK（`browserTracingIntegration` / `captureException`）。
这条线索指向一个具体事实：**Sentry 被静态 import 进了每个页面的首屏，而本仓没有配 DSN** —— 下载、解析、执行，然后什么也不做。

## 3. 改了什么（都是"去掉不可能生效的工作"，不是砍功能）

| 文件 | 改动 | 依据 |
|---|---|---|
| `instrumentation-client.ts` | 去掉 Sentry 的**静态** import，改为"有 `NEXT_PUBLIC_SENTRY_DSN` 才动态导入" | 无 DSN 时 `init` 不上报；这是死代码 |
| `next.config.ts` | `withSentryConfig` 按 DSN 条件挂载 | 同上 |
| `src/app/layout.tsx` | 移除根布局的 `SessionProvider` | `useSession` 全仓只出现在 dashboard/workspace 组件 |
| `workspace` / `console` / `(dashboard)` / `dashboard` 布局 | 各自挂 provider（`dashboard/layout.tsx` 为新增） | 保证每个 `useSession` 使用点都有 provider |
| `src/components/layout/footer.tsx`、`(landing)/page.tsx` | 页脚/头部链接 `min-h-6`（≥24px） | WCAG 2.2 SC 2.5.8（T2） |
| `(landing)/page.tsx` | 轨道标签淡出下限 0.35 → 0.7 | axe 实测对比度 3.0–4.06 → 达标（T2） |
| `measure-vitals.mjs` | 修一个真 bug：全部轮次失败时 `cls.toFixed()` 抛 TypeError，把整份报告搞崩 | 采集失败 ≠ 没有数据 |

**确定性结果（可复算，不受机器影响）**

| 页面 | 首屏 JS（gzip 估算） | 改动前 | 差 |
|---|---|---|---|
| `/product` 等 5 个冻结页 | **135 KB** | 196 KB | −31% |
| `/` | **206 KB** | 268 KB | −23% |
| `/pricing` | **149 KB** | 210 KB | −29% |
| `/product` 首屏脚本原始字节 | **590 KB** | 806 KB | −216 KB |

> 这一行是 T7 唯一"可跨机比较"的结论：**少下载 216 KB**。TBT 的绝对数不是。

## 4. 必须先说的问题：这台机器量不出 200ms

### 4.1 同一份构建，10 轮重复测量

`/product`（近乎静态页）：`[215, 340, 585, 319, 633, 289, 232, 253, 231, 189]` → 中位 271，极差 **189–633**
`/help`：`[226, 288, 214, 303, 274, 255, 302, 204, 258, 224]` → 中位 257，极差 204–303

### 4.2 同一份构建，跨时间漂移

| 时刻 | `/product` 中位 TBT |
|---|---|
| 07:5x（构建 3119） | **271 ms** |
| 08:2x（同一构建 3119） | **920 ms** |
| 08:2x（下一构建 3121，仅多了页脚 24px） | 567 ms |

同一构建、同一脚本、同一视口，**1 小时内自己跟自己差 3.4 倍**。主机是 `Intel Core m3-7Y32 @ 1.10GHz`（2017 年低功耗双核），叠 4× 降速后长时间跑 Chromium 会持续热降频。

### 4.3 两个"地板"对照

| 对照 | TBT 中位 | 说明 |
|---|---|---|
| 零 JS 静态页（`/tmp/blank`，python http.server） | **12 ms** | 仪器本身没问题 |
| `/holding`（服务端页，无任何客户端组件，132KB 框架 JS） | **212 ms** | **框架地板已经越过 200ms** |

结论：在这台机器上，**任何 Next.js 页面都过不了 200ms**，哪怕它一个客户端组件都没有。继续在本机"优化到绿"只有两种结局——要么改阈值（不允许），要么把噪声当成功。

### 4.4 因此 T7 的判定

- **代码层**：`DONE`（Sentry 死代码已移除，JS −31%，归因闭环）
- **TBT ≤200ms × 8 页**：`NOT_CERTIFIABLE_ON_THIS_HOST` —— 不是"没做"，是**这个仪器在这台机器上没有分辨率**
- **阈值**：保持 200ms，不放宽

## 5. 要让 T7 变成可判定，只有三条路（都需要你选）

| 方案 | 做法 | 代价 |
|---|---|---|
| **A. 在 CI 量**（推荐） | 在 `e2e` job 起好服务后跑同一脚本，产物作为 artifact；阈值判定在 CI 的稳定 runner 上做 | 每个 PR 多 ~8 分钟；需要一次提交把步骤加进 `ci.yml` |
| B. 换测量机 | 用桌面级 CPU（非 1.1GHz 双核）跑同一脚本 | 需要设备 |
| C. 接受"相对改善"口径 | 只报 JS 字节与长任务数，不报绝对 TBT | 与现行合同（200ms）不一致，需你改合同 |

我没有擅自改 `ci.yml`：新增一个会红的 job 而我无法在远端迭代修复，等于制造新的红灯。

## 6. 归因（改之后，留档）

`t7-attribution-round1.json`：`/product` 的长任务降到 **4 个**（改前 22 个），剩余主要项为 `Layout 420ms` / `EvaluateScript 276ms` / `RunMicrotasks 275ms` —— 即框架水合本身。这从另一侧印证了 4.3 的地板结论。
