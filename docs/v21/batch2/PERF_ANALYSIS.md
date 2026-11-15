# V21 第二批 · P0-07 性能 Trace 逐页判定（G15）

**结论：`MEASURED_MISS` — 9 页 / 9 页 MISS，0 页 ALL_MEET。G15 不通过，不放水。**

原始数据：`docs/v21/batch2/perf-trace.json`（51 KB，含 9 页 × 3 轮原始采样与 Chrome Trace 长任务明细）。
复现命令：`env -u NODE_OPTIONS PW_CHANNEL=chrome node scripts/qa/v21-batch2-perf.mjs --base=http://127.0.0.1:3214 --runs=3` → `PERF_EXIT=0`，耗时 4m36s。
脚本退出码 0 只代表**采集成功**，不代表性能达标；`verdict=MEASURED` 与逐页 `MISS` 是独立字段。

## 1. 测量口径（与历史 GA 同档，保证可比）

| 项 | 值 |
|---|---|
| Profile | `mobile-4g-4xcpu (lab)`，390×844 / DPR 3 / 150ms RTT / ~1.6Mbps / CPU ×4 节流 |
| 轮次 | 每页 3 轮，取中位数；9 页全部 `MEASURED`，0 `BLOCKED`、0 `NO_DATA` |
| 门槛 | TBT ≤ 200ms、LCP ≤ 2500ms、CLS ≤ 0.1（沿用旧 GA `vitals-b4.json` 的 `budget.good`） |
| Trace | `toplevel,devtools.timeline,v8.execute,blink.user_timing` |
| 双 TBT 口径 | `tbtMs` = PerformanceObserver longtask（**用于门槛判定**）；`traceTbtMs` = Chrome Trace `RunTask`（交叉参考，口径不同，两者都如实列出） |
| INP | `inpProxyMs` 是 lab 单次交互代理值（event timing 最大处理时长），**非字段 p75，不进达标判定** |

**声明**：本地 `next start` + 隔离库 + lab 节流的测量值，**不是生产 RUM 字段数据**；本文件不构成 GA 发布批准。

## 2. 逐页结果（3 轮中位数）

| 页 | TBT ≤200 | TraceTBT | LCP ≤2500 | CLS ≤0.1 | 长任务 | INP 代理 | 判定 |
|---|---|---|---|---|---|---|---|
| Now 初始 | **1318 MISS** | 2778 | **3000 MISS** | 0.020 MEET | 8 | 168 | **MISS** |
| Now 结果 | **2712 MISS** | 4607 | **3248 MISS** | **0.685 MISS** | 14 | 448 | **MISS** |
| Missions 列表 | **579 MISS** | 2006 | 2436 MEET | 0.020 MEET | 5 | 216 | **MISS** |
| Missions 详情 | **611 MISS** | 1573 | 1692 MEET | 0.020 MEET | 6 | 72 | **MISS** |
| Studio（工作区） | **522 MISS** | 1279 | **3128 MISS** | 0.010 MEET | 5 | 72 | **MISS** |
| Field（关系网络） | **559 MISS** | 1336 | 1684 MEET | 0.020 MEET | 6 | 64 | **MISS** |
| Consent（授权） | **672 MISS** | 1489 | **3132 MISS** | 0.028 MEET | 6 | 72 | **MISS** |
| Agents（执行团队） | **620 MISS** | 1447 | **3244 MISS** | **0.365 MISS** | 5 | 80 | **MISS** |
| Outcomes（成果）·附加 | **528 MISS** | 1307 | **3176 MISS** | **0.579 MISS** | 3 | 72 | **MISS** |

汇总：**TBT 9/9 MISS**、LCP 6/9 MISS（3 MEET）、CLS 3/9 MISS（6 MEET）。TBT 最好 522ms 仍是门槛的 2.6 倍。

## 3. 有证据的观察（不臆断归因）

1. **TBT 是延续性历史债，不是本批才出现**：同档 `mobile-4g-4xcpu` 历史报告 `docs/release/lokfeel-final-20261110/evidence/vitals-b4.json`（8 页）TBT 478–1972ms、`vitals-p0-2026-11-12.json` 1022–2338ms、`vitals-p0-clean-2026-11-12.json` 1173–2732ms；历史 `budget.tbt.good=200` 与本批门槛一致。本批 522–2712ms 与之同量级。
   - **但页面集合不同**：历史多为公开首屏，本批是登录态 `/workspace` 七屏 ⇒ 只能说「同量级、债未清」，**不能据此判定本批引入或改善了回归**。
2. **Now 结果页是最差页**：TBT 2712ms、14 个长任务、Trace 中单个 `RunTask` 984ms（blocking 934ms）、CLS 0.685（`clsShifts=1`、`lcpEl=P`）、`interactions=6`、`inpProxyMs=416`。这是**交互后出结果**的状态，TBT 包含交互触发的工作；不能与 Now 初始态直接相减当作「结果渲染成本」，但足以证明该路径存在重主线程工作。
3. **CLS >0.1 的三页有真实位移采样，不是估算**：Now 结果 `clsShifts=1`、Agents `clsShifts=5`、Outcomes `clsShifts=3`，`lcpEl` 均为 `P`。历史公开页 8 页 `cls=0 / clsShifts=0`，但同样因页面集合不同**不构成回归判定**；本批是首次在这组应用内页面上观测到，**待独立归因**（脚本未记录 layout-shift sources，故不指认具体组件）。
4. **没有采到的数据不补 0**：无 Trace 采集失败的页；所有 9 页 `usableRuns=3`。

## 4. 不放水声明

为让结果达标而可做的「降 CPU 节流 / 去掉网络节流 / 改 thresholds / 跳过最差页 / 只报 MEET 项」，**一项都没有做**。`perf-trace.json` 的 `thresholds` 保持 `{tbtMs:200, lcpMs:2500, cls:0.1}`，9 页原始 samples 与长任务明细全部保留可复核。

G15 因此从「PARTIAL（待回填）」改判为 **`MEASURED_MISS`（本地 lab 不达标）**。历史 TBT 债维持 P1，**不作为放行项**，也不能用「本地 lab ≠ 生产」来把它写成 PASS；生产达标需要部署后的 RUM / 生产档 Trace 另测。

## 5. 下一步（需新批次 / Owner 决策，本批未擅自实施）

- 定位并拆分 Now 结果页 984ms 长任务；结果卡片改为固定占位 + 骨架，避免异步插入造成 CLS。
- 七屏按路由懒加载 / 水合边界下沉，减少首屏 longtask。
- 对 Agents / Outcomes 的 5 次、3 次 layout shift 记录 `layout-shift` sources 后再定位元素。
- 部署候选后在生产档重跑本脚本，并与 RUM 对照；在此之前 G15 保持 MISS。
