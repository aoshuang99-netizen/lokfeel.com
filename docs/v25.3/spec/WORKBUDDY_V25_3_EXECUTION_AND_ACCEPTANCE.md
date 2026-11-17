# LokFeel V25.3 — 下一批核心业务闭环与强制验收令

**状态：计划 / NOT_EXECUTED；本文件不代表代码已改、生产已部署或 QA 已独立通过。** 适用对象：WorkBuddy 总调度 / Codex 独立 Reviewer / IM & Security / AI & Privacy / Business / Platform / Release。

## 0. 事实源、原则与前置纠正

- 来源：用户提供的 V25.2 执行报告（2026-11-17），沿用既有 V25-xx 任务 ID，不另造体系。
- 已报告本地证据：V25-09 发送真实 HTTP 11/11；V25-10 读取真实 HTTP 4/4；Jest 164 suites/2951 tests、tsc/eslint/build 退出码 0。**独立 Reviewer 缺位，均不构成生产 PASS**。
- 未完：Socket/Pusher 实时推送、AI 处理、bot-chat、日志、通知/导出/转发；真实两端/两身份 IM；社交 AI/记忆；自托管；独立审查；全端 UI/性能；支付止损、账本与生产验收。
- 报告生产支付：`b50e53e`、`checkoutReady:true`、`live_mode`；必须重新真实读证据而不是假设当前仍如此。远端 GitHub main 读取为 `cad717e92542395e4346e49d388f09be78ec1557`，`protected=false`。
- WorkBuddy 所述“Hotfix Preview”目前只提供本地候选验证摘要；**不得将本地 preview 当成 Netlify 独立部署**；必须拿到真实 Deploy Preview URL、deploy ID、目标 SHA、CI、回滚 ID，并展示服务器端登录态被拒绝。
- 安全修复不得放宽 R1/RBAC/商业门。所有高风险生产写操作、真实扣款、外发通知、密钥修改均须授权；安全工作、单测、沙箱集成和 CI 准备可继续进行。

## 1. 十条任务线，原 ID 不变

### T01（V25-01 + V25-33）P0 / 生产商业风险与最小 Hotfix
**负责人** Release + Billing + Independent Security Reviewer。
**实际动作**：重新获取生产 /pricing、Dodo plans、/api/health、精确 Deploy ID、支付门；在准确生产父提交上建仅含 fail-closed 的隔离补丁；复核未批准目录 APPROVED 不得抵消 Owner 审批缺失；生成独立 PR、CI 与 Deploy Preview；留有可靠回退到仍安全状态的备选版本（回滚旧未设门版本会重开支付）。
**硬验收**：匿名 POST 返回预期 401；经过授权的 QA 登录态在 `PENDING_APPROVAL` 下创建 checkout 返回预期 403/503 且 `PRICING_NOT_APPROVED`，Provider session 数为0； `/pricing`、`/api/payments/dodo/plans` 不暴露未经批准的金额/计划，前后端响应一致；有效旧订阅、Webhook、退款/取消链保持可用；真实 Preview SHA=Reviewed SHA；生产部署需 Owner 针对 exact SHA 单独批准。**任一缺证=BLOCKED，绝不声称 PRODUCTION_RISK_CLOSED。**
**工具** git/GitHub PR/Actions、Netlify、curl、Playwright、Dodo sandbox、Prisma、账本与日志。

### T02（V25-09 + V25-10）P0 / Consent 全传播路径闭环
**负责人** IM Security。
**实际动作**：保留上轮 send/read fix，不重写；审计 Pusher/socket 事件、消息历史、会话列表、群通知、转发、导出、AI/bot 对话上下文、CDN/缓存、日志/Trace/客户端控制台。制定可执行的统一 `authorizeMediaAction(view|send|forward|export|process_ai)` 权限判决 API，服务端每次新数据披露都审查范围/时间/撤销状态/会话/主体。历史已送达的客户端副本不可保证收回，要明确披露。
**硬验收**：实际授权、拒绝、过期、撤销、重放、竞态、跨会话/跨租户、对端方向、L1+L2 多有效授权、最高档+全局撤销的冲突决策均有负控；违规时 `HTTP=403` 或返回不含秘密的遮盖态；DB增量=0、Pusher emit=0、Bot enqueue=0、工具调用=0；日志、异常与分析埋点不能含原始 data URL/base64；接收端取消授权后所有**新的服务端披露**都按策略阻止。发送端自己的历史可见性需单独契约，不能默认共享。**媒体类型判定只靠 dataURL 正则不够**：审计普通 URL、二进制魔数、upload token、大小限制、MIME 伪造，优先让媒体引用绑定服务端受控对象。
**工具** Jest、Prisma、Playwright、Pusher 测试事件、HTTP HAR（脱敏）、Gitleaks、OWASP ASVS、日志扫描。

### T03（V25-05 + V25-07 + V25-08）P0 / 真人通信双端闭环
**负责人** IM Frontend + Backend，另一团队独立 QA。
**实际动作**：2 个独立真实测试账号、两独立浏览器上下文/设备、不同组织成员，文本、图片、语音、已读、离线恢复、顺序、重试、删除与举报。禁止 bot 代替接收方。
**硬验收**：≥20 条双向实际通信；≥50 次网络扰动/断连与重试，状态机记录准确、内容不乱序、idempotent clientMsgId 不产生重复持久消息、送达/已读须绑定接收端实际行为；至少一组授权前/撤销后的接收行为；两个租户互发非法路径为零泄漏；移动和桌面端均可操作；完整 HTTP/WS 事件和数据库回执脱敏留存。
**工具** Playwright multi-context、Prisma、Pusher、Network throttling、Jest/E2E。

### T04（V25-13 + V25-14 + V25-19）P0 / 私人生成式社交能力
**负责人** AI Lead + Safety Evaluation。
**实际动作**：接入真实 Provider 到聊天侧边栏的翻译、表达建议、对话起草；先处理用户本人授权内容，不抓取他人私聊；区分 AI_PRIVATE_DRAFT 与 HUMAN_SENT，显示模型来源/降级；构造≥150 条独立双语/多语言沟通语境评测，覆盖礼貌、冲突、拒绝、歧义、含恶意指令的引用内容。
**硬验收**：每条 AI 调用有 consent_ref / purpose / recipient_scope / model_id / input_data_scope / request_id；未经许可敏感内容零云端外发；用户未点击发送，数据库消息写增量为0；模型结果无真人 impersonation，危险情绪/意图推断以不确定性说明，允许不回答；与不使用 AI 的同样任务基线比较质量和人工时间，真实用户盲测至少10人再评估效果，评测输出误差簇而非只报平均分。
**工具** Provider 接口、promptfoo/自建对抗集、Jest、Playwright、OTel 隐私过滤。

### T05（V25-11 + V25-12 + V25-15 + V25-16）P0 / 关系与记忆私密域
**负责人** Data Architect + Privacy/Security。
**实际动作**：独立 personal, dyad, group, organization, research 五域记忆；严格分离“用户说过/双方确认/模型推断”；以最小字段、存储寿命、用途和授权为主轴。研究数据默认不贡献；组织管理员不得读取个人 Vault。
**硬验收**：跨用户、跨组织、跨记忆域越权全零；同意撤销/更正后下一次新推理和搜索不可再使用撤回数据；密钥管理、轮换、备份/恢复设计、离线与删除后残留策略明确；实验核对至少 5 种主体×5 种操作×3 种权限状态（有效/无效/撤回）=75 条控制组合（可参数化）；训练撤回不能保证从既有权重中立即移除，需如实说明。
**工具** Prisma/migration、Auth、KMS/SOPS、policy engine、Jest、OWASP。

### T06（V25-29 + V25-30）P1 / 开源自托管发行
**负责人** Open Source / Platform。
**实际动作**：核实 AGPLv3、版权和依赖许可；为 Community Edition 编写最小运行组装、离线本地推理替代、Demo 数据与生产数据隔离；只在私有评审获得批准后考虑许可证变更。
**硬验收**：两个独立空环境，不注入 LokFeel Cloud/API 密钥，也能完成注册、两个真实账户互发消息、打开私有 AI 本地推理、授权撤回；SBOM 含所有运行时依赖，已知高危漏洞及例外有登记；升级与销毁不会破坏真实数据；源码、许可证及可复现 build 命令完备。
**工具** Docker Compose、Syft、OSV/Scorecard、llama.cpp、GitHub release、check:selfhost。

### T07（V25-31 + V25-32 + V25-39）P0 / 独立安全审查与 GitHub 治理
**负责人** Security Reviewer (not patch author) + Release。
**实际动作**：独立复算旧高危媒体漏洞的 RED/修复后的 GREEN，重新从生成代码而非口头摘要验证所有调用点；设置保护分支、required checks、安全扫描、审查条件、禁止直接自动生产部署。
**硬验收**：跨租户读写、权限撤销后重放、代理冒充、prompt injection、恶意媒体、密钥与日志泄漏等零重大问题；通过不具合并权的测试账户**验证**直推 main 被拒、缺 required check PR 被挡；真实远端 Actions 全绿且 Reviewer 与作者不同；无 `gh` 时应使用已授权 GitHub connector/API 或准备最小管理员动作并继续其他验证，不得伪造保护已开。
**工具** GitHub connector/API/Actions、CodeQL、Gitleaks、promptfoo、Jest、Playwright。

### T08（V25-35 + V25-36）P1 / Personal/Business 全站可用性与性能
**负责人** UX/Frontend + Accessibility/Perf。
**实际动作**：两个用户产品线的首屏 IA、消息流、隐私权限解释、错误恢复、语言包；营销层绝不将 Agent/Schema/MCP 作为核心购买理由；修复长任务，维持既有 G15 门禁。
**硬验收**：7 档视口、各状态无横向溢出/重叠/点击空按钮；axe 零严重、键盘与200%缩放真实测试、语言一致；原 9 个场景在同一节流条件下 TBT≤200ms、LCP≤2.5s、CLS≤0.1，若任何失败继续 G15 FAIL；使用真实登录态而不是登录重定向截图；≥10名真人任务测试中≥8可独立完成核心社交动作。
**工具** Figma（有权限时）、Playwright、axe-core、Lighthouse CI/Chrome Trace。

### T09（V25-34）P0 / 支付、Webhook、账本与权益四方核对
**负责人** Billing + QA。
**实际动作**：用实际 Dodo test_mode 事件 ID 验证 `ProviderEvent→WebhookSignature→BillingEvent→Entitlement`，重点检查重复、乱序、fail→success、退款/取消与跨租户；不改变未批准商业门。检查生产既有订阅读/通知链可延续。
**硬验收**：同事件幂等0双记账、失败不误开权益、成功正向权益正确、撤销/退款按商业规则一致；保留 provider event ID、执行日志、DB快照、权利回读；没有真 Provider delivery 的 mock 只能 `PASS_CODE_ONLY`，不得记 `PROVIDER_VERIFIED`。
**工具** Dodo test-mode、Webhook test delivery、Prisma、Reconciliation。

### T10（V25-40）P0 / 精确 SHA 的发布与 G13 生产验收
**负责人** Release + Owner。
**实际动作**：生产 Hotfix 与 V25 正式产品分轨。先迁移兼容/回滚演练、冻结 RC SHA、独立 QA+required CI+真实 Preview，Owner 确认 exact SHA 后部署；发布后 G13 检查真实登录、通信、权限、AI、账本和 health.commit，48 小时只读监控。
**硬验收**：Preview SHA/commit/build/DB migration 唯一对应；生产 SHA=已批准 SHA；回滚的旧版本必须保持商业安全，不能恢复未授权 checkout；G13 有生产真实账号的读写验证与授权边界；事故回滚演练和故障预案有效；若存在大风险，立即 NO-GO 并恢复安全状态。
**工具** GitHub/Actions、Netlify/Cloudflare、Prisma、Playwright、OTel/日志、Dodo。

## 2. 执行依赖与并行路径
- 最快安全链：T01 准备→独立审核 T07→Owner exact-SHA 批准→最小 Hotfix 生产复验；不等待其余 V25 功能。
- IM 隐私主线：T02 新泄漏面关闭→T03 两端通信→T04 私人 AI→T05 记忆域；T02/T03 的不冲突子文件可并行。
- Open platform：T06 与 T08、T09 可并行；T10 正式 GA 需要所有适用 P0 门禁及业务签字。

## 3. 统一机器可验收定义
状态机：`NOT_STARTED → CODE_COMPLETE → LOCAL_E2E_PROVEN → INDEPENDENT_VERIFIED → REMOTE_PREVIEW_VERIFIED → PRODUCTION_VERIFIED`；`BLOCKED/FAIL/NOT_TESTED` 不可转换成 PASS；每升一级提交 `git SHA, tree hash, run id, command exit code, negative control, PII-redacted raw log, API evidence, DB diff, reviewer, preview URL/deploy ID, production SHA`。

**禁止型反例：**
1. 已撤回授权但从 socket、push、bot summary、log、history、idempotency response 再获取媒体原文 → FAIL。
2. API返回200但接收端从未收消息、或没有真实 Provider 回执就声称 SENT/VERIFIED → FAIL。
3. 仅检查匿名支付401而无已登录且未批商业门的真实负例 → FAIL。
4. 本地 Preview 冒充 Netlify Preview；x-nf-request-id 冒充 deployId；main未保护却声称受控 → FAIL。
5. 老旧回滚版本重新开放付费；或生产迁移不可逆/无备份 → FAIL。
6. AI 私人草稿在未点击发送前对外发消息、把对方私人聊天内容送到模型或 Research → FAIL。
7. 模型推断心理状态被当事实；真人/AI身份混同；假用户、假成员、模拟接收当真实 → FAIL。

## 4. 本轮只需集中提交的 Owner 决策
1. **U-1**：经独立审查的生产最小 Hotfix exact SHA 与部署窗口授权；如采用撤销支付密钥，先评估在役 Webhook/订阅影响。现有本地闭门候选不是生产修复。
2. **U-2**：双方媒体 Consent 的撤回语义（历史远端读取、发送方自存副本、已送达设备不能追溯删除）；在正式裁决前，新对外读取一律走最小权限。
3. **U-3**：Personal / Business 试点账号与实际真人测试、外部 Provider 的有限授权。
4. **U-4**：独立 Reviewer、Figma 和 GitHub 管理权限配置。

## 5. WorkBuddy 交付纪律
没有真实行为改变的文档不算完成。每个任务应同时提供真实 API/DB/客户端回执与安全反例；测试设计人不得把自己生成的模拟数据当现实用户证据。下次回复表格：`TASK / BEFORE / AFTER / CODE_SHA / PROVEN_EVIDENCE / NEGATIVE_TEST / INDEPENDENT_REVIEW / PREVIEW / PROD / NEXT_ACTION`。能继续开发的一律继续，遇高风险写操作只停受限制动作。
