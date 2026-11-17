# LOKFEEL V25.2｜下一批执行总令：生产止损 → Consent 完整安全 → 双人真实聊天 → AI 私人辅助

> 生成基线：用户 2026-11-17 最新 WorkBuddy V25.1 报告（属于报告事实，并非本文件独立复跑）；通过 GitHub 连接器确认远端 main `cad717e92542395e4346e49d388f09be78ec1557`，`protected=false`。开工时必须重新只读核实所有 SHA 和生产行为。
> 唯一目标：面向 Personal 与 Business 的开源生成式 AI 社交平台。不能把 Mission、测试数量、内部 Agent run 或静态页面当作真实通信与关系价值。
> 发布纪律：本令不是推送、生产数据库变更、真实支付或真实消息发送的授权。

## 0. 首先作出严格的状态裁决

- `V25-09` 已被 WorkBuddy 报告为 `LOCAL_TESTED`：Jest 11/11、总 Jest 2937/2937、tsc/build 通过；仅有**无授权 IMAGE 的登录态 HTTP 403 + 记录数 2→2** 实证。已授权正例、VOICE、撤销、过期、重放、双设备浏览器、安全独立评审尚不足，**不得签 COMPLETE**。
- `V25-10` 为 `DISCOVERY`：媒体当前为内联 base64 的 `payload`，而不是独立媒体 URL；这意味着读取与转发的访问控制、日志泄漏、超大 payload 和撤销时既有副本不可回收是重点，不能以“没有 URL”认定安全。
- `V25-01/33`：WorkBuddy 报告生产 `b50e53e`、`/pricing` 显示未经批准的 $89/$199/$449、plans `checkoutReady:true`、`live_mode`。没有证据证明已发生真实扣款，但**商业门未获批准仍允许新结账**需要立即止损。
- 远端 main `cad717e` 且 GitHub 分支 `protected=false`（本轮已用 GitHub connector 查询）。本地代码 SHA、Preview、产线部署 ID 均不可从历史数据猜测。

## 1. 任务优先级与交付验收（顺序为依赖关系而非固定工期）

### P0-SAFE-01｜`V25-01 + V25-33` 商业止损独立轨（Release/Security + Billing）
**动作**：重新 GET `/api/health`、`/pricing`、`/api/payments/dodo/plans`，保留 `builtAt`, `commit`, config, `checkoutReady`, 金额、审批引用、响应哈希和时间。**从当前生产祖先分支切最小 Hotfix**，只修 SSR/JSON/实际创建 Checkout 的服务器授权：无有效 Owner `approvalRef` 时三层均关闭。避免把 7 个本地未发布功能一起上线。建立 Preview 与回滚，包括“回滚旧版不会重新打开结账”的防护。不能把取消 API Key 作为唯一理想方案（它可能影响现有 Webhook 或续订）。
**验收**：未审批时 `/pricing`、产品目录 JSON 无可购买价格与按钮；带真实登录身份新建 checkout 被明确拒绝且 Provider 无新 checkout ID；已有订阅管理、合法 Webhook 不受损；Dodo 沙箱独立通过有效授权下正例。`NO_GO` 到 `SAFE_FOR_HOTFIX_APPROVAL` 后交 Owner 针对 SHA 明确授权；未经授权不写生产。
**反向样本**：匿名、OWNER、非 OWNER、旧 Token、非法 approvalRef、目录自填 APPROVED、缓存滞留 HTML/JSON、失败→成功 Webhook、重复事件。
**工具**：GitHub/PR、Playwright、Netlify Preview（有权限）、Dodo 沙箱、Prisma、`check:pricing`、Jest。

### P0-SEC-02｜`V25-09` 媒体 Consent 第二轮闭环（IM Security）
**动作**：审查守卫调用顺序、消息幂等返回路径、`TEXT` 伪装媒体、`IMAGE/VOICE` payload 类型和长度、接收者授权方向、会话 ID 绑定、撤销/到期/权限降级竞态；按真实 API 以 A/B 两账号建立合法 ConsentGrant，发送 IMAGE 和 VOICE 并能成功到达，再撤销、重试和降级断言拒绝。校验事务与 Pusher/bot 零写/零推送，包含 DB 异常 fail-closed。
**验收**：每一媒体类型 `无授权403→合法授权2xx→撤销后403→过期403→低档403` 真 HTTP；双方数据库消息 ID/seq 对齐；并发10次、重试/旧幂等键、反向授权、跨会话授权均不能形成一次违规发送。独立 Reviewer 重新运行负例。**已有发送的媒体不能通过撤销神奇收回设备已保存的副本**，只保证未来受控访问/分享遵循新策略。
**额外硬门**：拒绝响应不得把已撤销权限的媒体 payload 透给提交者；历史消息查询也按 V25-10 政策处理。
**工具**：现有 `/api/im/send`、`ConsentGrant`、Prisma/Jest、Playwright、双测试用户、Toxiproxy/Playwright 网络模拟。

### P0-SEC-03｜`V25-10` 查看、转发、缓存和导出策略（Privacy + IM）
**动作**：建立授权决策表，区分发送、接收、查看历史、转发、下载、导出、引用、AI 摘要和被踢出群后访问；记录何时只检查发送前的同意，何时需要每次读取时复核。媒体当前以 base64 内联存储，需检查响应体、缓存、日志、备份和消息通知是否暴露私密内容。默认拒绝新分享/转发；设计必要的迁移方案，不擅自改旧用户历史权益。
**验收**：每种路径有 permission decision + 真 HTTP 负例；撤销后未授权的新读取和转发拒绝；跨用户/租户 0 访问成功；服务端日志和 HAR 无媒体原文/令牌；必要时迁移到受控存储，迁移需独立批准。对已经送达并留在接收方设备的数据，明确技术不可回收边界。
**工具**：Prisma、API 契约扫描、Playwright/HAR 脱敏、安全威胁建模、gitleaks。

### P0-IM-04｜`V25-05 + V25-07 + V25-08` 真人双端 IM 主链（IM + Frontend）
**动作**：复用现有 IM、Auth、Pusher，不重写协议。用两个真实隔离测试账号（非 AI 虚构真人）和两个浏览器上下文完成文本、图片、语音、已读、重连、刷新、乱序、重试、消息撤销/删除（若已有能力）及会话成员校验。
**验收**：最少20个正常往返消息和50次含断网、重复请求、延迟和乱序的扰动；无重复、越权、假送达；服务端 seq 与两端消息列表一致；错误不能显示成功勾。网络恢复后最终一致；已有媒体必须通过 P0-SEC-02/03 门。所有 API 和显示截图绑定候选 SHA。
**工具**：Playwright 2 contexts、Prisma、Jest、network simulation、现有 IM/Pusher。

### P0-AI-05｜`V25-13 + V25-14 + V25-19` 私人 AI 沟通原型（AI Product + QA）
**动作**：只围绕三项高频动作：跨语言翻译、发出前表达建议、双方确认的约定提取。定义 `human`, `ai_suggestion`, `ai_translation`, `ai_summary` 类型与 UI 来源标签，**草稿默认不发送**。跨模型调用前检查是否允许发送具体聊天上下文；未授权远程推理必须拒绝或转本地方案。情感解释仅为可能性与建议，禁止断言对方心态。
**验收**：至少150条封存双语/多文化样本（初始评测目标）覆盖转折、否定、反语、伤害性表达、隐私越权和翻译歧义；与无 AI 基线对照记录准确率/误发率/人工修正；20次 UI 草稿预览及取消零真实发送；AI 内容绝不伪装本人原文。无可用模型时诚实显示不可用，不造假模型成功。
**工具**：现有 WorkBuddy provider、promptfoo、Playwright、人工标注评测、Zod。

### P0-DATA-06｜`V25-11 + V25-12 + V25-15 + V25-16` 关系记忆与分域（Privacy/Data）
**动作**：数据区分 `private_user`、`shared_pair`、`group`、`organization`、`research_opt_in`；事实、模型推测、双方共同确认分别记录；为每条记忆存来源、授权版本、可见者、失效、撤回、加密/密钥方案。个人和企业域物理/逻辑隔离，不因组织管理员身份读取成员私密域。
**验收**：跨域读/写/检索、prompt 注入跨域提取、用户撤回、成员退出、删除/更正、数据导出负例全部通过；撤回后新模型请求不能再读取撤回内容；任何数据研究默认 opt-out。若数据已进入模型权重，不得承诺即时彻底遗忘。
**工具**：Prisma、权限测试、KMS/密钥策略审查、promptfoo、OpenTelemetry。

### P0-OPEN-07｜`V25-29 + V25-30` AGPL 开源自托管发行（OSS + Legal + DevOps）
**动作**：基于当前仓库 `LICENSE=AGPLv3` 梳理已有代码版权与第三方依赖许可；形成 License RFC 而非擅自替换 Apache；生成 SBOM；最小 Community Edition 可独立部署、聊天并接本地模型。明确需要移除/替换哪些商业密钥硬依赖。
**验收**：两套干净的隔离环境从固定 SHA、README、compose 执行安装，**不使用 LokFeel 云密钥**完成真实双账号聊天 + 本地 AI 最小请求；输出安装日志、耗时、资源、退出码；依赖许可和高危漏洞有审查结果。法律许可策略由 Owner/律师批复，不得自动修改许可证。
**工具**：`check:selfhost`, `audit:open-source`, Docker Compose、Syft、OpenSSF Scorecard、llama.cpp。

### P0-RELEASE-08｜`V25-31 + V25-32 + V25-39` 安全/独立验证/分支保护（Security + independent QA）
**动作**：真实设置 GitHub rulesets（当前 protected=false），锁定 required checks、review、Preview、禁止直推 main 和未经审核部署；对 IM、记忆、Agent、Billing 做 OWASP ASVS、prompt injection、泄密和权限攻防。单独 Reviewer 不能复用开发 Agent 的测试结论。
**验收**：受保护 main 拒绝无 review 的合并/直接推送（使用不影响生产的安全验证路径）；全部 required jobs 实际显示 PASS；0 未授权真人消息外发、0 跨租户私密泄漏、0 真实凭据；审查记录含 reviewer identity、SHA、原始命令和结果。
**工具**：GitHub connector、Actions、gitleaks、Syft、Playwright、promptfoo、OWASP ASVS。

### P0-UX-09｜`V25-35 + V25-36` Personal/Business 体验与性能（UX + Frontend）
**动作**：Personal：Chats / People / Spaces / My AI；Business：Spaces / Members / Connections / Agents / Insights。个人与企业必须有独立且清晰的主导航，但复用底层 API。去除无价值的 Mission/Studio/REST/Token 首屏广告。统一语言和品牌。重新采样原9页的 Chrome Trace，不降阈值。
**验收**：7个视口 x 关键状态无横向溢出，键盘/屏读/200% 缩放可用，axe 严重违规 0；9/9 TBT≤200ms、LCP≤2.5s、CLS≤0.1；10名真实目标用户≥8人在5秒内指出主要动作，≥8人在90秒内完成目标操作；证据包含截图、录屏和 trace。
**工具**：Figma（授权后）、Playwright、axe-core、Lighthouse CI、React DevTools profiler。

### P0-SHIP-10｜`V25-34 + V25-40` Billing 对账与发布控制（Release + Billing）
**动作**：以新的候选 SHA 做真实沙箱投递、账本、Entitlement 对账；Prisma 迁移在数据库副本演练；构建不可变候选 Preview、真实 Netlify deploy ID、回滚目标，避免恢复旧版又打开未经批准结账。发布必须由 Owner 针对明确 SHA 授权。
**验收**：Dodo 沙箱事件、Webhook、账本、权益四方一致；失败→成功、重复/乱序、退款等负例；热修复可单独审批，正式版全部适用门禁 PASS；生产回读 commit/付款门/双人消息与授权；48小时只读巡检有完整日志，不以健康 200 作为上线 PASS。
**工具**：Dodo test mode、Netlify、GitHub Actions、Prisma、Playwright、现有 billing reconcile scripts。

## 2. 并行执行图

- 轨 A（立刻）：SAFE-01 Hotfix 准备 + 审批（**不得部署**，除非 Owner 明确授权）。
- 轨 B（立刻）：SEC-02 → SEC-03 → IM-04，媒体同意覆盖完再开启该媒体功能试点。
- 轨 C（立刻）：AI-05 的无私人数据评测与适配契约；后续与 DATA-06 集成。
- 轨 D（立刻）：OPEN-07 与 RELEASE-08 的不需生产写入部分、UX-09 的审计和修复。
- 最后：SHIP-10 统一集成；P1 Enterprise Spaces、Matrix/MCP/A2A、Sparse MoE 在 P0 安全后推进，不得占用 P0 隐私与通信的门禁资源。

## 3. 每任务验收字段（严格逐卡填写）

`task_id, owner, base_sha, code_sha, branch, changed_files, affected_routes, consent_policy_version, requirement, red_test, green_test, negative_test, real_http_browser_evidence, database_before_after, tool_version, command, exit_code, independent_reviewer, preview_sha, production_sha, verdict, next_action`

状态 `DISCOVERY → CODE_COMPLETE → LOCAL_TESTED → INDEPENDENTLY_VERIFIED → PREVIEW_VERIFIED → PRODUCTION_VERIFIED`。发现 BLOCKER 时只阻塞相关动作，其他无授权依赖开发继续。不允许把技术 `CODE_COMPLETE` 计为产品可用。

## 4. Owner 只需集中批准的边界

1. **U-1 P0 紧急止损**：最小商业门 Hotfix 的唯一 SHA、预览结果、部署和回滚权限；现有订阅/Webhook 的影响必须解释。若只能选无代码手段，需要评估密钥摘除/渠道禁售的副作用，不得未经授权操作。
2. U-2 产品定位与发布文案；U-3 首试点场景；U-4 许可证/版权；U-5 第三方模型和真实外部消息发送；U-6 GitHub/Netlify 管理权；U-7 真人账号、试点与组织测试；U-8 独立代码评审/生产发布。

无许可/工具/授权条件的代码审计、单测、模拟网络扰动（仅 QA）和技术设计应当自行推进，不能重复要求 Owner 逐张卡允许开发。

## 5. 不可妥协的发布硬门

- `S0` 生产未经批准的新付款入口关闭且生产实测；`S1` IM 媒体写、读、转发、撤回零越权；`S2` 双真实账号两端消息回执；`S3` 私人 AI 永不未授权外发；`S4` Personal/Business Vault 跨域零泄漏；`S5` Community Edition 真自托管；`S6` 独立安全审计；`S7` 性能可访问性通过；`S8` 真实用户研究；`S9` PR/CI、migration、deploy/rollback/G13 完整通过。任何强制门 `BLOCKED/PARTIAL/NOT_TESTED/FAIL` 均 NO-GO。
