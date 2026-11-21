# 直接给 WorkBuddy / Codex：V25.6 GA 收口执行命令

**这不是新的一轮产品战略；继续 V25.6，复用原 UX00–17、V25.5 的真实成果。本包 GA-XX 仅是细化收口工单。**

你已经证明 20 条隔离浏览器消息与 91 次程序注入扰动；现在禁止重新“刷消息数”代替产品交付。目标是将未提交的本地可用功能，通过真正面向用户的 UI、真实 AI、隐私、独立验收及受控发布，转化为线上可使用成果。

## 最初动作（无授权依赖，立即执行）

**GA-01 源码冻结**：在本机只读列出 `git status --porcelain=v1`, `branch`, `HEAD`, `origin/main`, 最新未提交 diff，保存证据和 SHA。不得 `git reset --hard` 或直接删工作树。为候选准备独立分支并使可执行修改具备唯一 commit。列明已提交和未提交差异，不得借报告 SHA 冒充真实 HEAD。

**GA-20 注册安全**：核查 `src/app/(auth)/register/page.tsx` 当前候选是否仍用 `saveRegState(phase, formData, sentInfo)` 把包含 password 的对象写入 localStorage。远端旧代码已证实存在这个逻辑。若存在，先修仅保存严格白名单非敏感字段、删除已有敏感注册缓存；在独立浏览器验证密码/验证码不会残留 localStorage/sessionStorage/URL/日志。不能因为新版UI已美化就跳过。

**GA-02 支付热修复**：独立于大版本，从**真实生产祖先 SHA**制作最小 fail-closed 候选。测试已登录与匿名 `pricing`, `plans`, `checkout`, Provider create count；旧订阅/回调/退款不回归。准备安全 rollback，回滚后也必须保持 Checkout 关闭。无 Owner 精确 SHA 批准，不部署。

**GA-03/04/05 首页与设计系统**：扫描真实 `/`, `/product`, `/solutions`, `/pricing`, 登录与 6 个 Personal 路由、`/console` 六页。完整两端 UI/UX、文案、CSS Token，首屏删除旧 3D + 技术轨道；每个组件给真实数据源、动作及失败态，未经确认的能力对外降级。

**GA-06/07/08 最短真价值**：修好登录注册→Chats；私人 AI 使用**隔离、授权的真实 Model Provider**，服务端 Consent 签发与撤回；Original/Suggested/Use/Edit/Send；真实两端接收；保留旧 E2E 作为回归。没有真实 Provider 则明确显示 AI unavailable，不可 Stub 充 AI。

**GA-09/11/12 出口与企业面**：Socket/Pusher/Bot/媒体/日志跨租户越权独立测试，修口子；组织 `/console` 改为 “Waiting/Ready/Follow-up” 真实待办首屏，旧技术队列下沉高级页；各数字有来源、时间、Drill-down 和真实动作，不满足就移除。

**GA-14/15 发布候选验收**：7个视口、200%缩放、键盘读屏、9页性能、全量 typecheck+build+E2E、静态/动态隐私负例、独立 Reviewer、真 Preview SHA、保护 main。不得以 `skip netlify` 或人工报告替代强制 CI。

**GA-16 真实使用性**：至少10名外部目标用户的 5秒理解/90秒真实草稿/180秒自主发送盲测；至少150条预先冻结双语/沟通/隐私样本人工盲评；报告全部失败和区间，不能让模型给自己评估结果。人员招募可以由Owner开展，但不影响工程其他工作。

**GA-17 发布**：独立分波 `S 安全止损`, `P Personal Alpha`, `B Business Beta`, `O 开源`, `GA 公测`。每波需唯一 SHA、schema migration plan、feature flags、真实 Preview、回滚、Owner 明确授权，且发布后验证真实域名与真实用户链路。GA 前不能把 LOCAL_BROWSER_TESTED 当 PRODUCTION_VERIFIED。

## 不得突破的授权边界

- 生产付费、生产数据写入/迁移、正式部署、真实外部消息、密钥更换、调整 License 需要各自对应的明确审批。
- 测试必须使用沙箱账户、假支付事件与非敏感测试消息；不要将私人对话交给任何未获授权模型。
- 缺 Figma 凭据时可先在代码创建可追踪 Token/组件并准备设计映射；不能宣称已生成真实 Figma 节点，也不能让 Figma 成为支付安全和前端基本功能修复的阻断。

## 工具及独立验收矩阵

| 专职角色 | 应调用 | 每项交付 |
|---|---|---|
| Product/UX | 浏览器真实页面、Figma(有权限时)、Playwright、axe | Before/After 7视口，真实任务录像，用户5秒/90秒/180秒记录 |
| Frontend/IM | Playwright、React/Next、Prisma E2E、现有 IM | 两账号/双设备消息，AI可编辑草稿，权限负例，渲染trace |
| Social AI | 真实隔离 Provider、QE、promptfoo/人工评分 | provider/model/consent trace、150冻结样本、失败案例 |
| Security/Auth | Gitleaks、Jest、Prisma、浏览器storage/URL审计 | 密码不持久化，消息/组织不越权，未授权外发0 |
| Business/Data | 现有 workflow/connections/members API | 每卡真实 record id + 可操作CTA + asOf、空/错误状态 |
| Release/SRE | GitHub Actions、独立 Codex Reviewer、LHCI、部署平台 | 必须带 CI run id/Preview SHA/Deploy ID/回滚演练 |

## 强制报告字段与合法判定

`TASK_ID / PARENT_ID / BRANCH / BASE_SHA / HEAD_SHA / SOURCE_FILE / FRONTEND_URL / CTA / DATA_SOURCE / BACKEND_RECEIPT / TEST_ACCOUNT / SANITIZED_MODEL_TRACE / CONSENT_REF / BEFORE_AFTER_SCREENSHOTS / BROWSER_VIDEO / NEGATIVE_TEST / RAW_LOG_HASH / INDEPENDENT_REVIEWER / PREVIEW_SHA / PROD_SHA / VERDICT`。

合法状态：`NOT_TESTED / CODE_COMPLETE / LOCAL_TESTED / REAL_BROWSER_TESTED / REAL_MODEL_TESTED / INDEPENDENTLY_VERIFIED / PREVIEW_VERIFIED / PRODUCTION_VERIFIED / BLOCKED / FAIL`。不能自评自动升级。

### 每批最后必须答复
1. 用户今天能在真实界面完成哪些以前做不到的动作？
2. 哪个用户价值指标有真实分子/分母证据？若没有，就写 NOT_MEASURED。
3. 哪些源数据、模型、隐私、版本或支付风险未关闭？
4. Preview 的 SHA、生产的 SHA、独立审查与安全回滚各是什么？
5. 下一批未完成的最短可交付功能是什么？

**从目前已有证据看：先把首页与个人聊天＋真 AI 提升到可见可用的 Alpha，企业后台“待我处理”随下一波验证；开源平台同步建但不能压住用户第一价值。所有变更保留现有安全底座，禁止再重造第三套 OS。**
