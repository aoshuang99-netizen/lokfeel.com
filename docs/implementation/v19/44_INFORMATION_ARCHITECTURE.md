# 44 — 全站信息架构审计（V19-81 · Batch 2）

日期：2026-10-30 21:20~21:30 (GMT+8)　环境：生产构建 `gaXauN841hc2wD66dXBCe` @ localhost:3000
工具：`scripts/qa/v198-ia-audit.mjs`（新增，只读探针）＋ 真实截图 16 张（2 视口 × 8 屏，`/tmp/v198-ia/`）
账号：`e2e.authed@example.invalid`（Membership role=OWNER，seed-authed 夹具）　数据：空组织（真实空态即被测对象）

## 1. 路由实证（以代码为准，非文档假设）

| 层 | 路由 | h1（390 实测） | 面向 |
|---|---|---|---|
| 入口 | `/` `/login` `/register` `/pricing` | — | 新用户 |
| 执行 | `/workspace`（单路由，六页签内部切换：Now/Studio/Field/Consent/Outcomes/Agents） | 今日工作台 → 随页签切换 | 一线用户 |
| 治理 | `/console` + `/console/{agents,connections,members,missions,outcomes,settings}`（8 个真实目录，`/console` 无子页 = Overview） | 社群总览/智能体/连接/成员/连接任务/成果/设置 | 管理员 |

三层职责与执行令的「入口建立目标 → Workspace 执行 → Console 治理」一致。

## 2. 逐屏审计表（390×844 实测；1440×900 双跑一致）

| 屏 | Primary CTA | 真实 API（探针捕获） | 空态 | Loading | Error | 权限 | 移动端 |
|---|---|---|---|---|---|---|---|
| `/console` 总览 | 查看全部→ | missions / workflow/overview | ✅「没有卡住的连接…」诚实陈述 | 指标卡骨架 | 未见 | OWNER 可见 | ✅ 单列 |
| `/console/agents` | 刷新 + 状态筛选（全部/待批准/已批准/已执行） | agents/runs / agents/usage | ✅「本社群还没有 Agent 运行」+ 说明谁会触发 | 有 | 未见 | ✅ | ✅ |
| `/console/connections` | 刷新 + 阶段筛选（含各阶段计数徽标"全部0/待表态0…"） | connections/pipeline | ✅（计数为 0 是真实值，不是无数据装零） | 有 | 未见 | ✅ | ✅ |
| `/console/members` | 刷新 + 角色筛选 | members | ✅ | 有 | 未见 | ✅ | ✅ |
| `/console/missions` | 刷新 + 状态筛选（草稿/进行中/已暂停/已关闭） | missions | ✅ | 有 | 未见 | ✅ | ✅ |
| `/console/outcomes` | 刷新 + 「仅自报0/已验证」筛选 | outcomes / connections/proposals | ✅ 自报与已验证区分明确（对应 Verified Outcome 语义） | 有 | 未见 | ✅ | ✅ |
| `/console/settings` | 保存（无改动时 disabled「没有改动」） | org | ✅ | 有 | 未见 | ✅ | ✅ |
| `/workspace` | 编译工作区（底部常驻）＋ Intent 输入框 | proposals / outcomes / workflow/jobs / org / intents…（9+） | ✅「没有待处理事项。这是真实结果 —— 本页不会为了填满而生成内容。」 | 有 | 未见 | 页签按能力开关 | ✅ |

**Loading/Empty/Error 的取证方法**：探针在 `domcontentloaded + networkidle + 1.2s` 后采样，
空组织下所有屏均为「真实空态」而非骨架（`skeletons` 计数 0），即空态是稳定渲染结果。

## 3. 执行令重点问题的实测回答

### 3.1 「用户是否看得懂」✅

- Workspace 移动端首屏：MISSION PIPELINE 四阶段（提案/同意/执行/成果）+ 各卡**标注真实 API 来源**
  （`来自 /api/v1/connections/proposals（双方已同意、尚未介绍）`）——用户能知道数字从哪来；
- 每屏 h1 随页签切换正确更新（实测：今日工作台 → Mission Studio → Consent Gate · 同意与逐字段披露
  → Agent 运行与审批 → Outcome Observatory），`aria-current` 正确转移；
- 底部「编译前在本地完成：只有真正创建任务时才会写入服务端」—— 诚实边界说明。

### 3.2 「系统是否值得信任」✅（三处诚实设计的实证）

1. `/console/settings`：「转让所有权与删除社群…**尚未实现**」—— 源码注释明说"已在矩阵里，但流程
   （二次确认、审计、级联处理）尚未实现。这里只陈述事实"（`settings/page.tsx:318`）。**不可用操作不伪装**；
2. `/console/connections`：「接管/重试的操作界面尚未实现，接口已就绪」（`page.tsx:344`）—— 区分"接口就绪"与"界面可用"；
3. `/console/agents` 额度卡：显示**真实的** 0/500,000 分 + 「未配置 WORKBUDDY_LLM_ENDPOINT —— 无法云端算力兜底；
   未配置 OPENAI_API_KEY —— 不会用任何'假模型' fill 充真实调用」—— Provider 缺位如实暴露，不 mock。

### 3.3 「用户是否做得成」→ Batch 3 验证

IA 审计只能证明"入口与指引存在"；Intent→Mission 真实闭环在 Batch 3 用探针取证。

## 4. 发现的问题清单（按优先级）

| # | 级 | 屏 | 问题 | 建议 |
|---|---|---|---|---|
| IA-1 | P2 | `/console` 总览 | 「消息投递」空态（"还没有任何投递记录"）无解释性文案 —— 对比其它空态有说明，此条最简 | 补一句"消息投递在连接推进后出现"级别的来源说明 |
| IA-2 | P2 | `/console` 总览 | 空组织无"从哪开始"引导（四指标卡全 0 + 三区块空态，新管理员需自行发现 /workspace） | Overview 空组织时加一张"第一步：到工作台写下目标"卡（链接 /workspace） |
| IA-3 | P2 | `/workspace` | Missions 不在六页签内（在 /console/missions）—— IA 上正确（Missions 是治理面），但 pipeline 卡的"成果"端点文案易让人以为有 Missions 页签 | 低成本澄清：pipeline 卡副标题已写"四个真实端点"，可再加"任务管理在治理台" |
| IA-4 | P3 | 全站 | 侧栏第一项是「个人模式」返回链接，治理/执行两层切换靠它 —— 入口不显眼但一致 | 保持现状，观察真实用户反馈 |

**P0/P1：0 项。** 八屏全部具备：真实 h1、主 CTA、真实 API、诚实空态、权限内可见、移动端单列可用。

## 5. 与执行令的对照声明

- 本审计**基于真实页面**（生产构建 + 真实登录态 + 真实 API 捕获），非静态原型；
- Before 截图 16 张已在 `/tmp/v198-ia/`（含 390 与 1440 双视口），原始 JSON `/tmp/v198-ia.json`；
- 未发现需要"先截图再修"的 P0/P1 视觉缺陷 —— Batch 6 的 Before/After 将聚焦 IA-1/2 的增量改进。