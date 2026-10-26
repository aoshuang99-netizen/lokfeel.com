# V19-20 · `/login` 性能专项（WB19-45）

> **状态：`PERF_TARGET_NOT_MET`（2026-10-26 复核维持）。** 目标 LCP ≤2500ms；2026-10-23 重测冷态中位 **6544ms**（4608–9796）、暖态 **5472ms**。优化 #1（LazyMotion 下放）已实施并经 deploy preview 实证载荷收益（§7.4：JS −37KB/−2req），但冷态 LCP 未达标，不做修饰。
> 数据：`screenshots/v194-perf/perf-2026-10-23.json`（5 冷 + 5 暖 × 4 路由原始样本）；2026-10-26 同会话前后对照 `perf-samesession-2026-10-26-{prod,preview}.json`。

## 1. 测量条件（可复算）

390×844 / DPR2 · CDP 节流 1.6Mbps ↓ / 750kbps ↑ / 150ms RTT · CPU 4× · 冷 = 全新 context，暖 = 同 context 二次导航 · 每路由 5+5 样本。与 WB18-36 完全同一脚本（`scripts/qa/perf-baseline.mjs`）。

## 2. 本轮结果（中位数）

| 路由 | 冷 LCP | 暖 LCP | 冷 TBT | JS 传输 | 第三方 |
|---|---|---|---|---|---|
| `/` | 8028ms | — | 8945ms | 272KB/14req | — |
| `/login` | **6544ms** | **5472ms** | **3450ms** | **244KB/13req** | **cloudflareinsights 1029–2072ms** |
| `/pricing` | 3540ms | — | 1190ms | 11KB/2req | — |
| `/pay.html` | 4592ms | — | 1496ms | 11KB/2req | — |

## 3. 与上一轮基线（WB18-36，`36_PERFORMANCE_BASELINE.md`）的对照

| 路由 | 上轮 | 本轮 | 差异 |
|---|---|---|---|
| `/` 冷 LCP | 3784ms | 8028ms | **+112%** |
| `/login` 暖 LCP | 3172ms | 5472ms | **+73%** |
| `/pricing` 冷 LCP | 3044ms | 3540ms | +16% |

🔴 **同代码（生产 `dc102cd` 未变）、同脚本、同标称条件，数字却大幅变差** —— 两种可能：① 本机会话状态差异（上轮测试前后台负载不同）；② 生产侧注入内容变化（如 Cloudflare Insights beacon 行为）。**这正是"不能根据单次测量下结论"的实证**：绝对值不可跨会话直接比，但**结构性结论两轮一致**（见 §4）。后续测量应在同一会话内完成"优化前/后"对照（PERF-03 要求的正是这个，不是跨会话对比）。

## 4. 结构性结论（两轮一致，可行动）

1. **瓶颈在主线程，不在网络**：FCP≈LCP（`/login` 5792 vs 6544），首字节只占 LCP **9%**（上轮 8–20% 同量级）。
2. **JS 体积与 TBT 强相关**：`/login` 244KB/13req → TBT 3450ms；`/pricing` 11KB/2req → TBT 1190ms 且 LCP 3540（同为节流条件）。`/login` 的 JS 是 `/pricing` 的 **22 倍** —— 登录页装了与登录无关的东西。
3. **第三方实锤**：`static.cloudflareinsights.com` 单个 beacon 占 **1.0–2.1s** —— 生产（Cloudflare DNS）自动注入的 Web Analytics。这是零成本优化点（对自托管分析或 defer 策略复核）。

## 5. 优化路线（按预期收益排序，未实施 —— 等排期）

1. **审 `/login` 的客户端 JS 清单**：239KB（上轮）→ 现测 244KB，13 个请求。逐项归因（auth 组件、共享 bundle、图标库），目标砍到 `/pricing` 量级；
2. **复核 Cloudflare Insights 注入**：1–2s 的主线程/网络占用，评估关闭或改自托管；
3. 字体与关键 CSS 复核（`/` 同病：272KB JS、TBT 8945ms）。

## 6. 验收判定

- PERF-01（条件可复现）：✅ 脚本与参数写死可复算
- PERF-02（冷暖分离）：✅
- PERF-03（优化前后数据）：⬜ **未实施优化** —— 本轮仅测量与归因
- PERF-04（无安全/功能回退）：⬜ 同上
- **目标 LCP ≤2500ms：NOT MET（6544ms 冷 / 5472ms 暖）**

---

## 7. 【2026-10-25 实施】优化 #1：LazyMotion 下放（framer-motion 迁出根布局）

### 7.1 归因（代码级，扫描脚本 `scripts/qa/scan-framer-usage.mjs`）

- 全仓 **30 个文件** import framer-motion；其中依赖根布局 `LazyMotion` 的只有 **`m.`** 用法：
  `chats`（chat-container / message-bubble / message-list / conversation-item）与
  `explore/page-content` —— **全部位于 `(dashboard)`**。
- `UserAvatarMenu`（用 `m.`）经全仓引用扫描确认为**零挂载死代码**。
- `console/*` 与 `workspace/*` 组件全部用 `motion.`（全量导入，自带特性），不依赖 LazyMotion。
- 结论：根布局的 `<LazyMotion features={domAnimation}>` 迫使 `/login`、`/register`、
  `/pricing`、`/` 等零动画页面也加载 framer-motion 运行时 —— 纯浪费。

### 7.2 代码改动（2 文件）

| 文件 | 改动 |
|---|---|
| `src/app/layout.tsx` | 删除 `LazyMotion` import 与 JSX 包裹（根布局 0 framer 残留，机械核对） |
| `src/app/(dashboard)/dashboard-ui.tsx` | `<LazyMotion features={domAnimation}>` 挂到 `(dashboard)` 客户端壳，包裹 `ProfileContext` 全树。**不加 `strict`**：dashboard 内还有多个 `motion.` 全量组件，strict 会抛错 |

### 7.3 风险评估

- `m.` 组件失去 provider 会抛 `lazy functionality` 错 —— 已核实全部存活 `m.` 挂载点都在
  `(dashboard)` 内（`conversation-list` 挂在 `chats/layout.tsx` ✓）。判定为**零行为变化**。
- E2E 门禁（认证 18 条 + 页签 12 条 + chats 相关）将在 PR CI 里复跑，作为行为不变的证据。

### 7.4 前后对照（PERF-03）【2026-10-26 已完成】

测量环境：PR #32 的 **Netlify deploy preview**（`deploy-preview-32--lokfeel.netlify.app`，
构建自 `44e49c5` = 分支 HEAD；`skip_prs` 原为 `true`，本轮经 API 改 `false` 后触发）。
**同会话先测生产、再测 preview**，各 5 冷样本（§1 同脚本同条件）。
原始数据：`screenshots/v194-perf/perf-samesession-2026-10-26-{prod,preview}.json`。

**跨环境 LCP 不可判的实证（先说清，再给结论）**：preview 走 `*.netlify.app` 裸域，
本会话实测 **GFW 连接重置**（Chromium `net::ERR_CONNECTION_RESET`，脚本已带 3 次重试）、
TTFB 全线 +65%（`/login` 566→935ms）、冷样本方差 ±2×（3040–7984ms）。
生产走 Cloudflare 边缘（国内可达）。**因此 LCP/TTFB 的跨环境差值不具判定力**，
可比的是**载荷（JS 字节/请求数）与 TBT（主线程指标，网络无关）**。

| `/login` 冷态中位 | 生产 `dc102cd` | preview `44e49c5` | 差值 | 判读 |
|---|---|---|---|---|
| JS 传输 | **244KB / 13req** | **201KB / 11req** | **−37KB / −2req** | ✅ framer-motion 运行时已从 `/login` 移除 |
| TBT | 3313ms | 3382ms | +2% | ➖ 噪声内：framer-motion 不是 `/login` TBT 主因 |
| 冷 LCP | 3524ms | 5656ms | — | ⚠️ 网络混杂不可判（见上） |
| 暖 LCP | 1732ms | 2436ms | — | ⚠️ 同上；两会话均 <2500 但方差大 |
| 第三方 | cloudflareinsights 1239ms | app.netlify.com 723ms（preview 徽章注入，生产无） | — | 各自环境特有 |

**两条结构性结论**：
1. 优化 #1（LazyMotion 下放）**载荷级收益实证**：−37KB JS、−2 请求，且 E2E 全绿（零行为回退）；
2. 但它**不是 LCP/TBT 的主要矛盾**——`/login` 剩余 201KB、cloudflareinsights beacon（1–2s）、
   字体/关键 CSS 才是下一批目标（§7.5 的两项面板操作仍是零代码最大杠杆）。

**本轮新发现（非 V19 分支引入）**：`/pricing` 冷态 JS **11KB/2req（生产 dc102cd）→ 192KB/9req（preview）**。
经 `git diff` 隔离核实：**V19 分支只改了 3 个 src 文件**（`layout.tsx`、`dashboard-ui.tsx`、
`living-workspace.tsx`），pricing 未动；该 192KB 来自 main 自带的 pricing 页新增
（`dc102cd..c3213fd` 之间 +166 行）。已列为后续审计项，不计入本分支验收。

**测量过程注释**：preview 构建需先在 Netlify 侧开启 Deploy Previews（原设置 `skip_prs: true`
导致 PR #32 从未生成过 preview）；已通过 API 将其改为 `false`（`allowed_branches` 仍仅 `main`，
不影响生产行为），空提交 `44e49c5` 触发构建，约 2.5 分钟就绪。

### 7.5 第三方注入的处置（代码之外，需人工/面板操作）

| 注入源 | 实测影响 | 处置 | 谁能做 |
|---|---|---|---|
| `static.cloudflareinsights.com` | beacon 占 **1.0–2.1s** | Cloudflare 控制台关闭 Web Analytics 的 Auto-Inject（或换自托管） | **你**（DNS/CF 面板） |
| GTM（`NEXT_PUBLIC_GTM_ID` 已在生产生效） | `googletagmanager.com/gtm.js` 进首屏 | 若分析非必需，清掉 Netlify 变量即全站少一个阻塞脚本 | **你**（Netlify env） |
| Netlify "Powered by" 徽章 | 品牌一致性 P2，404 页可见 | Netlify 账户设置可关（免费档允许） | **你**（Netlify 面板） |

### 7.6 本轮判定更新（2026-10-26）

- PERF-03：**部分达成 → 结构性收益已实证**（§7.4：`/login` JS −37KB/−2req、TBT 持平、E2E 全绿），
  LCP 级前后对照因 preview 域名受 GFW 干扰不具判定力（已在 §7.4 实证并说明口径）。
- PERF-04：✅ CI 19 success / 1 skipped（手动档）/ 0 失败（HEAD `44e49c5`），preview 走查 `/login`、
  `/api/health` 均 200。
- **总体仍标 `PERF_TARGET_NOT_MET`**：冷态 LCP 未达 ≤2500ms。剩余主因 = cloudflareinsights 注入
  （§7.5，面板操作）+ `/login` 其余 201KB 客户端 JS（下一轮审计目标）+ `/pricing` 192KB（main 自带，另立项）。

---

## 8. 【2026-10-26】JS 载荷逐 chunk 归因（§7.4 遗留项闭案）

方法：抓取 preview `/login` HTML 引用的全部 11 个 chunk（含 preload），逐个测
原始字节 + br 线上字节（Netlify 对静态资源按浏览器 `Accept-Encoding` 回 br；
单独 `Accept-Encoding: gzip` 会拿到 identity —— 测量时必须带浏览器同款头），
再按特征串归因库。脚本化可复跑（临时脚本，方法论已记录于此节）。

### 8.1 `/login` JS 构成（preview `44e49c5`，br 线上字节）

| chunk | br | raw | 归因（特征串证据） |
|---|---|---|---|
| `0-xp6wqbpfi8p` | **123.3KB** | 396KB | react-dom + turbopack 模块运行时 + next-auth/client |
| `15x7omkljizoe` | **42.2KB** | 159KB | Next App Router 运行时（RSC / segment cache / router actions） |
| `0cz1d0mv5g_q7` | **38.5KB** | 113KB | **core-js 3.38.1 polyfills**（`github.com/zloirock/core-js` LICENSE 实锤） |
| `0st90f40nk269` | 8.2KB | 31KB | react-dom 客户端钩子（useFormState 等） |
| `22fufvf59dnfn` | 5.5KB | 16KB | lucide 图标 + twitter |
| `1-id7ni8nentj` | 4.6KB | 12KB | **业务代码**（含 `LokFeel` 字样） |
| `turbopack-*` | 4.4KB | 12KB | turbopack runtime |
| `33ds62_*` / `1o-pn8*` / `3rdmja*` | 10.6KB | 36KB | 小块未识别（合计 <11KB br） |
| `2kcpt4ody1qu9` | 2.5KB | 6KB | next-auth client |

**结构结论：框架基线（react-dom + router + polyfills + turbopack runtime）≈ 216KB br，
占 `/login` JS 的 ~88%；业务代码 ≈ 30KB。代码级可裁空间已榨干**——剩余三大块都是
Next 16 (Turbopack) 的固定成本：polyfills 无 browserslist 开关（App Router 固定打包，
仓库也未配置 browserslist）、react-dom 不可省、router 是 App Router 必载。

### 8.2 `/pricing` 192KB 闭案：无页面级浪费

`/pricing` 的 chunk 集合与 `/login` **几乎相同**（同一套共享框架基线），
页面专属增量仅 `0mi2qmrho5xf5`（lucide 图标，10.5KB raw / ~3KB br）。
§7.6 所列「`/pricing` 192KB 另立项审计」**就此闭案**：那 192KB 就是全站共享的
框架基线，不是 pricing 页自带膨胀；此前 §2 生产口径的「11KB/2req」是旧版
pricing 页（`dc102cd..c3213fd` 之间 main 重写了该页）。

### 8.3 剩余优化杠杆（重排，全部非代码或需立项）

| 杠杆 | 预期收益 | 归属 |
|---|---|---|
| GTM（HTML 内联 + `gtm.js` 每页加载） | −35KB 级 JS + 主线程 | **你**（Netlify env，§7.5） |
| cloudflareinsights beacon | −1.0–2.1s 主线程/网络 | **你**（CF 面板，§7.5） |
| 框架基线 216KB br | 理论仅 Preact 替换（大改，不建议） | 不动 |
| 业务代码 30KB | 已无显著浪费 | 闭案 |

**工程侧结论：`/login` 代码级优化在优化 #1（LazyMotion 下放）之后已无下一刀；
性能达标与否取决于 §7.5 两项面板操作的落地（预期砍掉 1–2s 主线程 + 35KB JS）。**
