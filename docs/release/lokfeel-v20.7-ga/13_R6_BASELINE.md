# R6-00 · 基线核验与权威门禁（先固定事实，再谈通过）

> 生成：2026-11-13 · 执行者：WorkBuddy · 只读核验，未发布、未改生产配置、未发生扣款
> 本文件的作用是**把"通过" anchors 在可复现的 SHA 与门禁清单上**。没有这一节，后面所有 PASS 都无法复核。

## 1. 三个 SHA（同时存在，不能混用）

| 对象 | SHA | 说明 |
|---|---|---|
| 生产运行版本 | `0e16959` | `/api/health.commit` 实测；`checkoutReady=false` / `PENDING_APPROVAL` |
| 远端 `main` 头 | `000a7a6` | 比生产多一个纯文档提交（带 `[skip netlify]`，故未触发重建） |
| GA 候选（R6 起点） | `39b4ac8` | `release/v20.7-ga` 上的 T2 修复提交；R6 的改动都在它之上 |

**为什么必须分成三行**：上一轮把"生产已是热修代码"当成了"GA 候选"，两者只在支付面 5 个 blob 上等价，页面范围并不同。任何"生产已通过"的结论都不能平移到候选上。

## 2. 13 项权威门禁（来源：`docs/release/lokfeel-final-20261110/GATES.csv`）

| 门禁 | 当前 | 证据来源 | R6 归属 |
|---|---|---|---|
| G0 baseline | PASS | `git ls-remote` + health/plans + `.next` sha256 | — |
| G1 eight-questions | PASS | `p0-03-public-surface-audit.mjs` | — |
| G2 pages-legal | PARTIAL | D8 主体未批；C-31 三条 NOT_TESTED | T2（已做封存，待四视口/axe 复测） |
| G3 figma | BLOCKED | 无 Figma 写入 token/connector | Owner 授权 |
| G4 a11y | PASS | `b4-g4-public-matrix.mjs` | T2 复测（四视口） |
| G5 real-users | NOT_TESTED | 需 ≥5 名真人 | Owner 授权 |
| G6 real-provider | PASS | Outcome 阶梯 15/15 + Provider 连通 28/28 | — |
| G7 billing | PASS_CODE_ONLY | jest + p0-02 端到端（mock） | T4（真投递） |
| G8 security | PARTIAL | gitleaks 本地未装；产物复扫留 G13 | T7 附带 |
| G9 infra | PARTIAL | CF/DNS 只读审查；D6 范围未定 | Owner 决策 |
| G10 perf | PARTIAL | TBT 0/8 | **T7（本轮主攻）** |
| G11 same-rc-gates | PARTIAL | 远端 CI 曾 12PASS/1FAIL；无独立 PR | T8 / 发布治理 |
| G12 pricing-approval | BLOCKED | D1 未批准 | Owner 授权 |
| G13 post-release | N/A | 未发布 | 发布后 |

**一条必须说清的口径**：G13（发布后验证）在"未发布"状态下只能是 `N/A`。所以**发布前最高是 12/13**；"13/13"只能出现在真实发布并完成 G13 之后。任何在发布前宣称 13/13 的说法都与门禁定义冲突。

## 3. 测量有效性声明（T7 的绝对数不能跨机比较）

| 项 | 值 |
|---|---|
| 主机 | MacBook（Intel Core **m3-7Y32 @ 1.10GHz**，2017 年级低功耗双核） |
| 系统 / 浏览器 | macOS 13.7.8 / Google Chrome **157.0.8103.52** |
| 视口 | 390×844，DPR 3，`isMobile` |
| 网络 | 下行 1.6 Mbps / 上行 750 kbps / RTT 150ms |
| CPU | **4× 降速**（Lighthouse 移动端档位） |

在这台机器上叠 4× 降速，等效于把 CPU 压到"比任何真机都慢 1.5–2 个档"的水平。因此：

- **绝对 TBT 不可与 Lighthouse/CI 的数字直接比较**，也不能说"线上用户就是这样"；
- 可比较的是**同一会话内的前后差**（同机、同浏览器、同构建方式、同节流）；
- 上一轮 `vitals-p0-2026-11-12.json`（3112 端口）与本轮基线（3116 端口）差 2–3 倍，原因是**服务与浏览器二进制变了**，不是代码退化 —— 这也说明为什么必须固定环境后再谈达标。

## 4. R6 任务 DAG（并行 → 收敛）

```
T7 性能 ─┐
T8 健康/DB ─┼─→ 单一批次构建 → 统一测量/审计 → 冻结唯一候选 SHA → 证据包 → 独立复核
T2 四视口 ─┘                                        ↑
远端 CI（rc/** 分支）────────────────────────────────┘
```

- **T7 与 T2 不共改同一文件**（T7 动 `instrumentation-client.ts` / 布局 provider；T2 只读测量），可并行；
- 收敛点是一次构建产物：所有测量与审计都指向同一个 `.next` + 同一个候选 SHA；
- 自动迭代上限 3 轮：每轮必须"复现 → 归因 → 最小改动 → 回归"，不允许"改到绿为止"。

## 5. 本轮已完成的代码改动（T7 第一轮）

| 改动 | 依据 | 风险控制 |
|---|---|---|
| `instrumentation-client.ts` 去掉 Sentry 的**静态** import，改为"有 DSN 才动态导入" | 无 DSN 时 `Sentry.init` 不发任何事件，但 SDK（含 Replay）485KB 被 8 个公开页全部执行 | 有 DSN 时行为不变；无 DSN 时是删死代码 |
| `next.config.ts` 的 `withSentryConfig` 按 DSN 条件挂载 | 同上 | 有 DSN 走原路径 |
| 根布局移除 `SessionProvider`，下放到 `(dashboard)`/`workspace`/`console`/`dashboard` 四棵子树 | `useSession` 全仓只出现在 dashboard/workspace 组件；营销页一个都不用 | 每个使用点都有 provider；`(dashboard)` 本来自带 |

首屏脚本体积（未压缩，实测）：

| 页面 | 改前 | 改后 | 差 |
|---|---|---|---|
| `/product` | 806 KB | **590 KB** | −216 KB |
| `/` | 868 KB | **808 KB** | −60 KB |

> `/` 降得少，是因为落地页本身是一个 8 段式的客户端组件（自带 227KB + 143KB 两个业务 chunk）。它是下一轮"拆包/延迟水合"的对象。

## 6. 未闭合（都需要人或凭据，不是"再写点代码"）

| 项 | 状态 | 处理人 |
|---|---|---|
| T3 OWNER→503 实测 | `NOT_TESTED`（无生产 QA 会话凭据） | Owner 提供 QA OWNER 账号 |
| T4 Dodo test_mode 全链路 | `BLOCKED`（无 test_mode key） | Owner / Dodo 后台 |
| G3 Figma | `BLOCKED`（无写权限 token） | Owner |
| G5 真人测试 | `NOT_TESTED` | Owner 招募 |
| G12 / D1 定价批准 | `BLOCKED` | Owner |
| D8 法律主体 | `BLOCKED` | Owner |
| 发布治理（ruleset / 停止自动发布） | `PARTIAL` | 仓库管理员（Owner） |
| 独立 PR + Netlify/Cf Preview | `BLOCKED`（无 token；`allowed_branches=["main"]`） | Owner 授权或人工建 PR |
