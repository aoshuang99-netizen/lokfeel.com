# UX01 — 三类核心人群 Value Contract（草案，待 Owner 签署）V25.6

> 状态：**DRAFT — 待独立 Product Owner 签署**。本轮由工程侧据作战包 §2 模板起草，
> 不冒充"已批准"。未签署前，相关功能不得标"产品可用"（作战包 G00 规则）。

每条合同逐项回答：USER_ROLE / TRIGGER / ORIGINAL_JOB / BASELINE_PAIN / FIRST_ACTION /
AI_ADDED_VALUE / PRIVACY_SCOPE / HUMAN_CONTROL / VISIBLE_OUTCOME / BACKEND_PROOF /
COUNTEREXAMPLE / MEASUREMENT / STATUS。

---

## VC-PERSONAL — 跨语言/重要关系沟通

- **USER_ROLE**：需要给真人写一条跨语言或措辞敏感消息、但不放心直接复制给通用 AI 的人。
- **TRIGGER**：在真实聊天里要给某人发一条拿不准的消息。
- **ORIGINAL_JOB**：离开 App、把内容贴到别的 AI、再复制回来；担心隐私外泄。
- **BASELINE_PAIN**：来回切换；措辞不当；不知道 AI 看了什么、有没有替自己发送。
- **FIRST_ACTION**：打开真实会话 → 输入想说的话 → 点"帮我表达/翻译"。
- **AI_ADDED_VALUE**：忠实翻译/润色，说明处理位置与不确定性；不推断对方内心、不替用户决定关系。
- **PRIVACY_SCOPE**：默认仅本地；任何云端处理须服务端签发、用途/会话/接收范围绑定、可即时撤销的授权。
- **HUMAN_CONTROL**：草稿可编辑/对比/拒绝；只有用户确认才发送；撤销后不再新读取/推理。
- **VISIBLE_OUTCOME**：草稿来源与处理范围标注；真实 sent/delivered/read 状态（非定时器伪造）。
- **BACKEND_PROOF**：本轮 `UX06` 已交付服务端授权门（`AIProcessingConsent` + `/api/im/ai-consent` + ai-assist 查库校验），单测 43/43、隔离库证明 9/9 PASS；**真实模型翻译未测**（本地无云凭据）。
- **COUNTEREXAMPLE**：客户端伪造 consentRef → 403；撤销后重放 → 403；local 授权 + 云开关误开 → 403。均已测。
- **MEASUREMENT**：90s 生成有用草稿、180s 真发送（≥8/10）——**NOT_TESTED**（无真人）。
- **STATUS**：后端授权门 CODE_COMPLETE/LOCAL_TESTED；完整用户价值 HUMAN_VALIDATION PENDING。

## VC-BUSINESS — 组织内可信协作

- **USER_ROLE**：企业管理员与成员，在组织 Space 里借助 AI 协作。
- **TRIGGER**：跨语言团队要对齐一件事；成员要把组织知识用于沟通。
- **ORIGINAL_JOB**：群里反复解释；管理员无法既用 AI 又不越权看私人笔记。
- **BASELINE_PAIN**：组织与个人数据混在一起；AI 以真人身份发言；越权读取难审计。
- **FIRST_ACTION**：进组织 Space → 邀请真实成员 → 指定授权来源 → 人工介入一次协作。
- **AI_ADDED_VALUE**：在权限边界内帮助成员理解彼此；AI 身份可见。
- **PRIVACY_SCOPE**：组织与个人 Vault 严格分离；管理员不可访问私人记忆。
- **HUMAN_CONTROL**：成员可拒绝 AI 建议；来源标注公开/私有/组织。
- **VISIBLE_OUTCOME**：一次真实协作记录；跨界访问为 0。
- **BACKEND_PROOF**：未做（UX11 BLOCKED）。
- **COUNTEREXAMPLE**：两组织跨界读取/AI 搜索/推送 = 0 —— 未测。
- **MEASUREMENT**：2 组织 3 用户真实浏览器操作 —— NOT_TESTED。
- **STATUS**：NOT_TESTED。

## VC-BUILDER — 自托管可运行

- **USER_ROLE**：没有 LokFeel Cloud 密钥的开发者。
- **TRIGGER**：想自行部署并验证平台确实能双人通信。
- **ORIGINAL_JOB**：读宣传页后无法判断能否真跑。
- **BASELINE_PAIN**：只有开源介绍、没有可运行发行版。
- **FIRST_ACTION**：按 Get Started 在干净环境安装 → 两账号通信 → 本地模型生成草稿。
- **AI_ADDED_VALUE**：模型适配器可替换，私有协议仍验证授权与历史。
- **PRIVACY_SCOPE**：全程不依赖商业云。
- **HUMAN_CONTROL**：用户掌控本地模型与数据。
- **VISIBLE_OUTCOME**：两套干净环境复现成功。
- **BACKEND_PROOF**：未做（UX12 BLOCKED）。
- **COUNTEREXAMPLE**：持有云密钥才能跑 —— 未测。
- **MEASUREMENT**：fresh-install logs + license/SBOM —— NOT_TESTED。
- **STATUS**：NOT_TESTED。

---

## Owner 签署栏（留空）

- Personal VC：签署人 / 日期 / 结论（待填）
- Business VC：签署人 / 日期 / 结论（待填）
- Builder VC：签署人 / 日期 / 结论（待填）

未签署前，G00 = NOT_TESTED，整体 release 维持 NO_GO。
