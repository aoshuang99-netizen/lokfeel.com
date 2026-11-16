# V23 · Owner 集中决策单（一次性提交，不逐条反复提问）

状态：**待批复**。工程侧可逆工作不等待本单；生产修改、对外发送、真实扣款、定价与法务身份永远单独审批。依据：总令 `00_WORKBUDDY_V23_EXECUTIVE_ORDER.md` §03/§05/§08、`STRATEGY_DIFF.md` 第 ④ 列。

## D-1 · V23 一级定位批准
- **决策**：是否批准产品一级定位冻结为 **AI-Native Relationship & Generative Social Platform**（价值单位 `Verified Introduction`，链路 `Real People → Mutual Intent → Trusted Introduction → Interaction → Relationship Outcome`）。
- **背景**：V22 曾把默认用户改成「有数字事务要完成的个人」，属产品类别错误；V23 修订 `STRATEGY_LOCK.md` §1。
- **不批的后果**：所有 U 卡验收口径悬空，首页/导航/公开页文案无判据。
- **建议**：批准（历史 2026-09-07 结论同向）。

## D-2 · 首个商业场景确认
- **决策**：V1 首个场景是否采用**成人长期关系 / 优质介绍**（高信任 Verified Introduction 市场验证）；社群顾问 SaaS 仅做一个同构试点；其他社交场景列 P2。
- **背景**：历史最早有研究依据的场景是婚恋介绍；但**必须以真实供需证据（R04 访谈 20+10+3）和 Owner 确认为准**，不得默默锁定。
- **建议**：有条件批准——先跑 R04 访谈任务书，证据不足则回退重选场景。

## D-3 · 首页 Hero 文案与用户测试口径
- **决策**：批准对外主文案（EN）`Meet people worth knowing. Both people choose. Real connections follow.` 与「5 秒测试」口径（≥8/10 真人答对「帮真人建立可信关系」）。
- **关联**：U01/U02/Q05 验收判据；中文主文案待 i18n 批次一并批准。

## D-4 · 生产定价泄漏处置（最紧急，P0）
- **LIVE 事实**（2026-11-16 15:09 取证，`LIVE_RISK_AUDIT.md`）：生产 `b50e53e` 的 `/pricing` 公开显示 `$89/$199/$449`，`/api/payments/dodo/plans` 返回 `checkoutReady:true + APPROVED + live_mode`；而 D1 定价从未获 Owner 书面批准。
- **决策（二选一）**：
  - **A. 发布热修复**：批准把本地 fail-closed 候选（`PRICING_APPROVED=false` 三重门）发到生产——涉及生产部署，走单独发版流程（先迁移核查后发版）。
  - **B. 摘除生产支付密钥**：在 Netlify 移除 `DODO_PAYMENTS_API_KEY`，收银台立即关闭（影响：合法 webhook/历史订阅管理一并受影响）。
- **建议**：A（代码已备好且有 374 项 billing 单测护栏）。

## D-5 · bot 模块去留
- **LIVE 事实**：现网 health `botModule.enabled=true`；`isBot` 会话会 simulate real human behavior，与「零供给诚实空态」直接冲突。
- **决策**：保留（明确标识 bot 并隔离于真人供给）或关闭。
- **建议**：V1 关闭，U 卡把 bot 从消费者候选面摘除。

## D-6 · 发布治理授权（Q03/Q06）
- **决策**：授权保护 main 分支、required CI checks、批准分支触发 Preview、以及未来 RC 的单次批准流程。
- **背景**：远端 `cad717e` / 生产 `b50e53e` / 本地候选三者长期不一致且 main 无保护，`[skip netlify]` 纪律靠自觉。

## D-7 · 真人试点与外部执行器授权（Wave B 后期需要）
- **决策**：授权 ≥10 次真实双方同意介绍试点（含一种真实投递通道）与外部执行器接入范围。
- **边界**：对外发送真实消息/引荐永远逐次审批，不因本单而放宽。

---
**回复方式**：逐条回复 D-1…D-7（批准/否决/改条件），或直接说「按建议执行」。D-4 建议今日内批复（生产泄漏在持续）。
