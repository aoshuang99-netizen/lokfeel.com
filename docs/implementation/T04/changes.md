# T04 · changes — 变更记录

> 基线 commit `e3bc161`（T04 第一刀：双向互补召回**内核**，`main`）。
> 本文件记录 T04 **第二刀**（候选装配 + API + 候选页 + 披露档位 `CANDIDATE` + 测试取证）。
> 任务：双向检索与可解释排序（`tasks/T04_RECIPROCAL_MATCH.md`）。
> 验收：**AC-13**（P0，双向匹配与候选解释）。
> 前序：T03 已交付 `discloseSubject()` 作为**披露唯一出口**，并在 `BACKLOG.md` 留下交接约束：
> 「T04 若新增候选/档案输出通道，**必须经它投影**，不得自己拼对象」。

---

## 1. 提交

| 项 | 值 |
|---|---|
| 第一刀（内核） | `e3bc161` — `feat(t04): 双向互补召回内核 —— 硬门控、四段式管线与可解释排序（第一刀）` |
| 第二刀（本文件） | `b4125eb` — `feat(t04): 候选装配与 CANDIDATE 披露档位 —— 新通道接披露唯一出口`（含 `[skip netlify]`） |
| 本文档回填 | 紧随其后的文档提交 |
| 分支 | `main` |
| 决策依据 | 用户在 T04 决策点选 **A**：引入更窄的 `CANDIDATE` 档位（零 DDL）；召回走**结构化**路径，语义召回留待 M6 迁 PG |

---

## 2. 交付物清单（第二刀）

### 2.1 Schema（零 DDL —— 这是本刀最重要的一个事实）

| 文件 | 规模 | 说明 |
|---|---|---|
| `prisma/schema/connection.prisma` | +29/−? | `enum DisclosureAudience` 由 `SELF/ORGANIZER/COUNTERPARTY` 扩为 **`SELF/ORGANIZER/COUNTERPARTY/CANDIDATE`**；`SocialIntent.disclosure` 注释同步 |
| `src/generated/**` | 7 文件再生 | `npx prisma generate` 产物；`src/generated/index.d.ts` 含 `CANDIDATE: 'CANDIDATE'` |

**为什么是零 DDL**：
libSQL 的 `CREATE TABLE` 对 `TEXT` 列**不生成 CHECK 约束**（已实测 DDL 原文核实），
而 Prisma 在本仓把枚举列落成 `TEXT`。因此**新增一个枚举成员不产生任何 DDL 差异**。
既不需要迁移脚本，也不需要回滚脚本。
生产库的合法性约束只来自应用层（`isAudience` / `normalizeDisclosure`），而它们随代码一起发布。

**实测证据**（不是推理 —— 含负向对照，细节见 `rollback.md` §1）：

```bash
npx prisma migrate diff --from-schema /tmp/t04-schema-old --to-schema prisma/schema \
  --script --exit-code
# → exit 0，输出全文仅一行 `-- This is an empty migration.`
```

> ⚠️ 这条结论**只对"往枚举末尾追加成员"成立**。若将来要把枚举列换成带 CHECK 的形态，
> 需要先扫存量值 —— 存量里已经可能出现 `CANDIDATE`。

### 2.2 运行时库 `src/lib/connection/`（新增 1 文件 · 328 行；改 5 文件）

| 文件 | 规模 | 作用 | 关键约束 |
|---|---|---|---|
| `candidates.ts` | **+328（新）** | 候选**装配**层：四道前置 → 内核 → **经 `discloseSubject()` 投影** | `evaluateCandidates` **不导出**（绕开它 = 绕开租户隔离）；`assertHasReason()` 不造假原因 |
| `field-catalog.ts` | +86 | 新增 `CANDIDATE` 档、`EXTERNAL_AUDIENCES`、`AUDIENCE_OPTIONS`（单一事实来源）、`CANDIDATE_PROFILE_AUDIENCE`；补**完整真相表**注释 | `auditCatalog` 新增两条一致性校验 |
| `disclosure.ts` | +13 | `DisclosureSummary.byAudience` 键集扩为三键；新增 `visibleToCandidate`（最窄）与 `visibleToCounterparty` | 三键齐全，缺一即类型错误 |
| `intents.ts` | +37 | `deriveIntentStatus` / `liveDisclosureOf` 入参收窄为 `Pick<...>`；`DisclosurePreview.preview` 扩为三档 | 收窄后调用方**不必**多查列，也不需要 `as` 断言 |
| `recall.ts` | +78/−? | 删掉上一刀的 `subject` 占位与 `CANDIDATE_PROFILE_AUDIENCE: null`；新增 `no_own_intent` 原因码；`CandidateMatch` / `CandidateResult` **去掉行类型泛型** | 内核产出与"传进来的行长什么样"彻底解耦 → 堵死"顺手把档案塞进候选"的便道 |
| `index.ts` | +40 | barrel 导出 `recall` 全部符号 + `listCandidates` / `listCandidatesByShareToken` + `CandidateList` / `CandidateView` | — |

### 2.3 API（新增 1 路由 · 45 行）

| 路由 | 能力 | 说明 |
|---|---|---|
| `src/app/api/v1/connections/candidates/route.ts` | `intent.read`（自助） | `GET ?missionId=&limit=`。**空候选不是错误** → 一律 `200` + `data.noCandidatesReason`；`data.profileAudience` **自描述**本次投影档位 |

选择 `intent.read` 而非 `mission.read`：本端点是"我的匹配"（读我与同任务成员的互补关系），
不是任务管理视图。权限之外还有一道**业务前置** —— 服务层要求"我在这条任务上有**生效中**的意图"，
没有提交意图的人拿不到任何候选。

### 2.4 前端（新增 1 页 · 244 行；改 3 文件）

| 文件 | 规模 | 说明 |
|---|---|---|
| `src/app/m/[token]/matches/page.tsx` | **+244（新）** | 候选页。**纯 RSC**（无 `'use client'`，避 hydration / `networkidle` 一整类不稳定）；无候选时给**确定性的原因文案**（四原因各有话说）；卡片展示"实际命中的词元"而非匹配度百分比 |
| `src/app/m/[token]/intent/intent-form.tsx` | +142/−? | 档位清单改为**服务端下发**（`audiences` prop），不再本地硬编码三项 → 新增档位时前端不会静默少一个开关；披露预览由两档扩为**三档**（organizer / candidate / counterparty），抽成 `PreviewGroup`；新增"诉求正文会展示给同任务参与者"的声明 |
| `src/app/m/[token]/intent/page.tsx` | +2 | 从 `field-catalog` 读 `AUDIENCE_OPTIONS` 并下发给表单 |
| `src/app/m/[token]/page.tsx` | +45/−? | 已加入成员显示 `/m/<token>/matches` **入口链接**；非成员显示空态说明（不再渲染 `candidatesAvailable` 文案） |
| `src/lib/connection/public-view.ts` | +30/−? | 澄清 `candidates: never[]` 是**永久**约束（匿名面结构性不披露），并把 `candidatesAvailable` 的语义改成"此投影有无候选" |

候选页**刻意没有"建立连接"按钮**：双边同意与联系方式交换是 T05。放一个点了没用的按钮
比放一句"下一步开放"更糟 —— 前者会让用户以为连接已经发出去了。

### 2.5 测试（新增 1 单测 · 377 行；新增 1 E2E · 235 行；改 4 文件）

| 文件 | 行 | 覆盖点 |
|---|---:|---|
| `tests/connection/candidates.test.ts` | **+377（新）** | 16 例。① 只返双向互补候选并附词元；② 被门控行只贡献计数；③ 🔴 投影用 `CANDIDATE` 且**自描述**；④ 🔒 候选只看到 `CANDIDATE` 档（`age` 授权 `COUNTERPARTY` → 键不存在）；⑤ 🔴 **值级泄露扫描**；⑥ 🔴 **变异自证**：把投影换成 `COUNTERPARTY`，`age` 就漏出来 → 证明档位没写反；⑦ 四原因码；⑧ 跨租户/草稿 404；⑨ 分享令牌入口非成员 → null |
| `tests/e2e/candidate-match.spec.ts` | **+235（新）** | 移动端（Pixel 5 + 真实 Chrome）3 例：匿名重定向；候选页渲染（依据/互补正文/档案可见集合/无横向滚动）；🔒 页面与 API 的**双重值级扫描** |
| `tests/connection/field-catalog.test.ts` | +57 | 档位**次序不变量**（`CANDIDATE` 最宽、已存在档位相对次序不动）、真相表断言、`CANDIDATE_PROFILE_AUDIENCE` 断言、`AUDIENCE_OPTIONS` 与声明一致 |
| `tests/connection/disclosure.test.ts` | +32 | `byAudience` 三键、`visibleToCandidate` 断言、🔒 可见集合**逐层包含**（候选⊆对手方⊆组织者，反向不成立） |
| `tests/connection/recall.test.ts` | +19/−? | "内核不持有档案"断言（返回键**恰好**是 `evidence/intentId/matchedTokens/userId`） |
| `tests/connection/intent-api.test.ts` | +88 | 披露预览改三档断言；新增 `T04 · GET /api/v1/connections/candidates` describe（401/400/400/200 + 值级扫描） |

夹具（**追加式**，与 T02 夹具正交）：

| 文件 | 行 | 说明 |
|---|---:|---|
| `scripts/qa/seed-t04-e2e.mjs` | **+314（新）** | 往同一隔离库追加：`peer`（双向互补，必须出现）、`noise`（无互补，必须排除）、`dormant`（WITHDRAWN，被门控）、`outsider`（非参与人，被门控）。**不删除任何东西** —— 不污染 T02/T03 两条 E2E 的初始态 |

---

## 3. 关键设计决策（与替代方案的取舍）

### 3.1 🔴 `CANDIDATE` 追加在**末尾**（而不是插在中间）—— 这是本刀最容易搞反的一处

**直觉是错的**。第一反应是"候选比对手方更早、更生疏，所以档位应该更窄，插在 `ORGANIZER` 与 `COUNTERPARTY` 之间"。
写下推导后发现**正好相反**：

记 `C` = 已同意的对手方集合，`P` = 同任务的互补伙伴集合。
**`C ⊆ P`** —— 任何对手方，在双方同意之前本来就是一名候选伙伴。
于是 `{组织者} ∪ C ⊆ {组织者} ∪ P`，即"给已同意者看" ⊂ "给伙伴看"。
**`CANDIDATE` 是更宽的那一档，必须追加在 `COUNTERPARTY` 之后。**

反证代价：若次序写反，`rank(granted) >= rank(viewer)` 会让
`rank(COUNTERPARTY) >= rank(CANDIDATE)` 成立 →
**尚未同意的人看到了用户只授权给已同意对手方的字段**。这是一次**静默的越权披露**：
没有任何报错、没有任何日志、界面一切正常，只有不该看到的人看到了字段值。

三层防护（缺一层都不够）：

1. `field-catalog.ts` 顶部写下**完整的真相表**（granted × viewer 的 ✓/✗ 矩阵），
   把"关键一格"（`COUNTERPARTY` 档对候选 = ✗）显式写出来；
2. `field-catalog.test.ts` 加**次序不变量**断言：`CANDIDATE` 必须最宽、已存在档位的相对次序不得变动；
3. `candidates.test.ts` 加**变异自证**：把候选投影的档位改成 `COUNTERPARTY` 后，`age` 必须漏出来 ——
   若这条断言在变异后仍然绿，说明用例是空转的。

### 3.2 候选装配**不在内核里**，投影**只在服务层**

`recall.ts` 删除上一刀的 `subject: {}` 占位后，**连"档案"这个概念都不出现**。
投影唯一发生在 `candidates.ts`，且必须显式调用 `discloseSubject(profile, live, 'CANDIDATE')`。

**为什么用"删除占位 + 删泛型"而不是"加注释提醒"**：注释会被忽略，类型不会。
内核返回类型去掉行类型泛型后，`c.row` 的其余字段在类型上就**取不到** →
想"顺手把 `row.need` 之外的档案字段塞进候选"会直接编译不过。

这条结构同时也是 **AC-03 在 T04 的落点**：T03 立下"披露唯一出口"的规矩，
T04 的检验方式就是**新开一条通道，看它是否也走那个出口**。

### 3.3 候选能看到什么：一条可审计的统一规则

规则：**候选只能看到「参与匹配的字段」+「经授权披露的档案字段」**。

- **`need` / `offer` 正文 → 给**：这两个字段存在的意义就是"被匹配"，不给的话候选页只剩几个词元，
  用户无法判断要不要建立连接。⚠️ 这是**明示**取舍：意图表单上写明了
  「我需要/我能提供会展示给同任务的参与者」（`intent-text-visibility`）。不得在没有那句声明的情况下上线。
- **`constraints` 约束 → 不给**：它是筛选口径（可能含内部判断，例如"不接受独家代理"），
  且**不参与匹配计算**。统一规则比"逐个字段争论要不要给"更好审计。
- **档案字段 → 经 `CANDIDATE` 档白名单投影**：未授权的键**不存在**。
- **被门控拒绝的行 → 只给原因码与计数**：否则"你已经被谁排除"本身就成了一条泄露。

### 3.4 分享令牌入口必须**二次校验成员关系**

`listCandidatesByShareToken` 走的是页面路径（`/m/<token>/matches`）。分享页与意图页的公开投影
**刻意不含 `missionId`**（内部标识不进 DOM），所以页面只能拿令牌来。
但令牌**只证明"拿到了链接"，不证明"是这个社群的人"** → 服务端必须回查 membership。
与 T03 的 `getMyIntentByShareToken` 同口径：草稿表现为"不存在"，非成员表现为"不存在"
（不区分 404 与 403，避免探测）。

### 3.5 无候选**必须给原因**，且原因分两层

服务层前置原因（`no_own_intent`）与内核管线原因（`no_other_intents` / `all_gated_out` / `no_reciprocal_overlap`）
分开，因为它们的**修复动作不同**：前者要"去提交诉求"，后者要"等人提交"或"等出现互补"。
页面为四个原因各写了一句具体的话，没有一个是"暂无数据"。

### 3.6 `assertHasReason` 用断言而不是 `?? '默认原因'`

`recall.ts` 的三个空返回分支**必然**附原因码，但 TS 看不到这个联系（声明类型是 `| null`）。
用 `?? '某个原因'` 会把"内核不变量被破坏"这种真问题**伪装成一次普通的空结果**。
因此改用断言：一旦为 `null`，宁可抛错，也不造一个假原因。

---

## 4. 与验收标准的对照

| 验收 | 落点 | 证据 |
|---|---|---|
| **AC-13** 双向检索（不是单向投递） | `recall()`：`myNeed∩theirOffer` 与 `theirNeed∩myOffer` **两侧都非空**才算候选 | `recall.test.ts`（单向命中 C 必须被排除）；E2E（非互补的 `noise` 不出现在页面/API） |
| **AC-13** 可解释排序（不输出伪造概率） | `explainCandidate()` 输出**实际命中的词元**；排序键 = 命中总数 → 侧向均衡 → `userId` 字典序 | `recall.test.ts`（固定测试集顺序完全确定、依据逐字断言、输出不含 `%|score|评分|匹配度`）；E2E（依据含 `你`/`对方`/命中原词） |
| **AC-13** 不伪造候选 | 无互补 → 空数组 + 原因码；被门控行只贡献计数 | `recall.test.ts`、`candidates.test.ts`、E2E（`considered === 2`、`gatedOut` 精确相等） |
| **AC-03** 未授权字段不进入输出 | 新通道**唯一出口** `discloseSubject(..., 'CANDIDATE')` | `candidates.test.ts`（键不存在 + 值级扫描 + 变异自证）；`intent-api.test.ts`；E2E（页面 HTML 与 API 响应双重扫描） |
| T03 交接约束「新通道必须经唯一出口」 | 内核删 `subject` 占位 + 删行类型泛型；投影只在 `candidates.ts` | `recall.test.ts` 的"内核不持有档案"断言 |

**未覆盖 / 明确不做**：

- **语义召回（pgvector）**：libSQL 不可用 → 一期只做**结构化过滤 + 词元互补**。
  这是**用户已确认的方向**（用户选 A 时同时确认"结构化召回先行"，M6 迁 PG 后再替换）。
  影响：同义不同词的诉求不会互相命中（"渠道" vs "通路"）。已在 `risks.md` R1 登记。
- **"建立连接"动作**：属 T05（双边同意、审批、撤销）。候选页**不放**该按钮。
- **向量索引 / Agent 上下文两条 AC-03 下游**：T04 只覆盖"API 响应"这条；另两条在 T09 有落点。

---

## 5. 已知的、必须写下来的坑

1. **档位次序 = 历史数据的可见性**。库里的 `disclosure` 文本存的是档位**名字**，
   理解这些名字的是 `DISCLOSURE_AUDIENCES` 的**数组次序**。次序一变（哪怕只是重排），
   **存量数据的可见性会静默漂移**，而且没有任何迁移能"顺便修好"它（因为库里存的是名字，不是序号）。
   → 新档位**只能追加在末尾**。
2. **前端不得再维护一份档位清单**。T03 已经因为"前端自己维护一份字段文案"吃过亏。
   本刀把 `AUDIENCE_OPTIONS` 提到 `field-catalog.ts` 并由服务端下发 —— 若前端硬编码三项，
   新增 `CANDIDATE` 时前端会**静默少一个开关**（表现为"字段明明可以开给伙伴，但界面不给开关"）。
3. **`page.evaluate` 里的同源 `fetch` 是最贴近用户视角的 API 断言方式**。
   用 Playwright 的 `request` fixture 需要手工搬运 cookie，与"这个页面自己会看到什么"隔了一层。
4. **E2E 的 `beforeAll` 必须预热 `/api/auth/login`**。本刀第一次跑 E2E 时 3 例中有 1 例失败，
   症状是"登录重试 3 次都拿不到 `session-token`" —— 看起来像鉴权坏了，
   实际是 dev 下该端点首次请求要现场冷编译。**漏掉这条预热会得到一次极具误导性的失败。**
5. **`considered` 的语义是"过了门控的行数"**，不是"候选数"，也不是"被检查的总行数"。
   它与 `gatedOut` 的计数**不互补**（`total = considered + Σ gatedOut.count` 才对）。
