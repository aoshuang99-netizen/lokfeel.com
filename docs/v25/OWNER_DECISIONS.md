# V25 · Owner 集中决策单（一次性提交）

状态：**待批复**。依据：V25 总令 §八（不得擅自执行生产迁移/扣款/对外消息/发布）、A00 LIVE 事实、A01 源码资产、V23 未闭合的 `docs/v23/OWNER_DECISIONS.md` D-1~D-7。
本单只问必须 Owner/法务/外部主体的事项；可逆工程已在本地分支推进，不等签字。

## U-1 · 生产定价风险处置（最紧急 P0，继承 V23 D-4）
- **LIVE 事实（2026-11-17T04:17Z）**：生产 `b50e53e` 的 `/pricing` 可见 `$89/$199/$449`；`/api/payments/dodo/plans` 报 `checkoutReady:true` + `environment:live_mode` + `commercialApproval.status:APPROVED`；`health.payments.charging:true`。本地 `07486db` 已 fail-closed 但未部署。
- **二选一**：A 批准发布本地三重合取热修复（走单独发版流程）；B 批准摘除生产 `DODO_PAYMENTS_API_KEY`（影响历史订阅管理/webhook）。
- **建议**：A。未批前不得自动改生产。

## U-2 · V25 一级定位与品牌对外表达（继承 V23 D-1，冲突升级）
- **决策**：是否把对外品类从 V23 冻结的 `AI-Native Relationship & Generative Social Platform` 升维为 V25 `Open AI Social Platform`（一个平台/两类客户/三种形态/开放生态）。
- **影响**：`brand.ts`、首页、6 个公开页、metadata/OG 全量改文案；V23 已冻结的 Hero 文案作废须签字。
- **建议**：批准，但**先签产品真值源 `V25_PRODUCT_TRUTH.md` 再改页面**，避免第三次文案返工。

## U-3 · 首个试点场景优先级（继承 V23 D-2）
- V23 建议「成人长期关系优质介绍」；V24/V25 建议「跨语言个人社交 + 跨地域企业/专业社群」。
- **决策**：选哪条先做 A/B；是否同意「婚恋垂类降为插件、不再是平台同义词」。
- **建议**：按 V24/V25 的跨语言 + 专业社群（与开放平台定位一致），但须真实供需访谈（R04）支撑。

## U-4 · 开源许可证与 Open Core 边界（V25 新增，法务）
- **事实**：仓库现有 `LICENSE`（AGPLv3）+ `LICENSE-COMMERCIAL.md` + CLA/DCO/TRADEMARK；V25 期望「消息与 Social SDK 优先 Apache-2.0 或其他 OSI 许可」、「Community Edition 真实可运行、不依赖隐藏商业密钥」。
- **决策**：① 是否维持 AGPLv3+商业双许可，还是拆分核心 Apache-2.0 / 云服务专有；② 哪些模块进 Open Core、哪些保持商业（MCP/A2A 现可 REUSE）；③ 模型权重与评测集逐项许可。
- **禁止**：未经许可把 Dify 等带多租户限制的许可证代码作核心发行（V25 §三明禁）。
- **建议**：先做 License RFC（V25-13），法务签字后改 `LICENSE`，本轮不动。

## U-5 · 真实外部投递 / 模型后端授权（V25 §五/验收铁律）
- **决策**：授权哪一个真实投递通道（用于 CMI/Introduction 的真实回执，EMAIL 现为 CAPTURED）、哪两种真实可替换模型后端（本地开源权重 + 商业云）。
- **未授权不得**：对外发送真实引荐/消息、真实扣款、抓取第三方私聊。

## U-6 · 生产/发布治理（继承 V23 D-6）
- 授权保护 main、required CI、Preview 由批准分支触发、RC 单次批准、G13 + 48h 监控。远端 main 现 `cad717e` 无保护，`gh` 未装。

## U-7 · bot 模块与「真人对立」处置（继承 V23 D-5，LIVE 刷新）
- **LIVE**：`health.botModule.enabled=true`（`enabledSource=env`，tick 60s / max 50 actions）。
- **决策**：V1 关闭，或保留但明确标识 bot 且排除于真人候选/供给统计外。

## U-8 · 独立审查 / 真人试点（V25 F 组）
- 授权独立 Reviewer（非本 Agent 自签）、10 人真人 + 企业设计伙伴试点、真实访谈同意流程。无样本一律 `UNTESTED/NO_SAMPLE`。

---
**回复方式**：逐条 U-1…U-8（批准/否决/改条件），或说「按建议执行」。**U-1 建议今日内批复**（生产泄价持续）。
