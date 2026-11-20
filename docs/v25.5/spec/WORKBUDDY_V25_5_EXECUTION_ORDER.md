# LokFeel V25.5 — 聚焦支付终局对账与 AI 原生社交的下一轮执行总令

版本：2026-11-20。性质：任务书/待执行，不是运行证明。依据：WorkBuddy 报告 `dc30388` + `2f198d2`，11 次进程内 Handler、9 场景、隔离 libSQL + 人工生成签名；远端 `main=cad717e92542395e4346e49d388f09be78ec1557` 且 `protected=false` 已通过 GitHub 重新核查。本地提交与生产 SHA、环境状态须由执行方开始时再次实测。保留 V25.1—V25.4 原任务 ID，不新造替代体系。

## 一、战略边界 / 验收计分
- LokFeel = 面向 Personal + Business + Community 的开放生成式 AI 社交平台。支付是安全基础设施，不是产品北极星。
- 工程结果按 `CODE_COMPLETE / LOCAL_TESTED / INDEPENDENTLY_VERIFIED / PREVIEW_VERIFIED / PRODUCTION_VERIFIED` 分级。只有真实特定版本与真实副作用/后置条件才能升档。
- 真实 Provider 回执、签名、金额、退款状态、组织归属与权益的对账，不能被自签 Test Key + 进程内 Handler 调用替代。模拟消息也不能替代双端真实消息。
- 未获明确授权不得发布生产、调整生产密钥、生产数据库迁移、扣款、发外部消息、暴露用户私密原文。
- 工作不得因某个外部依赖阻断整体推进。平台技能/工具均先检查现有安装、权限、版本、许可和副作用。

## 二、P0.0 — 财务与商业安全 Hotfix（V25-01 / V25-33）
**目标**：单独恢复生产“未经审批不得新收费”的确定性安全边界，不搭载 V25 功能大包。
**立即可做**：只读取证生产 `GET /api/health`、`/pricing`、plans JSON、已登录/未登录 Checkout 控制流程；从生产所用源版本独立最小修复分支产出补丁、差异与补丁 SHA；隔离 Preview 和模拟业务场景验证；锁定授权前一切生产写禁止。
**验收**：已登录/未登录、有价/无价计划、伪造 checkoutReady、旧版缓存、直调 Checkout URL 等不少于 12 个负例；未批时浏览器/SSR/JSON 不披露未经批准报价，创建 Checkout 的服务端路径返回不可购买且 Provider CREATE 调用 0；有效历史订阅和真实退款/webhook 接收不受影响。复核回滚后的商业门不能重新开放，必要时采用 roll-forward 安全恢复方案。
**依赖**：Owner 授权才能实际发布或变更密钥。独立验证可先在本地与获授权 Preview 完成。

## 三、P0.1 — R-15 Durable Inbox / 最终对账（V25-34）
**真实缺口**：`payment.failed → payment.succeeded` 当前收到 `200 + deferred + ledger_rejected`，只证明拒绝非法改判，不证明资金/权益最终结算。
**实现**：
1. 验证签名后以 Webhook delivery ID / Provider Event ID 幂等持久化 Inbox；ACK 与持久化成功绑定；保存规范化字段、payload 哈希、事件类型、provider 支付/订阅 ID、组织 ID、收到时间、处理状态及拒绝原因。原文敏感信息最小化/加密，绝不写日志明文。
2. `RECEIVED → APPLIED | NEEDS_PROVIDER_RECONCILIATION | RETRYABLE | REQUIRES_REVIEW | DEAD_LETTER` 状态机；禁止静默 `ignored` 永久吞单。对 Provider 权威状态有授权核验接口；没有凭据仍完成抽象接口和隔离测试，但标 `PROVIDER_NOT_TESTED`。
3. 单个 payment_id 的失败→成功、成功→失败、乱序、重复、跨订阅 ID、金额/币种差异、数据库中断、处理器崩溃和双 worker 抢单；采用可证明的幂等性与事务边界。
4. `Payment/Subscription/BillingEvent/Entitlement/Provider` 五方可核对、可观测报警、待人工复核队列；Provider 无法确认时严禁自行授予或移除权益。
**验收**：至少 18 个确定性 RED→GREEN 场景，含数据库重启和 worker 中断恢复；一致性断言 `provider_truth ↔ ledger ↔ entitlement`；冲突必须最终 `SETTLED` 或保留可追溯 `REQUIRES_REVIEW`，无 silent drop，重复不会多计费；捕获原始 HTTP、DB 前后快照、执行日志。实际 Dodo Provider E2E 未完成不得 `PRODUCTION_VERIFIED`。

## 四、P0.2 — 真实退款/争议账本（V25-34 增量）
**实现**：基于当前实际 Dodo SDK 版本支持的 `refund.succeeded/refund.failed` 事件契约，明确定义退款 ID、支付 ID、金额、币种、状态、原付款归属、部分退款累积与权益规则；授权准入阻断与历史退款处理分离。不得把取消订阅等同于退款。
**验收**：至少 12 个负例，包括退款失败后成功、成功后失败、重复、乱序、多次部分退款、全额、金额超过实收、币种错误、跨组织、失效用户、无对应支付、收件箱故障；`sum(successful_refunds) ≤ captured_amount`，账本净额不负值，权益依据明确规则不被随意撤销。人工生成签名仅计本地；真实 Provider refund delivery 另列 `BLOCKED`。

## 五、P0.3 — IM/Socket/AI 全出口隐私闭环（V25-09 / V25-10，D6）
**实现**：追踪 `/api/im/send` → DB → Pusher/Socket → Push/preview → client cache → bot/AI inference → history/export/forward 的每一条媒体数据出口。对每个动作和接收者在执行点校验权限及撤销有效性。不要用媒体 `msgType`、MIME 或 data-url 嗅探单独替代强类型上传资产/服务端授权。接收者已取得的本地副本不可能被承诺远程删除。
**验收**：两账号、三设备/浏览器上下文测试：授权、撤销、过期、角色移除、跨租户、跨会话、客户端伪造、回放/缓存命中、bot 自动回复、AI 摘要、socket 向未授权订阅者、通知预览与日志脱敏。拒绝路径需证明 HTTP/DB/Socket/模型请求/日志新增未授权披露 0；输出每一出口的 evidence map；未验证出口保持 FAIL/NOT_TESTED，不得说“媒体全路径已安全”。

## 六、P0.4 — 双账号真实通信最小纵向闭环（V25-05 / 07 / 08）
**实现**：复用现有 IM、认证和消息状态系统。建立至少两个相互独立的测试账号及浏览器上下文，跨账号建立/使用真实会话，发送 TEXT、合法授权 IMAGE/VOICE，完整接收/已读/拒绝和离线补拉。不可用的 Pusher/Socket 环境可以建立本地受控运行时，保留生产 `NOT_TESTED`。
**验收**：≥20 条双向实际 API 消息；≥50 次随机网络扰动（断线、重复、延迟、乱序、刷新、重新登录）；客户端发件 ID + 服务端消息 ID + DB 行 + 接收端已读/已送达的区别可追溯；0 多余重复入库，0 跨会话泄漏，失败后不能虚报送达。自生成 mock 收件不算真实跨账号 E2E。

## 七、P0.5 — 社交 AI 用户价值闭环（V25-13 /14 /19）
**唯一试点流程**：A 撰写中文 → 私人 AI 提供英文翻译/语气建议（明确来源与不确定性）→ A 编辑或拒绝 → A 明确点发送 → B 在另一个会话上下文收到真实消息。加入 AI 误译提醒、语境不充分时澄清与禁用云端处理选项。
**验收**：至少 150 条冻结中英与社交语境测试集，报告：意图/翻译质量、事实篡改、误认人称、敏感数据外传、延迟、每有效建议成本；以人工审核基线对照，真实用户定性验证（不是 LLM 自评分）。所有自动发消息 0；无合法远程处理授权时远端模型调用 0；输入数据域、模型 ID、最终草稿、用户确认和实际消息 ID 可追溯。

## 八、P0.6 — 独立评审、发布治理与合规（V25-31 /32 /39 /40）
**执行**：从独立代码审查者（Codex 独立运行或不同组织授权 reviewer）重跑关键安全/账本测试；检查主仓 GitHub rulesets 和 required checks；检视源仓 AGPLv3、SBOM 与商业依赖许可。建立单独商户适用性状态：Dodo 公开政策当前限制社交匹配与实时人际交互产品（官方 Merchant Acceptance Policy），向其合规部门完整披露 Personal/Business/Community 业务并获取书面结论，未批不得真实收费。
**验收**：源 SHA、reviewer、test suite SHA、原始运行日志、负例逐条签名；`main.protected=true` 且强制检查实际阻止未经审核合并；未设置完成保持 BLOCKED。生产需要严格的 Owner 授权与准确部署 ID、数据库迁移、roll-forward 安全方案和上线后验收。

## 九、P1 可并行、不阻塞当前 Alpha：开源、自托管与性能（V25-29/30/35/36）
- Community Edition 在两套干净环境通过“账号→真实聊天→本地模型 AI”演练，不依赖 LokFeel Cloud 商业密钥；报告当前 AGPLv3 许可证义务。
- Personal/Business 界面与数据隔离真实 E2E，至少 7 档视口，无高危可访问性违规。
- 旧 9 页性能 G15 按原节流档复验：所有目标页 TBT≤200ms，LCP≤2500ms，CLS≤0.1；MISS 不可修改阈值或者只跑最快页。

## 十、执行次序、工具和停机线
**立即并行**：P0.0（安全候选）/ P0.1（Durable Inbox）/ P0.3（媒体出口全路径）/ P0.4（两个账号真实通信）；P0.2 接 P0.1，P0.5 接 P0.3+P0.4，P0.6 全程独立。
**工具**：现有 Prisma/libSQL、Jest、tsx、真实 Next.js HTTP Harness；Playwright（两 Context）、Socket/Pusher 本地适配器、promptfoo（仅在许可评测数据）、GitHub Actions、Gitleaks、Syft、Lighthouse CI、Codex 独立审查、Dodo 官方 Test Mode（授权后）。先核实是否已装，未装记录并使用安全等效路径。
**禁止**：不允许盲目调用真实支付、泄露密钥、越权读取私聊、不经 Owner 批准在生产更改或对外发送。不能以“需要生产权限”停止本地状态机、单测、集成测试及回滚候选制作。

## 十一、统一机器验收字段
`TASK_ID / PARENT_ID / OWNER / BASE_SHA / RESULT_SHA / ENV / PROVIDER_MODE / CHANGED_FILES / TEST_COMMANDS / EXIT_CODES / NEGATIVE_CONTROLS / REAL_HTTP / DB_BEFORE_AFTER / PROVIDER_RECEIPT / SECURITY_DIFF / INDEPENDENT_REVIEWER / PREVIEW_DEPLOY_ID / PROD_DEPLOY_ID / STATE / BLOCKERS / NEXT_EXECUTABLE_ACTION`。

准入矩阵：工程脚本 PASS ≠ 真实业务 PASS；进程内 Handler ≠ HTTP；测试 HMAC ≠ Dodo 外部 delivery；Provider 最终确认 ≠ Model 自评；本地通过 ≠ 生产通过。任一相关强制安全门失败，发布裁决 NO_GO。

## 十二、WorkBuddy 下轮汇报须回答的五个结果问题
1. R-15 冲突是否最终达到 `SETTLED` 或持久 `REQUIRES_REVIEW`？是否有真实 Provider 证据？
2. 退款是否完整覆盖独立事件与权益策略？
3. Socket、AI、预览和日志是否仍存在新的未授权媒体披露？
4. 两个账号能否在两端真实完成消息与一次私有 AI 辅助流程？
5. 未批准收费是否在生产真正阻断？哪一个明确授权仍待 Owner？
