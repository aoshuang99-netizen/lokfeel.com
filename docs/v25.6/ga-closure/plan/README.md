# LOKFEEL V25.6-GA Closure — 工作包导读

**已创建文件，仅为可执行计划及验收契约；不代表完成代码、真实模型、部署或用户实验。**

依序阅读：

1. `00_EXECUTIVE_RELEASE_ORDER.md`：5 Whys、总目标与阶段性发布策略。
2. `01_CAUSAL_KPI_EVIDENCE_MATRIX.csv`：16 项“真实工程证据→用户价值”的因果判断及缺少的实验。
3. `02_ROUTE_VALUE_CTA_API_MATRIX.csv`：20 个页面/路由组、用户场景、真实数据源、删减规则和硬验收。
4. `03_UI_CSS_INTERACTION_SPEC.md`：可执行 CSS Token、移动/桌面 IA、Chats/AI/Console/Developer 页面与状态。
5. `04_BILINGUAL_COPY_AND_MICROINTERACTIONS.md`：全站中英核心文案，AI真可用/尚未可用两套合法首页表达。
6. `05_ENGINEERING_TASK_DAG.json`/`.csv`：20 张 GA 收口子任务，原 V25.6 UX00–17 为父任务，不覆盖旧编号。
7. `06_PRIVACY_SAFE_METRICS_CONTRACT.json`：非内容型产品埋点、5秒/90秒/180秒和AI价值对照实验。
8. `07_RELEASE_GATE_AND_ROLLBACK.json`：S安全止损、P个人Alpha、B企业Beta、O开源、GA公测的独立门禁与回滚。
9. `08_DYNAMIC_UI_DATA_TRUTH_CONTRACT.md`：禁止无数据可视化与假按钮的动态 UI/数据契约。
10. `09_WORKBUDDY_EXECUTE_NOW.md`：可直接复制给 WorkBuddy/Codex 的执行令。
11. `SHA256SUMS.txt`：除其自身之外全部文件的 SHA256。

源证据：用户上传的 `REPORT.md`, `V25.6_STATUS.md`, `report.json`；本轮 GitHub 远端 `main cad717e...` 与旧源码只读核对。**无法独立访问生产站、无最新本地 WorkBuddy 工作树、无生产机凭据，因此任何线上断言仍须实际部署前重新取证。**

目录内容可直接解压纳入仓库 `docs/v25.6/ga-closure/`，但必须先确认与现有同名文件/生产发布政策无冲突。请勿将本计划直接解释为生产变更授权。
