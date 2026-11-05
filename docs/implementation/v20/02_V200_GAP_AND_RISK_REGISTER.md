# V20.0 · 02 — 差距与风险登记（Batch 0）

> 本文件是 V20.0 的「问题清单」。每条标 `GAP`（功能缺口）/ `RISK`（风险）/ `BLOCKED`（受阻于外部资源）/ `DECISION`（需人决策）/ `UNKNOWN`（当前不可确认）。
> **绝不臆造已闭合**。B5/B6 发布前，所有 `BLOCKED`/`DECISION` 必须有结论或明确「保持不可用」的诚实呈现。

---

## 一、GAP（功能/事实缺口）

| ID | 缺口 | 现状（真实） | 影响 | 归属 |
| --- | --- | --- | --- | --- |
| G-01 | Workspace·Missions 列表区未接线 | `NAV` 中 `missions` `ready:false`，无端点、无渲染入口 | 用户无法在 Workspace 看任务队列（创建已在 Studio） | B2 |
| G-02 | Workspace 六屏枚举 vs 实现不一致 | 用户列 6 屏（Now/Intent·Studio/Missions/Agents/Consent/Outcomes）；实现 7 视图（多 `field`，且 `missions` 未接线） | 范围歧义：V20 是否保留 Field、是否升 Missions 为可用 | DECISION |
| G-03 | Workspace 深链接机制未核验 | 当前为单路由内部 `activeKey` 切换，无 6 个独立 URL | 用户要求「先核验深链接再决定路由」，当前不支持深链到具体视图 | B2/B1 |
| G-04 | Bridge（跨社群）是子面板非独立屏 | 文件头 T10 明确不取第八屏 | 与「13 核心屏」口径需对齐说明 | DECISION |
| G-05 | 真实 Agent 执行闭环未验证 | `AWAITING_APPROVAL` 仅真实 Provider 成功路径可达；本地无凭据 → A-03b `BLOCKED_ENV` | 核心卖点「真替用户完成工作」无端到端证据 | B3 |
| G-06 | S2/S3 验证层级缺凭据与真实授权 | S2 需 `OPENAI_API_KEY` 或 `WORKBUDDY_LLM_*`；S3 需真实用户授权+真实 Outcome | 无法宣称「生产已验证」 | B3/B6 |
| G-07 | 支付凭据（D-09 历史 55 处形似凭据）未轮换 | 扫描见 `sk_(test\|live)_`/`whsec_` 集中在 `scripts/qa`、`tests/billing`；`wbpk_` 在 `provider.ts` 与 QA 脚本 | 安全门禁须确认无真实密钥入仓 | B5/B6 |

---

## 二、RISK（风险，按复发率/严重度）

| ID | 风险 | 触发条件 | 缓解（已有/待建） |
| --- | --- | --- | --- |
| R-01 | 发布结论误信脚本退出码 | 沙箱拒 keychain → git 退出码≠0 但推送成功 | **只认 `git ls-remote`**；`[skip netlify]` 不触发构建（已踩过） |
| R-02 | `[skip netlify]` 提交误触发生产 | 误改 Netlify 关注的头提交 | 仅在台账回填时显式加；发布不用 |
| R-03 | 推送过的提交被 `--amend` | 重写历史导致远端拒绝/混乱 | **发布过的提交禁止 amend** |
| R-04 | stub Provider 被生产加载冒充真成功 | `AGENT_PROVIDER=stub` 误入生产 env | 用户 V20 建议：`stub` 仅在 `NODE_ENV≠production && AGENT_TEST_ISOLATION=true` 时启用，否则**抛错**；DB `providerKind` 如实留 `stub`（已部分具备，需加固守卫） |
| R-05 | 前端信任未验证的模型输出 | 直接渲染 `rawText` | `agent.prisma`：`rawText` 永不进 DTO/渲染；只渲染经 zod 校验的 `proposalJson` |
| R-06 | 跨租户访问 Evidence | `outcome.read` 持有者（MEMBER 起）可读到 `reporterId/counterpartyId` | 二者**不进 DTO**（只给角色）；需 SEC-08 执行+Outcome 路径复验 |
| R-07 | 审批橡皮图章（批准 A 发 B） | 执行时由调用方指定收件人 | `AgentDeliveryTarget` **创建时**固定，执行时不补 |
| R-08 | 派生验证级别被客户端篡改 | 直接写 `verificationLevel` | **只由服务层依 `OutcomeVerification` 记录集派生**，拒绝客户端入参 |
| R-09 | 视觉审计假绿（加载态提前放行） | settle 在 sr-only h1 出现即放行 | 已加「忙碌指示器消失 + 3 次 300ms 稳定采样 + 长度>200」 |
| R-10 | axe 注入传源码 / 服务挂了报零违规 | 服务未起却判零违规 | 已修复：可扫面不完整或基线缺失即非「零新增」 |
| R-11 | 本地 3000 端口遗留服务导致 payment-off 假绿 | 默认 `BASE=127.0.0.1:3000` 打本机 | 显式 `--base=https://app.lokfeel.com` 回读「目标」行 |
| R-12 | Figma 节点伪造设计交付 | 用截图贴进 Figma 冒充可编辑 | 用户硬要求：禁截图冒充；无 token 则**标 BLOCKED**而非编造 |

---

## 三、BLOCKED（受阻于外部资源 / 人工）

| ID | 受阻项 | 阻塞原因 | 解除条件 |
| --- | --- | --- | --- |
| B-01 | **Figma 可编辑节点交付**（B1 字面要求） | 本环境**无 Figma Personal Access Token、无 `mcp__figma__*` 工具**；`figma-to-code` 技能需 token+file key 才能调 REST API | **RESOLVED（2026-11-04）**：采用用户选定方案①——以代码设计系统（`--lf-*` Token + 真实 React 组件）作为 B1 权威设计源，Figma 可编辑节点降级为后续补交项（用户提供 token+file 后再建）。禁止截图冒充可编辑设计（R-12）。 |
| B-02 | 真实 Provider 验证（S2） | 缺 `OPENAI_API_KEY` / `WORKBUDDY_LLM_*` 生产或受控测试凭据 | 提供受控测试账户凭据（仅测试环境） |
| B-03 | 生产证据（S3） | 需真实用户授权 + 合法动作 + 真实 Outcome，非自动化可完成 | 真实业务场景人工发起并经核验 |
| B-04 | T-5 人工决策（支付 4 凭据 / D-01 退款 / D-02 定价 / D-03 法律主体 / D-09 历史凭据轮换） | 需业务方最终批准 | 业务方批准或明确「保持不可用」 |

---

## 四、DECISION（需人决策）

| ID | 决策点 | 选项 | 建议 |
| --- | --- | --- | --- |
| D-V20-1 | Workspace 是否保留 `field` 视图、是否升 `missions` 为可用 | ① 严格 6 屏（去 field、接 missions）；② 保留 field（7 视图）；③ 维持 missions 未接线 | **DECIDED（2026-11-04）→ ②**：保留 Field（7 视图，Field 已 `ready:true` 为差异化体验）；Missions 在 Workspace 内维持未接线（创建已在 Studio），避免重复入口。13 核心屏口径：Console 7 + Workspace 6 主线（Now/Studio/Consent/Outcomes/Agents + Field 增强），Missions 不计入主线。 |
| D-V20-2 | Figma 处理方式（见 B-01） | ① 提供 token+file 真建节点；② 接受代码设计系统为权威源 + 后续补 Figma；③ 暂停 B1 等 token | **DECIDED（2026-11-04）→ ②**：代码设计系统（`--lf-*` + 真实组件）为权威源，Figma 节点后续补交。 |
| D-V20-3 | 路由：Workspace 是否改 6 独立 URL | ① 维持单路由内部切换（现状）；② 拆深链 URL | 建议①（用户长文亦要求先核验再决定，且深链非 V20 首要） |
| D-V20-4 | 不可用能力如何诚实呈现 | 统一「`ready:false` + 原因」横幅（现状已做） | 延续现状，禁止隐藏或假装 |

---

## 五、UNKNOWN（当前不可确认，待 B1/B2/B4 复验）

- U-01：V20 重新设计后，Deep Field / Paper 双主题在 4 视口下的**实际渲染**差异（须 B4 真跑）。
- U-02：重构后 axe 四视口棘轮基线是否需重冻结（新增/改动组件会改变 `axe-baseline.json`）。
- U-03：Workspace 内部视图在 360/390 移动端的横向溢出与 Modal 遮挡（须 B4 真跑）。
- U-04：Figma 节点 ID → React 组件 → API 状态 的逐项对照是否能在无 token 下达成（B-01 决定）。

---

## 六、B0 结论

- 代码事实源已 100% 锚定（git/生产/路由/端点/状态机/DB/CI）。
- **唯一硬 BLOCKED = B-01（Figma 节点）与 B-02/B-03（真实 Provider 凭据）**，二者均非代码能力问题，而是外部资源/授权。
- 其余 V20 工作（B2/B4/B5/B6 的工程实现与门禁）可在**不依赖 Figma token 与真实凭据**的情况下推进，使用代码设计系统为权威源、S1 沙箱为 Agent 闭环验证手段。
- A-03b 的闭合路径已明确：**S1 显式 stub 沙箱（加固守卫，生产抛错）+ S2 真实 Provider（待凭据）**，绝不允许「无凭据自动降级成 stub 成功」。
