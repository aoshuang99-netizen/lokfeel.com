# V25.6-GA｜核心文案与微交互（中英完整配对；必须以真实功能门禁发布）

> 规则：官网使用单一语言；语种切换不影响现有消息/草稿状态。不允许一页同时出现中英主操作、研发术语或未经证实的能力承诺。

## 首页（根据真实能力状态二选一）

**A. 已接真实模型、独立验收通过后可使用**
- EN H1: **Say it better. Connect for real.**
- EN Sub: **AI helps you find the right words across languages and conversations. You review every suggestion. You decide what to send.**
- EN CTA: **Start a conversation** → 实际 Chats 入口。
- EN Secondary: **See how privacy works** → 权限说明（必须有实际控制入口）。
- ZH H1: **更好地表达，真实地连接。**
- ZH Sub: **让 AI 帮你跨语言沟通、理清想法。建议先由你确认，是否发送由你决定。**
- ZH CTA: **开始一段对话**。
- ZH Secondary: **了解隐私与控制权**。
- Truth line (EN): **Your chats stay private. Cloud AI only processes what you explicitly allow.** （必须逐项核对真实架构；如无法证明“私人聊天”全部隐私属性，改成更具体的“AI processes only the text you choose to share.”）

**B. 真实模型尚未可用的安全版（当前更接近此状态）**
- EN H1: **Conversations belong to people.**
- EN Sub: **Talk to real people and stay in control of what you share. AI writing assistance is being tested privately.**
- EN CTA: **Open my chats**（已登录） / **Create an account**（未登录）
- ZH H1: **真实沟通，由你掌控。**
- ZH Sub: **与真实的人交流，自主决定分享什么。AI 表达辅助正在私人测试中。**
- ZH CTA: **打开聊天** / **创建账号**。
- 不能把候选型 A 文案提前发布作为已经可用的承诺。

## 登录及注册
- EN Login: **Good to have you back. Continue your conversations.**
- ZH Login: **欢迎回来，继续你的对话。**
- EN Register: **Start with a conversation, not a setup wizard.**
- ZH Register: **从沟通开始，不必先配置复杂工具。**
- Primary action after auth: **Go to chats / 进入聊天**，保留经过严格校验的本域 `callbackUrl`。

## 聊天与 AI
| State/Action | EN | ZH | 行为 |
|---|---|---|---|
| Chat empty | No conversation yet. Invite someone you know. | 还没有对话，邀请一位你认识的人开始。 | 打开真实邀请流程，非虚构好友 |
| Composer placeholder | Write a message… | 输入消息… | 本地草稿，默认不外发 |
| AI control | Help me say this | 帮我表达 | 只有真模型 ready 才可用 |
| AI processing scope | Only this draft will be processed | 仅处理这段草稿 | 默认，不暗中整段读取历史 |
| Consent | Allow cloud AI for this draft | 允许云端 AI 处理本次草稿 | 服务端签发和核验的同意记录 |
| AI working | Working on your suggestion… | 正在生成建议… | 真实请求 ID，可取消 |
| AI ready | Here's a suggestion. You decide. | 这是表达建议，是否采用由你决定。 | Original/Suggested diff |
| Apply draft | Use suggestion | 使用建议 | 只替换 composer，不调用 send |
| Discard | Keep my original | 保留原文 | 不改原文、不入库为聊天消息 |
| Send | Send message | 发送消息 | 用户点击，后端鉴权真实发送 |
| Sending | Sending… | 正在发送… | 不显示已送达 |
| Sent | Sent | 已发送 | 服务端持久成功 |
| Delivered | Delivered | 已送达 | 必须有接收端确认 |
| Read | Read | 已读 | 必须有接收方阅读事件 |
| Retry | Couldn't send. Try again. | 发送未成功，请重试。 | 同一幂等键，保留草稿 |
| AI unavailable | AI writing isn't available right now. You can still chat. | AI 表达辅助暂不可用，你仍可以正常聊天。 | 0 Stub，0无凭据远程调用 |
| AI revoked | You've revoked AI access for this draft. | 你已撤回对本次草稿的 AI 授权。 | 撤回后新请求拒绝 |
| Media denied | This media is no longer available to you. | 你已无权查看该媒体内容。 | 不传回 base64 原文 |

## 个人关系与隐私
- EN People: **People you chose to connect with** / ZH: **与你建立连接的人**。
- EN Privacy: **What your AI can use is up to you.** / ZH: **AI 可以使用哪些信息，由你决定。**
- EN No memory: **No saved memories yet.** / ZH: **暂时没有保存的记忆。**
- EN Delete: **Remove this memory** / ZH: **删除这条记忆**。
- EN Revoke: **Stop using this for AI** / ZH: **停止将此信息用于 AI**（不能承诺已训练模型权重可即刻“遗忘”）。

## Business
- EN H1: **Bring people and AI together—without losing control.**
- EN Sub: **Help your team connect, communicate across languages, and act on what needs attention. Personal memories stay outside organizational access.**
- ZH H1: **让团队协作更顺畅，让每个人保留控制权。**
- ZH Sub: **帮助团队成员跨语言沟通、建立可信连接、处理待办；成员的私人记忆不属于组织。**
- Primary KPI labels: **Waiting for my decision / 待我确认**; **Ready to introduce / 可以发起介绍**; **Needs follow-up / 需要跟进**。
- Empty: **No one needs your attention right now. Invite a member or start a conversation.** / **目前没有需要你处理的事项。可以邀请成员或开始一段沟通。**
- Failure: **We couldn't load your organization's data. Try again.** / **组织数据加载失败，请重试。** 绝不能把请求失败渲染为 0。

## Developer
- EN: **Run private AI-powered conversations on infrastructure you control.**
- ZH: **在自主掌控的基础设施上运行 AI 社交。**
- 只有 2/2 真正干净安装通过，才显示 `Self-host now / 立即自托管`；否则显示源代码与当前限制。

## 动态文案契约
`copyKey, locale, capabilityFlag, proofLevel, primaryRoute, consentRequirement, fallbackCopy`。使用 CI 扫描所有用户面对的文本是否含 `WorkspaceSpec/INTENT_EXTRACTION/Token/Mission pipeline`、旧 `LokFee!`、未批价格、未经证实的 `Verified`、空白 `undefined/null`。技术术语只可出现在 Debug/Developer/Advanced，不可污染用户默认入口。
