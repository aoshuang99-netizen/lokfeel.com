# T04 · 三套生成式 OS 设计方案 — 概念与评分

预览（可交互，PC + 移动 + 三态 + 动效降级）：

| 方案 | 预览文件 | 一句话 |
|---|---|---|
| A · Living Universe | `preview/A-living-universe.html` | 深色空间画布，Mission 为聚焦星体，授权/候选/成果绕轨 |
| B · Living Paper | `preview/B-living-paper.html` | 暖白数字纸张 + 编辑式排版，像"可以签字的账本" |
| C · Adaptive Dual World | `preview/C-adaptive-dual-world.html` | 左暗色 Canvas + 右亮色 Inspector，**随 Mission 阶段自动变形** |

三套都覆盖任务书要求的 10 项：主工作台 / 自然语言创建 Mission / 生成式画布 /
Connection·Agent 操作 / Consent 审批 / Outcome 视图 / Console 运营语义 / 移动端 /
Loading·Empty·Error / reduced-motion 降级。

## 评分（任务书权重）

| 维度（权重） | A · Universe | B · Paper | C · Dual |
|---|---|---|---|
| 业务效率 25% | 3.5 | **4.5** | **4.5** |
| 清晰与可理解性 20% | 3.0 | **4.5** | 4.0 |
| 生成式交互创新 20% | **4.5** | 3.0 | **4.5** |
| 视觉辨识度 15% | **5.0** | 3.5 | 4.5 |
| 移动端与无障碍 10% | 3.0 | **4.0** | **4.0** |
| 性能与实现成本 10% | 2.5 | **4.5** | 3.5 |
| **加权合计** | **3.55** | **4.03** | **4.30** |

> 评分口径：5 = 该维度具备显著优势且已在原型中可验证；1 = 明显短板。
> A 的性能分低是因为全屏星群 + 多层 blur 在低端移动设备有掉帧风险（原型已做 reduced-motion 降级，但成本仍在）。

## 结论与建议

**推荐 C（Adaptive Dual World）作为主方向**，理由：

1. 直接命中 T03 审计的最大痛点 —— 信息密度（F-05）与 Evidence Lens 噪音（F-06）：
   Canvas 负责"现在发生什么"，Inspector 负责"为什么 / 凭什么"，两类信息不再互抢空间。
2. "布局随 Mission 阶段变形"（CREATED→…→COMPLETED）是三套中唯一把**产品主流程本身**
   做成交互骨架的设计：到 AWAITING_CONSENT 自动聚焦 Consent，到 EXECUTING 进入沉浸。
   这正是"生成式 OS"与"管理后台"的分界线。
3. 实现成本可控：Inspector 可由现有 Evidence Lens 改造，Canvas 可按屏渐进增强。

**吸收**：A 的 Mission 星体作为品牌记忆点（首页/Field 屏）；B 的纸张排版与审批表单
作为 Consent 屏与导出文档（PDF/审计报告）的基调。

**边界**：三套原型使用演示数据（与真实端点字段同名同形，但数值为示例）；
未接触生产主线代码；落地需另立任务并经视觉评审批准。

## SCREEN_STATES（三套共用的状态语义）

| 状态 | 触发 | 表现 | 禁止 |
|---|---|---|---|
| LOADING | 端点未返回 | 骨架/进度条，注明端点 | 用 setTimeout 伪造完成 |
| EMPTY | 端点返回 0 条 | 说明"为什么是空"+下一步 | 把失败渲染成空 |
| ERROR | 4xx/5xx | 错误码 + 重试 | 吞掉错误继续渲染旧数据 |
| BLOCKED | 服务端拒绝授权 | 显式"已阻断"+原因 | 显示成可开启的开关 |
| DISABLED | 能力未接线 | 禁用 + 原因 tooltip | 留一个点了没反应的按钮 |
