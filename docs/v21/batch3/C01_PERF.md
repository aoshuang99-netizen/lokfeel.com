# V21 第三批 · C01 性能整改（G15）

**裁决：仍为 FAIL。** 本轮不再停留在「9/9 MISS」这个结论，而是把主线程时间**归因到函数与脚本**，修掉两处真实浪费，并把剩余瓶颈量化到「227 KB gzip JS 的解析/编译」。未达 TBT ≤200ms，不假绿。

正式取证（§3.2，干净负载、9 页 ×3 轮）：**9/9 MISS**，TBT **1743–3828 ms**（门槛 200）、LCP **3448–10176 ms**（门槛 2500）、CLS 最高 **0.685**（门槛 0.1）。

原始数据：`docs/v21/batch2/perf-trace.json`（同一档位、同一 9 页、每页 3 轮；新增 `cpuProfile` 与 `clsSources` 字段）。
采集命令与退出码见文末。

## 1. 归因方法（本轮新增，之前没有）

之前的 Trace 只有 `RunTask` 时长，能说「这一秒有个 984ms 长任务」，说不出「哪段代码」。本轮在 `scripts/qa/v21-batch2-perf.mjs` 增加：

- `TRACE_CATEGORIES` 加 `disabled-by-default-v8.cpu_profiler`；
- 解析 `Profile` / `ProfileChunk`：`samples` 在 `args.data.cpuProfile`、`timeDeltas` 在 `args.data` 层（易错点，已注释）；
- 按 `nodeId` 聚合**自耗时** → 映射 `callFrame.functionName` + 脚本 URL，输出 top 15；
- `layout-shift` 记录 `sources`（节点名 + class + 前后矩形），CLS 不再只有一个数字；
- 记录首屏 `jsKB / transferKB / resourceCount`（PerformanceResourceTiming，gzip 后）。

口径声明：`cpuProfile` 是**采样自耗时**，不含子调用，总和不等于 TBT；它只回答「时间花在哪些函数上」，不参与门槛判定。

## 2. 归因结论（有原始证据）

| # | 发现 | 证据 | 处置 |
|---|---|---|---|
| A1 | **Service Worker 在首屏主线程执行** `/sw.js` 自耗时 **1002ms**，另有 `skipWaiting` **272ms** | `perf-trace.json` → `pages[0].samples[*].trace.cpuProfile.topFunctions` 在整改前含 `/sw.js` 与 `skipWaiting` | `src/app/layout.tsx`：注册从 `load` 立即改为 `requestIdleCallback(timeout 5000)`；修复后 top functions **不再出现 `/sw.js`** |
| A2 | **首屏 10+ 并发请求**：proposals / outcomes 各被两个 hook 重复请求；jobs / outcomes / intents / disclosure / agent runs 与首屏无关却常开 | 静态盘点 `useApiGet` 调用点 + `useConsentGateData`/`useOutcomeObservatoryData` 的 `enabled` | ① `src/hooks/use-api.ts` 增加**同 URL 并发合并**（in-flight map）；② `living-workspace.tsx` 把 jobs/outcomes/consent/observatory/agents 改为「切到对应屏 **或** 首屏空闲后」才启用，首屏请求降为 4 个（通知/未读/能力/提案） |
| A3 | **七屏组件全部静态 import**：`MissionBoard` 连带 979 行 `ExecutionPanel`、455 行 `SpecEditor`、`MissionSpecSection`；`LivingCanvas`、`FieldCanvas` 首屏用不到也要下载/解析 | 模块依赖盘点 | 曾用 `next/dynamic(ssr:false)` 切分三者，**实测后回滚**：G15 的测量是直接打开 `?view=missions` 等 URL，该屏 LCP 元素就在 lazy chunk 里 ⇒ 9 页 LCP/TBT 全面变差。结论已写进 `living-workspace.tsx` 注释，避免后人再犯 |
| A4 | **CLS 无法归因**（只有 0.685 这个数） | 旧 collector 只累加 `value` | 记录 `layout-shift.sources`（tag/class/前后矩形），供后续定位具体组件；本轮**未**据此改布局（避免臆断） |

## 3. 修复后的客观量（单页 `now-initial`，2 轮）

| 指标 | 值 |
|---|---|
| 首屏 JS（gzip） | **227 KB** |
| 首屏总传输 | 347–356 KB / 19–27 个资源 |
| `(program)` 占主线程自耗时 | **50.6%–63.6%** |
| 长任务 TBT | 1494 / 1815 / 1988 / 2208 ms（4 次单/双轮测量，波动大） |
| LCP | 3332–4792 ms |
| CLS | 0.010–0.012 |

**诚实解读**：SW 归因的消失是**确定性改进**（同一函数不再出现在 top list）；但 TBT 数值没有被证明显著下降 —— 单轮波动区间（1494–2208ms）与整改前（1318–2712ms）重叠，样本量不足以做统计结论。任何「性能已改善 X%」的说法都不成立。正式全量样本见 §3.2。

### 3.1 一次**不可比**的全量复测（必须标注）

在 dynamic 版本上跑过一次 9 页 ×3 轮：**9/9 MISS，TBT 1457–4751ms、LCP 2988–8844ms**，比第二批全面变差。
但那次采集与两个子代理的 Jest 全量、构建任务并行，主机 CPU 被抢占（采集耗时从 4m36s 拉长到 7m26s），**不构成可比样本**，因此不据此下任何「变差/改善」结论。
它唯一有效的结论是定性的：`?view=xxx` 直接进入时，lazy chunk 会推迟该屏 LCP 元素出现 ⇒ dynamic 在该测量口径下是负优化，故回滚。

### 3.2 正式取证：回滚后 · 干净负载 · 全量 9 页 ×3 轮

`dynamic` 回滚后重建（`BUILD_EXIT=0`），清空 3214 端口旧进程，**无其他构建/Jest 并行**下串行采集（耗时 7m55s，`PERF_EXIT=0`）：

| 页面 | 判定 | TBT | LCP | CLS |
|---|---|---|---|---|
| Now 初始 | MISS | 3483 ms | 5176 ms | 0.000 |
| Now 结果 | MISS | 3603 ms | 4808 ms | **0.685** |
| Missions 列表 | MISS | 2464 ms | 3448 ms | 0.020 |
| Missions 详情 | MISS | 1743 ms | 3776 ms | 0.020 |
| Studio | MISS | 2486 ms | 7404 ms | 0.010 |
| Field | MISS | 3828 ms | 3612 ms | 0.022 |
| Consent | MISS | 3525 ms | 9536 ms | 0.050 |
| Agents | MISS | 1810 ms | 6952 ms | 0.323 |
| Outcomes | MISS | 2731 ms | **10176 ms** | 0.597 |

结论 `MEASURED`：**9 已测 / 0 BLOCKED / 9 MISS / 0 ALL_MEET / 0 NO_DATA**。

- 门槛 `{tbtMs:200, lcpMs:2500, cls:0.1}`，最接近的一页（Missions 详情 TBT 1743ms）仍超门槛 **8.7 倍**。
- `PERF_EXIT=0` 只代表采集脚本正常退出；**G15 判定始终按逐页 MEET/MISS，不看退出码**。
- LCP 最差 Outcomes 10176ms、Consent 9536ms，说明这两屏首屏内容依赖客户端取数后才渲染 —— 与 §4 的架构结论一致（首屏未 RSC 化）。
- CLS 三处显著（Now 结果 0.685、Outcomes 0.597、Agents 0.323），`clsSources` 已落盘，可在下一批逐项定位，本轮**未**凭猜测改布局。

这是本批次**唯一**可作为正式证据的性能样本（§3.1 那次的负载不干净，不采用）。它同时说明：本轮 A1/A2 两处修复虽然消除的是**确定的浪费**，但在 227KB gzip 的量级面前不足以改变门槛结论。

### 3.3 CLS 归因（用本轮新增的 `clsSources`，把「0.685」变成具体元素）

对 `?view=outcomes` 三次运行的 `layout-shift.sources` 逐条拆开（三次完全一致）：

```text
shift value=0.017 at= 8679ms  SECTION.space-y-2   dy=+76  dh= -6   y:383→459  h:102→96
shift value=0.580 at= 9614ms  DIV.space-y-5       dy=+24  dh=+265  y:231→255  h:324→589
                              SECTION.space-y-2   dy=-459 dh= -96  y:459→0    h:96→0
```

**读数**：0.58 的那一次位移里，`section.space-y-2` 从 `y=459, h=96` **整块消失**（→0/0），
同时页面根 `div.space-y-5` 的**高度从 324 涨到 589**。这不是「图片没写宽高」，是**首屏内容被整块替换**。

**与代码对照**（`src/app/workspace/living-workspace.tsx:323`）：

```ts
const [activeKey, setActiveKey] = useState('now')   // 初始恒为 now
```

`?view=` 只在**客户端**被解析（`src/lib/living/workspace-view.ts`，`pushState` 口径），
所以服务端 HTML 渲染的是 **Now 屏**；等客户端 hydration 完成、读到 `?view=outcomes` 才切屏。
本机 4× CPU 节流下 hydration 落在 **~9.6s**（与 227KB gzip JS 的解析成本一致），
切屏那一刻就是上面那条 0.58 的位移；而 Outcomes 的 LCP 元素此时才开始取数 ⇒ **LCP 10176ms**。

⇒ 结论（**推断，有原始证据，未做因果实验**）：`now → outcomes` 的 hydration 期整屏替换，
是 Outcomes/Agents/Now 结果三页 CLS 与 LCP 的**同一个根因**；
把它修成「服务端按 `?view=` 直接渲染目标屏」才能同时消掉两者 —— 这属于 §4 的 RSC 化，
不是加个 `min-height` 能解决的（本轮**不做**猜高度的布局补丁）。

## 4. 为什么仍未达标（技术事实，不是免责）

`(program)` 占 50–63%，是 V8 对 **227 KB gzip（约 700+ KB 解析后）** JS 的解析/编译/GC 成本；在 CPU ×4 节流下约 5 秒主线程时间。要让 TBT ≤200ms，首屏 JS 必须降到约 **30–50 KB gzip** 量级。

而 Next.js + React 19 的客户端运行时基线本身已接近 120–150 KB gzip。也就是说：

- **仅靠组件懒加载/请求收敛，不可能到 200ms**（本轮已把可摘的业务模块摘掉，仍剩 227KB）；
- 要达标只能是**架构级改造**：首屏 RSC 化（把 `/workspace` 首屏做成服务端组件 + 极小客户端岛）、移除或延迟整个 `LivingShell` 客户端树、拆掉 Turbopack 的共享 chunk 冗余，必要时换更轻的运行时；
- 或者由 Owner 明确调整 G15 口径（例如按「真实用户 RUM p75」而非 lab 4x 节流），但**那是改门槛，不是达标**，本文件不做这种改判。

## 5. 不放水声明

- 门槛未动：`thresholds = {tbtMs:200, lcpMs:2500, cls:0.1}`。
- 档位未动：`mobile-4g-4xcpu`，390×844，CPU ×4，150ms RTT，1.6Mbps。
- 页集合未动：仍 9 页（七屏 + Now 结果 + Missions 详情）。
- 未删页、未跳最差页、未用 `exit 0` 冒充达标；`PERF_EXIT=0` 只表示采集完成。
- 未把「本地 lab」当成「生产 RUM」，也未反过来用「不是生产」把 FAIL 写成 PASS。

## 6. 下一步（需 Owner 决策，本轮不擅自扩大改造）

1. **首屏 RSC 化**（最高杠杆）：`/workspace` 首屏改为服务端渲染输入框与首屏三计数，客户端只水合交互岛。预期可把首屏 JS 从 227KB 压到 80KB 以内，但属跨模块改造，需单独批次与回归窗口。
2. 若 RSC 化后仍不达标，评估移除 `LivingShell` 的客户端全量水合（改为逐屏 RSC + 局部岛）。
3. **把 `?view=` 变成服务端输入**（§3.3 已定位）：`/workspace` 的 `searchParams.view` 在服务端解析并渲染目标屏，客户端不再「先渲染 Now 再切屏」。这是同时压 CLS 与 LCP 的最小改动面，仍需 RSC 化配合。
4. 部署候选后在生产档复测并与 RUM 对照；在此之前 G15 保持 **FAIL**。

## 7. 复现命令

```bash
# 全量 9 页 × 3 轮（正式取证）
env -u NODE_OPTIONS PW_CHANNEL=chrome node scripts/qa/v21-batch2-perf.mjs \
  --base=http://127.0.0.1:3214 --runs=3
# 单页快速归因（整改期）
env -u NODE_OPTIONS PW_CHANNEL=chrome node scripts/qa/v21-batch2-perf.mjs \
  --base=http://127.0.0.1:3214 --runs=2 --only=now-initial
```

退出码 0 = 采集完成；逐页 MEET/MISS 与 `cpuProfile` 归因见 `perf-trace.json`。
