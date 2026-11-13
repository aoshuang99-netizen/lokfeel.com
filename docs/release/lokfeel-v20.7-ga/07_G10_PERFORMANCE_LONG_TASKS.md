# 07 · G10 性能 / TBT（T7）

| 项 | 值 |
|---|---|
| 状态 | **`PARTIAL` / FAIL** —— 8/8 页面 TBT ≤200ms **0/8 达标** |
| 沿用实测 | `evidence/vitals-b4.json`、`vitals-b4-inp.json`、`vitals-p0-2026-11-12.json`、`vitals-p0-clean-2026-11-12.json` |
| 本轮是否改善 | **没有** —— 本轮未做 bundle 拆分，不写"已优化" |

## 为什么本轮没动

T7 的验收要求"同一环境、同一 Chunk/CPU/网络、8 页 × 5 轮、保存 Before/After"，且**不允许**改阈值、排除最慢页、跳过路由采样。这需要一轮完整的浏览器采集（约 40 次页面加载）与改动后的**全量回归**（G4 矩阵 + agent 链路）。

本轮把可支配时间放在了**两个真实红灯**上：`/pricing` 金额（CI 失败）与五个页面的未批准声明（治理事故）。如果同时开 TBT 改造，两个都会半成品——而半成品的性能改动最容易"看起来降了、其实只是采样变了"。

## 下一轮的执行顺序（不改阈值）

1. 用 `npm run verify:perf:vitals`（`scripts/perf/measure-vitals.mjs`）先取 **8 页 × 5 轮**基线，落原始样本；
2. Chrome Trace → Long Task 归因（哪段主线程同步执行 >50ms）；
3. 拆入口/图表/第三方分析：`dynamic import` + 延迟非必要水合（OrbitGraph 首屏不必水合）；
4. 每改一处保存 Before/After，跑 G4 受影响链路回归；
5. 8/8 ≤200ms 才算 PASS；不达标就保持 `FAIL`，不放宽。

## 已知的超标量级（沿用最近一次实测，供判断工作量）

历史四轮实测 TBT 区间 **487–1063ms**，距 200ms 阈值约 2.4–5.3 倍。这不是"再懒加载一个组件"能解决的，属于入口同步 JS 体量与 hydration 结构问题。
