# LOKFEEL V22 — 战略归零校正、逐页重建与发布验收总令

> 执行对象：WorkBuddy 总调度 / Product Lead / UX Director / Frontend / Backend / QA / Independent Codex Reviewer / Release Security。
>
> 2026-11-16。当前裁决：**STRATEGIC NO-GO**。本文件是整改规格，不是已经完成上线或已将第三方 Skill 安装到用户本机。
>
> 重要证据边界：LIVE = 已读取用户浏览器打开的线上页面；SCREENSHOT = 用户提供截图；SOURCE = GitHub 远端 main `cad717e` 的源码审计；REPORT = WorkBuddy 的未独立复核结论；PENDING = 未获得实际生产访问/真实用户证据。不能用 SOURCE 代替 LIVE。浏览器的其余路由必须由 WorkBuddy Playwright 真机取证。

## A. 最终裁决：不是普通 UI 整改

这次不是把暗色换浅色、把英文翻中文，也不是把 7 个页面重新画一遍。现有站点把技术栈当卖点、把团队 Agent SaaS 当一级定位、把内部执行状态当用户首屏、把 Demo 指标当可信证明，造成战略、IA、内容、交互、代码和发布同时错位。先停增量堆功能，保留已验证的后端契约，重建面向真实人类目标的表层。

**冻结使命：让 AI 承担数字复杂性，让人回归真实生命。** 一级产品为 Human Intelligence OS / ONE（ONE Goal → Verified Outcome）；LokFeel 当前应以“输入目标→必要授权→跨工具可控行动→可信证据→退出屏幕”为体验主线。个人目标优先，团队/行业关系网络为扩展场景；不把 KKmatch、OCOMX 或 Army OS 业务混成 LokFeel 首页，更不把 VEC 另建成 Agent OS。跨应用执行尚未验收的能力必须标为计划中，不能承诺已经交付。

**三条正确价值命题：** (1) 我少做了哪些繁琐步骤？(2) 什么事由 AI 做、什么事等我批准？(3) 我凭什么知道真的完成？产品卖的是时间红利和可信结果，而非 WorkflowSpec、Token、MCP、A2A、Schema 等内部机制。

## B. 根因与证据（严禁无证据报 99% 完成）

| ID | 严重程度 | 已核实事实 | 根因解释 | 裁决与动作 |
|---|---|---|---|---|
| S-01 | P0 | LIVE 首页首屏 `AI-native workspace · teams & agents`、`Turn collaboration intent into approved action and verifiable outcomes.`；SOURCE 首页头注释写 SaaS AI 生成式平台 | 从技术架构倒推价值主张，一级受众收窄为团队 | 重写定位与首屏，先卖结果再讲机制 |
| S-02 | P0 | LIVE 首页首屏出现 5 MCP tools、50 REST routes、3 agent skills、token 芯片、`INTENT_EXTRACTION` | 企业技术指标上浮为营销文案 | 技术指标下沉到开发者文档；首屏全部移除 |
| S-03 | P0 | LIVE `/workspace?view=studio`：7 个英文 nav 名与中文正文混用；Missions 显示“暂未提供” | 生产版本与 V21 本地接线不一致 | 建 Git SHA/路由/主操作差异矩阵，预览验证后发布 |
| S-04 | P0 | LIVE Studio 四段计数全部“读不到”；首屏主动作“编译工作区” | 将系统资源/报错状态置于目标之前 | 首屏先输入与“你能省什么事”；计数延迟至相关任务场景展示，失败提供恢复 |
| S-05 | P0 | LIVE 首页三条案例用 `verified` 与具体引荐数量、美元金额；页尾才标 Illustrative | 演示与结果证明视觉语义冲突 | 无真实 Event/Outcome 时隐藏数字；如需 demo 每卡同级标 `演示案例·非真实结果` |
| S-06 | P0 | SOURCE `/about` 明确 `Not a single-player tool — workspaces belong to an organization` | 原设计将团队作为一级对象，与个人优先 OS 目标冲突 | 重新审核组织模型门槛，首用可个人空间/最小对象起步；真实能力没支持则列为待开发 |
| S-07 | P1 | SOURCE `/pricing` 同页区分 B2C 老会员、Hlua Pass、Connection OS；`/contact` 存在注册地址待核实文本 | 旧产品线与新产品线混仓 | 定价、法务、客服和 sitemap 建隔离矩阵；未经批准金额绝不显示 |
| S-08 | P1 | SCREENSHOT 官网英文大字占近半屏，透视模型主导视觉；WorkSpace 为暗色密集卡片、Netlify 标识显眼 | 视觉为技术炫耀而非任务可读性服务 | 统一品牌 token、字体、密度、首屏 CTA 和响应式；禁用干扰阅读的主舞台透视动画 |
| S-09 | P0 | REPORT V21 本地 `f666564`、`dbb95a7` 实现新链；远端 main 仍 `cad717e`，生产仍旧行为 | 本地绿与线上生产长期脱节 | CI/Preview/SHA/G13 取证，不因 Jest 全绿标完成 |
| S-10 | P0 | GitHub connector `main.protected=false`，rulesets 返回 `[]` | 推送 main 可触发不可控生产构建 | 保护 main、required checks、发布环境审批，演练阻断 |
| S-11 | P0 | REPORT G15 9/9 MISS，TBT 522–2712ms，LCP 6/9 超预算 | 主线程/水合/重视觉资产可能超重；根因需 Trace 证明 | 保持原设备、节流和样本；逐长任务归因与修复，8/9 旧页面清单不可减少 |
| S-12 | P0 | REPORT 外部执行仅 `RECEIPT/IN_APP/SENT`；真实第三方任务未闭合 | 把内部回执误解成跨生态行动 | 能力说明强制区分本地示范、已接通、待授权、真实外部结果 |

> `?view=studio` 与 SCREENSHOT 中 Now 激活状态可能为不同取图时刻，现不将其定为已复现路由 bug；由深链测试复核。其他公开子页的 LIVE 内容未通过当前浏览器读取；以下逐页任务从源码确定位置，页面实际行为待 Playwright 取证。

## C. 版本与执行纪律

1. **先核实四个 SHA：** WORKTREE、origin/main、Preview、Production，并获取 `health.commit`、Netlify deploy ID、Cloudflare 缓存命中信息。禁止只看 git push 退出码；不得以 `x-nf-request-id` 冒充 deploy ID。
2. **分支与隔离：** `v22/strategy-recovery`，不得直接推 main。先建立不可变 `baseline/20261116` 证据和当前页面截图，不清理其他工作树。
3. **能力事实源：** 建立 `capabilities.yaml`：`available|gated|planned|deprecated`、source API、owner、test evidence、UI claim。缺真实 Provider 结果的功能不得在可售页面标 live。
4. **文案事实源：** `claim_register.csv` 每条包括 claimId、路由、文案、证据路径、有效日期、风险与批准人；没有证据默认下线；不得靠 `verified`、`real`、`fully autonomous` 等词制造结果。
5. **守住现有安全：** 原商业审批门不可逆打开；支付、法律、真实用户、生产数据变更都保留授权；第三方 Skill 仅供本地辅助，不得执行未审查的远端安装脚本。
6. **不得先画 3D 首页再决定产品服务。** 先产品承诺、用户动线、线框、内容，再设计系统与视觉。

## D. 产品战略冻结 · 产品责任人必须签字

**一级承诺（拟定，须与真实交付能力对齐）：** “说出你要完成的事。AI 把复杂步骤理清，在你授权后协助执行，并给出你能核实的进展和结果。”

**不以以下词作 Hero 主标题或用户 CTA：** Agent OS、Connection OS、Mission pipeline、WorkspaceSpec、Schema、MCP、A2A、Token、Compiler、Studio、Proposals。它们可在“如何工作”深层技术说明出现。

**默认使用者：** 有具体数字事务要完成的个人；其次为需要协调多人、多工具的团队；关系网络、品牌渠道、专业社群等是具体场景，不能占据一级产品定义。

**三类示例，只展示真实当前能力与待接通边界：**
- 个人：把一次复杂事务拆成可执行步骤，提醒需要确认的动作。
- 团队：组织会议、协调角色、发起经批准的任务。
- 关系/社群：在双方授权下安排一次真实引荐，保留结果确认。

**核心闭环定义：** Goal → Structured Plan → Explicit Consent → Authorized Action → Provider Receipt → Independent Outcome Verification → Human Time Returned。各环节不允许以一个标签/按钮代替数据事件。

**首页 Hero 英文候选（产品 GA 目标，不得提前谎称外部动作已上线）：**
> Say what you want done. Stay in control. See what actually happened.
> Turn one goal into clear steps, approve the actions that matter, and track evidence-backed progress.
> Primary CTA: Try with a goal. Secondary: See a real walkthrough.

**中文候选：**
> 说出想做成的事。复杂步骤交给 AI，关键决定留给你。
> 从目标、必要授权到真实结果，每一步看得见、查得到。
> 主按钮：开始一个目标；次按钮：看看如何完成。

**Truth gate：** 只有在已接通的步骤才能使用“自动完成”“跨应用执行”“Verified Outcome”等无条件语义；未接通版本要加可见边界，不得靠页脚免责声明修正首屏承诺。

## E. 信息架构（7 个内部 key 保留、前台只露 4 个用户任务）

用户不是来学“七个 SaaS 模块”。保留内部 `now/studio/field/consent/outcomes/agents/missions` keys、深链接、服务端契约，重组外层导航：

- 一级：**开始（now）**、**我的任务（missions，包含 studio 计划编辑）**、**待我确认（consent + agent approvals）**、**成果（outcomes）**。
- 二级“更多”：**关系网络（field）**、**执行记录（agents）**、**设置/证据**。高级用户可直达原 studio/field/agents 深链接，不能 404 或无提示跳 Now。
- Studio 是任务中的计划阶段，不必与“开始”争夺一级入口；Agent 是参与执行的对象，不是用户先学的产品分类。
- 首屏只显示一个主要目标输入、一句说明、2–3 个用户示例。没有当前任务时不显示四张“读不到”的大卡片；接口异常进入独立提示条与重新加载。
- 国际化：英文站全文英文、中文站全文中文，切换保留目标和当前任务；品牌名/API 专有名词可保留英文，常见行动词必须本地化。任何界面当前语言中出现未经批准的混合文案即 FAIL。

## F. 逐页修复 — 公共站点

| Route | 用户必须得到的答案 | P0 实施动作 | 真实验收 |
|---|---|---|---|
| `/` | LokFeel 为我完成什么？为什么更省时间？ | 去掉技术堆栈和巨型 3D；1 个主承诺、1 个主 CTA、3 步演示、真实能力边界 | 5 秒截图测试 10 人≥8 人能说清；CTA 到真实目标入口；PWA/普通浏览器皆正常 |
| `/product` | 到底能做哪些动作、不能做什么？ | 能力表 `live/gated/planned`、每项链接到实际操作与证据 | 100% 主张有 API/测试/状态支持，无假动作 |
| `/solutions` | 我的场景怎么使用？ | 从“团队行业网络”下移到个人/团队/关系三种 Job Stories | 每个方案有输入、授权、结果与边界；不出现未实现能力冒充 live |
| `/how-it-works` | 3 步能做出什么？ | 目标→审批→结果，进阶步骤折叠；一条真实录屏 | 第一次使用从 Hero 到目标输入≤2 clicks；说明图与产品行为一致 |
| `/stories` | 有什么真实案例？ | 无真实 Outcome 时禁止 verified 真实指标；演示全卡可见 DEMO 水印 | demo/真实分仓；每个真实案例须 Provider/同意/结果证据，脱敏 |
| `/pricing` | 为什么付费，包含什么？ | Connection OS / B2C / Hlua 价格与权益彻底分开；D1 未批则不露金额，CTA 禁止绕商业门 | SSR、RSC、JSON、metadata、schema.org、缓存与 checkout 均 fail closed |
| `/help` | 失败如何恢复？ | 以“登录不了/没权限/任务失败/如何撤销/费用”组织帮助 | 5 个核心问题真实可找；每条指南对应当前 UI |
| `/about` | 为什么造、谁负责？ | 从架构宣言变为人类使命与可信边界；主体和团队只写核实内容 | 法律主体经 D8 核实，未批时不公开未经核实主体 |
| `/contact` | 怎么联系客服？ | 不承诺未经验证的邮箱 SLA；移除待核实注册地址公开占位 | 发邮件测试、响应渠道确有效；无 404/死链 |
| `/terms`、`/privacy`、`/refunds` | 合同/隐私/退款如何保障？ | 适用经营主体、地域、收费权益和真实流程统一审核；旧 B2C 文案隔离 | 法务批准版本号一致；不得公开“注册地址待核实”假正式声明 |
| `/login`、`/register`、`/dashboard/onboarding` | 如何立即体验？ | 用户从 CTA 进入同一目标连续流程，注册后不丢草稿；无组织时最小阻碍 | 注册→回到原目标→创建方案成功；错误态明确，重新加载不丢草稿 |
| `/support`、`/faq` | 我遇到问题怎么办？ | 重复路由需规范 Canonical/301、内容一致 | FAQ/Help 不相互冲突，邮件/链接真实有效 |
| 旧 B2C 与 Hlua 路由 | 避免污染 ONE 产品 | 保留既有用户与权益；品牌导航/计费/营销边界清晰 | 不串 SKU、套餐、品牌话术与链接，原有用户功能不回归 |

## G. 逐屏修复 — 工作区（强制全流取证）

| Key/URL | 主任务 | 默认画面 | 强制交互验收 |
|---|---|---|---|
| `?view=now` | 用户表达一个目标 | 大输入、示例、清楚的下一步，先于技术状态 | 输入→真实 AI/规则来源→可编辑结果；API 报错可重试；旧异步响应不覆盖新目标 |
| `?view=studio` | 编辑可执行计划 | 目标、步骤、期限、参与人、需要授权与验收条件 | 可编辑 Revision、Conflict 409、刷新保持状态；直接深链显示计划编辑而不是 Now 假首屏 |
| `?view=missions` | 追踪任务 | 真实列表与当前进展、下一动作 | 列表响应非空时不可渲染空态；创建/读取/关闭/重放与服务端一致 |
| `?view=consent` | 决定是否执行 | 谁要执行何动作、用什么数据、风险和取消按钮 | 自批/越权/已撤销执行必须被服务端拒绝，不是只禁 UI |
| `?view=agents` | 查看谁做了什么 | Agent 行动、真实 Provider ID、回执、失败恢复 | RECEIPT/IN_APP 只能称“站内回执”；不得标成外部执行成功 |
| `?view=outcomes` | 看结果是否完成 | 目标 vs 已完成 vs 待核验；证据可点 | `EXECUTED` ≠ `VERIFIED`；核验人独立，证据有效、可追溯 |
| `?view=field` | 理解人和工具的关系 | 仅展示真实授权的关系网络 | 关系隔离、个人信息授权、权限撤回与无数据说明真实 |

## H. UI 设计系统硬标准

- **布局：** desktop 1440/1920、tablet 768/1024、mobile 360/390/430；主阅读文本宽度建议 56–72ch，层级必须稳定；禁止横向滚动/CTA 被遮挡/3D 造成阅读路径断裂。
- **排版：** Hero 文案根据断点控制行宽与行数；中文自然断句，不强拆语义；正文桌面建议 16–18px，移动≥16px；小字号只用于次要证据，不让关键操作小于可阅读范围。
- **触控：** 主要动作目标≥44×44 CSS px；次级控件满足 WCAG 2.2 AA 目标大小规则（含例外），键盘、focus-visible、Esc 和对话框焦点恢复通过。
- **可访问性：** AA 对比普通文本≥4.5:1，大文本≥3:1；axe serious/critical=0；200% zoom、reduced-motion、键盘和屏幕阅读器人工检查。
- **视觉风格：** 不要“暗色企业 SaaS 卡片堆”与“亮色 3D 宣传片”互相割裂。保持一套品牌语义 Token（允许深浅主题），统一圆角、间距、边框、颜色、状态。
- **页面态：** loading / empty / error / partial / permission-denied / awaiting-approval / success-with-evidence 各有可执行的下一步；`null` 不当 `0`，`0` 不当“读不到”。
- **性能：** 原 9 页面与同等环境 TBT 每页≤200ms、LCP≤2500ms、CLS≤0.1；独立 Trace 和 field RUM 分开报。性能采样成功 ≠ 预算通过。
- **设计交付：** Figma 可编辑真实 URL + NodeId + ComponentId → code path → test ID → screenshot 的 1:1 映射；无连接器如实 BLOCKED，不能拿图片替代。

## I. 需要开发的具体契约/组件

| Task | 代码范围（以真实 repo 复核为准） | 实施方式 | 红绿测试 |
|---|---|---|---|
| DEV01 | `src/app/(landing)/page.tsx`、marketing 组件、`src/config/brand*` | 重写官网信息结构，不删真实能力 | 访客 Hero / 目标 CTA / claims lint；错误承诺必须失败 |
| DEV02 | `src/app/(public)/*/page.tsx`、`src/config/public-surface*` | 逐页文案/状态/法务边界，去 B2C 串线 | sitemap、SSR、RSC、metadata、动态定价一致性 |
| DEV03 | `src/app/workspace/living-workspace.tsx`、`src/components/living/living-shell.tsx` | 七个内部 key 保留、四个用户主任务+按需高级视图 | `?view` 全 key、刷新、前进/后退、深链不倒退 |
| DEV04 | `src/lib/living/now/*`、`understanding-card.tsx` | 真 AgentRun、降级和来源标注、竞态与幂等 | A/B 乱序、重复点击、断线、取消、拒绝/限流负例 |
| DEV05 | `mission-board.tsx`、`mission spec`、`ConsentGate`、`AgentBoard`、`OutcomeObservatory` | 用任务进度替代四张孤立错误卡；端到端事实一致 | CREATE→APPROVE→EXECUTE→RECEIPT→VERIFY；无外部证据不能标 VERIFIED |
| DEV06 | i18n config、messages/en、messages/zh、layout language | 两语言完整翻译，默认浏览器语言或用户设定；品牌专名保留 | 文案缺 key/页面混语、日期价格格式、语言切换状态丢失均 FAIL |
| DEV07 | `src/app/(public)/pricing`、payment gates | 关闭未获批价格，三业务线隔离；保持已关闭新 checkout | 未批准仍可创建 checkout 或 SSR 泄价立即 FAIL |
| DEV08 | GitHub Actions/Netlify/CF config | branch protection + required checks + deploy guard；Preview parity | 未经批准 merge/push 不应产生生产部署；回滚不能恢复危险支付行为 |
| DEV09 | Playwright + axe + Lighthouse CI | DOM/交互/Console/HAR/视觉/性能与 claim sweep | 缺证据/空集断言/只测本机必须 ERROR/FAIL |
| DEV10 | Skills vendor lock | 获取官方仓库并 pin SHA，审阅 SKILL 和脚本，不执行不明 install | 每个技能具备来源/许可证/版本 SHA/测试用途；恶意/不需要直接禁用 |

## J. 强制门禁与证据目录

| Gate | 阈值/前置 | 不通过处理 |
|---|---|---|
| V22-G00 战略符合 | 业务 Owner 通过 1 页定位与 3 个 Job Stories；每个 Claim 有证据 | NO-GO，停止视觉投机开发 |
| V22-G01 生产真实审计 | 官网+12 公开页+7 工作区 key+登录/注册及旧业务隔离，完整截图与 HAR | 未访问页面标 NOT_TESTED，不得估算 PASS |
| V22-G02 文字与 i18n | 用户可见文本语言一致率=100%，未批准能力声明=0 | FAIL |
| V22-G03 业务主线 | 目标→编辑→授权→行动→可核验结果，节点各有真实 ID 与审批 | 缺少任一实际步骤记 PARTIAL |
| V22-G04 产品可用性 | 10 名真实目标用户：≥8 人 5 秒说清用途；≥8 人无提示完成核心任务；保留原始观察 | 机器人不计样本；未达记 FAIL |
| V22-G05 设计一致性 | Figma Node ID 与真实 7 screen+核心营销页一一对应 | BLOCKED 不计 PASS |
| V22-G06 视觉/响应式 | 7 viewport（360/390/430/768/1024/1440/1920）× 所有关键状态，overflow=0，差异经人工审定 | 新增截图/空扫描禁假绿 |
| V22-G07 无障碍 | AA 零严重/致命；键盘、200% zoom、读屏与 reduced motion 实测 | FAIL |
| V22-G08 性能 | 9/9 TBT≤200ms，LCP≤2.5s，CLS≤0.1；相同设备节流，至少 3 轮，原始 Trace | 任何 1 页 MISS = FAIL |
| V22-G09 安全 | 租户、Consent、R1 自审批、XSS、注入、SSRF、密钥、越权 negative controls 全过 | FAIL |
| V22-G10 商业真实性 | D1/D8 未批不能有价格/法务假承诺；演示指标显著标注；支付 API Webhook 不误售 | FAIL |
| V22-G11 CI 与独立复核 | 独立 reviewer + required CI 全绿 + preview SHA 对应；main 保护实测 | FAIL |
| V22-G12 发布准备 | Prisma migration / rollback / monitor / owner approval / release manifest 全齐 | BLOCKED |
| V22-G13 生产验收 | deploy SHA=批准候选；真实页面和端到端复验；48h 只读观察启动 | `RELEASED_NOT_VERIFIED` 不得报完成 |

## K. 验收以真实人类行为，而非测试数量

匿名真实目标用户，年龄/行业不限，满足任务需求：
1. 给 10 人看首页首屏 5 秒，关掉页面，让其用自己的话说“这个产品能帮我做什么、何时要我批准、得到什么”。≥8 人回答准确。
2. 不提示点击路径，10 人中≥8 人在 60 秒内找到并开始一个目标；是否成功以浏览器和服务端记录为准。
3. 在真实许可的沙箱，≥8 人能区分“已创建任务”“已执行行动”“结果已核验”。
4. 10/10 必须能找到取消/撤回与隐私说明；否则有关键安全理解缺陷。
5. 记录每人的点击、用时、误解、失败、退出点，不能让同一 Agent 模拟用户并替代真实样本。

## L. GitHub 开源热度技能选择（2026-11-16 经 GitHub API 核查；不是 GitHub 官方日榜排名）

| 项目 | GitHub stars（近似） | 开源许可 | 在 V22 的唯一职责 | 严禁误用 |
|---|---:|---|---|---|
| `obra/superpowers` | 318,110 | MIT | 测试先行、系统 debug、独立代码评审、双层验收 | 不得让“写计划”代替代码交付 |
| `anthropics/skills` 的 `frontend-design` | 195,432（仓库） | 各 skill 自带许可须核查 | 整体视觉与 UX 文案，不做模板 SaaS | 不得复制默认米色/黑色套餐外观 |
| `nextlevelbuilder/ui-ux-pro-max-skill` | 149,995 | MIT | 设计 Token、IA 备选、交互模式研究 | 不得直接套用风格库替代定位 |
| `pbakaus/impeccable` | 110,816 | Apache-2.0 | `/impeccable critique`、`audit`、`clarify`、`harden` 独立视觉审计 | 检查结果不自动算用户验收 |
| `Nutlope/hallmark` | 55,558 | MIT | 第二视觉审稿：检测模板化/AI slop | 不叠加无意义视觉效果 |
| `vercel-labs/agent-skills` | 34,134 | repo 具体 skill 许可需查 | `web-design-guidelines`、`react-best-practices` | 必须拿源码与真实 Trace 校验 |
| `microsoft/playwright-cli` | 15,224 | Apache-2.0 | 真浏览器逐页、登录态、HAR、截图、端到端 | 无法访问线上时不能冒充 LIVE |
| `dequelabs/axe-core` | 7,827 | MPL-2.0 | WCAG 辅助自动化扫描 | axe 0 错误 ≠ 人工可访问性通过 |
| `GoogleChrome/lighthouse-ci` | 7,149 | Apache-2.0 | 每 PR 性能、A11y、SEO 预算差异 | 不能只用 Lighthouse 总分代替 TBT 等强制指标 |

所有三方工具须先查 `LICENSE`、`SKILL.md`、postinstall 与可执行脚本、网络权限/遥测、已知安全问题，选定固定 Git SHA 和哈希；只在隔离工作树执行，最小权限，不提供生产密钥，不使用自动执行的 `curl | sh`。此清单只代表找到并核验项目元数据，**尚未在 WorkBuddy 机器安装**。

**建议加载顺序：** Superpowers（流程）→ Impeccable Critique（审计）→ Anthropic frontend-design + UI-UX Pro Max（形成选择）→ Vercel web-design + React best practices（实现）→ Playwright / axe / Lighthouse（独立证明）。Hallmark 做最终反向审稿。一次只让一个 Skill 负责主输出，避免多 AI 设计风格互相叠加。

**核验链接：**
- https://github.com/obra/superpowers
- https://github.com/anthropics/skills/tree/main/skills/frontend-design
- https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- https://github.com/pbakaus/impeccable
- https://github.com/Nutlope/hallmark
- https://github.com/vercel-labs/agent-skills
- https://github.com/microsoft/playwright-cli
- https://github.com/dequelabs/axe-core
- https://github.com/GoogleChrome/lighthouse-ci

**安装示例（完成代码审查后、锁版本，并检查本机 CLI 接口后才执行；不直接在生产机安装）：**
```
# 第一步仅下载、记录来源并审计；不要运行未知 hook
mkdir -p vendor/agent-skills
# 按仓库安全要求 git clone 并记录 git rev-parse HEAD/许可证
# 后续在 WorkBuddy 的技能系统中根据各项目官方说明注册具体 SKILL.md

# Playwright CLI 本地工具示例（前提：已在 lockfile 固定版本并获准安装）
# npm install --save-dev @playwright/cli
# npx playwright-cli install --skills=agents
```

## M. 分工与连续执行，不能以“缺 Figma/Token”为停工理由

- **产品负责人/Strategist：** 写 `STRATEGY_LOCK.md` 和 `CLAIM_REGISTER.csv`；对正反例作裁决；不是设计出代码。
- **UX Architect：** 首页、主流程、7 key IA 合并和 3 个任务场景；首屏用户实验。
- **Frontend Lead：** 组件化、i18n、视觉审计、真实状态接线、性能整改。
- **Backend Lead：** 复用既有契约，保障真实授权与 Outcome 证据；不得因首页整改重建 OS。
- **QA / Reality Checker：** 独立启动真浏览器，对本地/Preview/生产逐项分辨；每日覆盖未完成 P0。
- **Security + Release：** 权限、商业 fail-closed、main 保护、Preview、迁移与回滚。
- **Codex 独立 Reviewer：** 不接受 WorkBuddy PASS 叙述，必须重跑测试并审阅截图/Trace/负例。

**流程：**
R0 立刻冻结现状与版本 → R1 route 取证与反例用例 → R2 Owner 确认一级价值/用户画像/文案 → R3 并行改营销 IA 与任务型工作台（先线框）→ R4 开发、无障碍、性能、i18n → R5 真实 10 人测试 + 独立代码审计 → R6 受控 PR/Preview/Manifest → R7 经 Owner 批准后单次发布、G13、48h 观察。

**时间约束（执行目标、非完成承诺）：** D0 建问题矩阵+基线截图，D+2 给出第一轮可交互 Preview，D+5 交付各主链路代码与 Trace，D+7 给出无阻断项候选或逐条证据阻断。人工输入或真实技术缺口未解除，不得偷换截止日为“已 PASS”。

**每轮必须只提交真实成果：**
`TASK_ID / SOURCE_SHA / REAL_URL / EVIDENCE_LEVEL / CODE_FILES / CLAIM_ID / TEST_COMMAND / EXIT_CODE / NEGATIVE_CONTROL / SCREENSHOT / HAR / USER_RESULT / VERDICT / BLOCKER / NEXT_EXECUTABLE_ACTION`。

**最后的 NO-GO 哨兵：** 只要 10 人不能看懂首屏、任何已显示的功能无法实际完成、混语、未批准的数字/法律信息可见、main 不受保护、任一强制页面性能未达标、真实业务证据缺失，禁止宣布 `RELEASED_AND_VERIFIED`。

## N. WorkBuddy 一次性启动口令

> 以本文件为唯一 V22 整改总令。现在停止开发新花哨功能，先按 LIVE/SOURCE/REPORT 分级建立首页与工作台事实矩阵，产出战略偏航证据和可复现 bug。随后立即并行推进官网信息架构、七屏任务型导航、i18n、React 性能、claim gate、独立 Playwright 审计和 GitHub 分支保护。开源技能仅在代码安全审查后加载。未经审批不改生产、不触发扣款、不代填公司主体和商业批准。可自主执行的工作不得停止在“计划/报告”。每一项必须以可交互 Preview、实际 API 回执、可复现截图与独立评审收口。若仍旧发生“本地说完成、线上看不到”，该批直接 FAIL，不允许作为下次基线继续叠加。
