# V19-05 · 品牌文案库（COPY DECK v1）

> 定位：**LokFeel — Connection OS**。核心价值：**Turn intent into coordinated action.**
> 规则：默认英文、支持中文；不夸大 AI 能力、不宣称未验证成功率、不写成交友产品、不混入 Hlua 权益；
> 每个 CTA 有真实目标；每个错误给下一步；Consent 文案写清对象/范围/后果。

## 1. 核心文案矩阵（EN / CN）

| 位置 | English | 中文 | 备注 |
|---|---|---|---|
| 首页主标题 | Turn intent into coordinated action. | 让目标成为协同行动 | |
| 首页副标题 | Describe what you want to achieve. LokFeel turns it into a structured workspace where people and agents can move work forward — with consent and measurable outcomes. | 描述你想完成的事。LokFeel 会把它变成一个结构化工作区，让成员与 Agent 在授权边界内推进工作，并留下可度量的成果。 | 中文不逐字直译，保持"授权+可度量"两根钉子 |
| 主 CTA | Create a Workspace | 创建工作区 | 目标：进入 `/workspace` 意图输入 |
| 次 CTA | See How It Works | 了解工作方式 | 目标：定位说明区（真实锚点，不是死链） |
| Intent 输入框 | What are you trying to accomplish? | 你想完成什么目标？ | |
| 输入引导 chips | Launch a beta program… / Organize customer research… | 发起一个内测计划… / 组织一次客户调研… | |
| Agent 区域 | Your agents, working with context. | 让 Agent 在任务上下文中协作 | |
| Agent 状态 · 运行 | Running · within granted scope | 执行中 · 在授权范围内 | |
| Agent 状态 · 等待 | Waiting for your consent | 等待你的授权 | |
| Consent 标题 | You control what gets shared and executed. | 共享什么、执行什么，由你决定。 | |
| Consent · 范围 | send_message × 10 — connections you approved · read: your name, workspace title · never: payment info, private files, contacts export | 向你批准的 10 位联系人发送消息 · 读取：你的名字、工作区标题 · 绝不触碰：支付信息、私密文件、通讯录导出 | 对象/范围/后果三要素 |
| Consent · 后果 | Approving applies to this mission only. You can revoke at any time — revoking stops messages that have not been sent yet. | 本次授权仅适用于这个任务，可随时撤销；撤销会叫停尚未发出的消息。 | |
| Consent · 批准/拒绝 | Approve for this mission / Reject | 批准（仅此任务） / 拒绝 | |
| Outcomes | See what actually moved forward. | 看见真实进展与成果 | |
| Outcome · 证据不足 | 4 responses lack quoting consent — shown as counts only. | 4 条回复未获引用授权——仅显示数量。 | 不编置信度 |
| Outcome · 未执行 | No progress recorded — the agent has not acted. | 尚无进展记录——Agent 未执行任何动作。 | 拒绝假成功 |
| Console | Coordinate people, agents, and outcomes. | 统一管理人员、Agent 与成果 | |
| Loading | Compiling your intent… / Fetching workspace… | 正在解析目标… / 正在读取工作区… | 与真实后端阶段对应 |
| Empty · Workspace | No workspaces yet. Create your first one from a single sentence. | 还没有工作区。用一句话创建第一个。 | 空态给下一步 |
| Error · 网络 | Couldn't reach LokFeel. Check your connection and retry. | 无法连接 LokFeel。请检查网络后重试。 | Retry 按钮 |
| 权限拒绝 | You don't have permission for this. Ask an owner to approve it. | 你没有相应权限，请联系所有者授权。 | 说明"谁能批" |
| 订阅 · 支付关闭 | Payments aren't enabled yet. This beta is free — pricing will be announced later. | 支付尚未开通。当前为免费测试阶段，定价稍后公布。 | 与 503+`PAYMENT_NOT_CONFIGURED` 一致 |
| 邀请邮件 | You've been invited to a LokFeel workspace. Accept to start coordinating. | 你收到一份 LokFeel 工作区邀请，接受后即可开始协作。 | |

## 2. 统一术语表（防止混用）

| 术语 | 定义 | 禁止用法 |
|---|---|---|
| **Workspace** | 从一个意图编译出的协作容器（含 Spec/Missions） | 不叫"项目/房间/chat room" |
| **Mission** | Workspace 内一个可执行、可验收的单元 | 不与 Task 混用 |
| **Agent** | 在授权范围内代表用户行动的执行者 | 不称"机器人/助手/AI 女友" |
| **Consent** | 按字段、可撤销的授权门 | 不叫"权限设置" |
| **Outcome** | 有证据链的真实结果记录 | 不叫"成就/奖励" |
| **Connection OS** | 产品定位总称 | 不与 Hlua Pass / 会员权益混排 |

## 3. 文案审查清单（每条上线前过一遍）

- [ ] 描述的是**真实存在**的能力（可指出路由/API）
- [ ] 没有成功率/收益承诺
- [ ] CTA 点击后有真实目标（`check-ui-invariants` R1 覆盖按钮接线）
- [ ] 错误文案给出下一步
- [ ] Consent 三要素齐全
- [ ] 中文与英文按钮长度可共存（按钮不换行溢出，390px 实测）

## 5. 落地处置表（2026-10-23，方案 C 选型通过后）

> 原则：**逐条对照真实代码，不是照抄任务书**。每条给出处置与证据；改了的写 commit，不改的写理由。

| §1 行 | 处置 | 依据 |
|---|---|---|
| 首页主标题 | **保留现有**（"Describe the outcome. Get a workspace that runs it."） | 现有标题已通过 02 审计（Connection OS 表达），且比候选更具体；"Turn intent…" 作为品牌句保留在 meta/命名层 |
| 首页副标题 | 保留现有 | 现文案已含"consent + missions + agents"三钉子 |
| 主 CTA | 保留（"Open your workspace" → `openWorkspace`） | 真实目标已存在；"Create a Workspace" 语义重复 |
| 次 CTA | 保留（"Create an account" → signup） | 注册是公开面真实转化路径 |
| Intent 输入框 | ✅ **已改**（`living-workspace.tsx` composer 占位符 → 「你想完成什么目标？例如：…」） | 与候选中文一致，保留示例值；无测试断言旧文案 |
| Agent 状态·运行/等待 | ⬜ 第三轮对照 `agent-board.tsx` 逐态改 | 需先核对真实事件名（不许文案先于行为） |
| Consent 三条 | ⬜ 第三轮对照 `consent-gate.tsx`（**服务端逻辑零改动**，只动字符串） | Consent 是红线区，改动必须逐条过审查清单 |
| Outcomes / 证据不足 | ⬜ 第三轮对照 `outcome-observatory.tsx` | 同上 |
| Error · 网络 / Loading | ⬜ 第三轮统一（含 Toast 收敛，见 `06` §4） | 与 `--lf-*` 语义色一起做 |
| 空态 | 保留 | `living-states.tsx` 的"未接通清单"已是诚实空态范本 |
| 订阅·支付关闭 | 保留现状 | 生产口径 = 503 + `PAYMENT_NOT_CONFIGURED`，前端文案已一致；改文案不改变 503 事实 |

**首页 demo 组件**（`(public)/page.tsx` 内的浏览器端演示）不属于本轮落地对象 —— 它的文案已经对齐（"demo · runs in your browser" 明示非真实执行）。
