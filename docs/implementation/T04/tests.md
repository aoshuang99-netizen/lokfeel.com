# T04 · tests — 测试与取证

> 基线 `e3bc161`。任务：双向检索与可解释排序。验收：**AC-13**（+ T03 留下的 **AC-03 新通道**交接约束）。

---

## 1. 汇总（可复跑）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | **exit 0**，0 条输出（全量，4m22s） |
| connection 套件 | `npx jest tests/connection` | **14 套件 / 290 测试全绿**（T03 收尾时为 286，本刀 +4） |
| 全量单测 | `npx jest` | **36 套件 / 669 测试全绿** |
| ESLint（T04 面） | `npx eslint src/lib/connection src/app/api/v1/connections src/app/m tests/connection tests/e2e/candidate-match.spec.ts scripts/qa/seed-t04-e2e.mjs` | **exit 0**，0 error 0 warning |
| 脚本声明门禁 | `npm run check:script-decls` | **45 个脚本，0 个未声明引用 → ✅** |
| 移动端 E2E | `npx playwright test -c playwright.t02.config.ts tests/e2e/candidate-match.spec.ts` | **3 passed（4.4m）** |
| 夹具自检（真实内核） | `npx tsx <一次性脚本>` 直接调 `buildCandidates` | 1 候选 / `considered=2` / `gatedOut` 精确匹配 |

---

## 2. 单测：`tests/connection/candidates.test.ts`（新增，16 例）

分层：**内核**（谁值得推荐）与**披露**（谁能看到什么）各自已有测试，
本文件专测**装配**——两者有没有接对，以及新通道有没有走唯一出口。

| # | 用例 | 断言要点 | 为什么必须有 |
|---|---|---|---|
| 1 | 只返**双向互补**候选，并附命中词元 | 候选 `userId` 集合 + `evidence` 两侧词元 | AC-13 的正面；单向命中必须被排除 |
| 2 | 被门控的行只贡献**计数** | `gatedOut` 精确相等；`GATED_MARKER` 标记串不出现在响应里 | 防"你已经被谁排除"变成一条泄露 |
| 3 | 🔴 投影档位**自描述** | `profileAudience === 'CANDIDATE'` | 让"用了哪一档"可被审计与负测，而不是去读代码猜 |
| 4 | 🔒 候选**只看到 `CANDIDATE` 档** | `age`（授权 `COUNTERPARTY`）**键不存在**；`displayName` 可见 | 档位方向的核心断言 |
| 5 | 🔴 **值级泄露扫描** | 响应 JSON 不含 `age` / `bio` / `email` 的**值** | 结构断言（键不存在）之外的第二道 |
| 6 | 🔴 **变异自证** | 把投影换成 `COUNTERPARTY` → `age` 必须漏出来 | 证明用例**不是空转**：如果换成错的档位仍然绿，这条用例等于没写 |
| 7 | 四个原因码各自语义 | `no_own_intent`（服务层）/ 其余三个（内核） | 无候选必须能说出口 |
| 8 | 跨租户 / 草稿任务 → 404 | 一律"不存在"，不区分 403 | 避免探测 |
| 9 | 分享令牌入口**非成员 → null** | 令牌只证明"拿到链接" | 二次校验成员关系 |

### 2.1 夹具缺陷（本刀修掉的一个"假绿"）

第一版夹具里 `ROW_E.need` 与 `ROW_B.need` 用了**相同的字符串**，
于是"响应不含被拒行内容"这条断言**永远成立**（因为要断的串本来就不该出现，而它出现了也不会被识别为"被拒行专属"）。
改为给被拒行一个独有标记串 `GATED_MARKER` 后，断言才有判别力。

> 教训：**"不存在"类断言的夹具里，必须有一个"只属于被拒对象"的哨兵值。**
> 否则用例绿得毫无意义，而它看起来和真绿一模一样。

---

## 3. 单测：`tests/connection/field-catalog.test.ts`（+57 行）

| 用例 | 断言 |
|---|---|
| 🔴 档位**次序不变量** | `CANDIDATE` 必须**最宽**；`SELF < ORGANIZER < COUNTERPARTY` 的相对次序**不得变动** |
| 真相表 | `audienceCanSee` 的 4×3 矩阵逐格断言，重点：`COUNTERPARTY` 档对 `CANDIDATE` viewer = **false** |
| `CANDIDATE_PROFILE_AUDIENCE` | 必须是 `ExternalAudience` 且 === `'CANDIDATE'` |
| `AUDIENCE_OPTIONS` 一致性 | 与 `DISCLOSURE_AUDIENCES` **逐值逐序**相等（缺一个 = 用户无从授权该档） |

**次序不变量为什么是"断言"而不是"注释"**：这是唯一一类"改错了也不报错"的缺陷 ——
存量数据里存的是档位**名字**，次序一漂移，可见性静默变化，没有迁移能修。

---

## 4. 单测：`tests/connection/disclosure.test.ts`（+32 行）

| 用例 | 断言 |
|---|---|
| `byAudience` 三键 | `{ORGANIZER, CANDIDATE, COUNTERPARTY}` 齐全 |
| `visibleToCandidate` | 只含 `CANDIDATE` 档的字段（**最窄**） |
| 🔒 可见集合**逐层包含** | 候选 ⊆ 对手方 ⊆ 组织者；**反向不成立**（有具体反例字段） |

---

## 5. 单测：`tests/connection/recall.test.ts`（+19 行）

| 用例 | 断言 |
|---|---|
| 🔴 内核**不持有档案** | 返回的候选键集**恰好**是 `['evidence','intentId','matchedTokens','userId']` —— 连 `subject` 这个键都不存在；整份响应不含邮箱形态的字符串 |

这条测的是**结构约束**：一旦有人"顺手"把投影塞回排序层，AC-03 的"单一出口"就失效了，
而那种改法在其他任何测试里都不会变红。

---

## 6. HTTP 层：`tests/connection/intent-api.test.ts`（+88 行）

新增 `describe('T04 · GET /api/v1/connections/candidates')`：

| 用例 | 期望 |
|---|---|
| 匿名 | **401** |
| 缺 `missionId` | **400**（不允许"给我全部候选"这种形状） |
| `limit=0` | **400**（非正整数） |
| MEMBER 自助 | **200**；`data.profileAudience === 'CANDIDATE'`；候选 `subject.displayName` 可见；`subject.age` 键**不存在**；响应 JSON 不含 `leak@example.test` 与 `'47'` |

同时把 T03 的披露预览断言由两档改为**三档**（organizer / counterparty / candidate），
并加"三档均不含 `email` 键"的断言。

**本刀修掉的测试文件缺陷**：新增 describe 引用了两个未定义的符号
（`connectionsCandidatesRoute` 未 import、`partFindMany` 未声明），4 例直接 `ReferenceError`。
这是**编辑只写了一半**的典型症状 —— 所以本刀收尾时对全量 jest 与 tsc 都重跑了一遍，
而不是只跑单个文件。

---

## 7. 移动端 E2E：`tests/e2e/candidate-match.spec.ts`（新增，3 例全绿）

配置 `playwright.t02.config.ts`：**Pixel 5 视口（393×851）+ 系统真实 Chrome**
（本机 Playwright 自带 chromium 在 macOS 13 不受支持）。

| # | 用例 | 取证内容 |
|---|---|---|
| 1 | 🔒 匿名访问 `/m/<token>/matches` | 重定向到 `/login` 且带上 `callbackUrl`；**不渲染任何候选卡** |
| 2 | ✅ 候选页渲染 | `match-card` **恰好 1 张**；依据含 `你`/`对方` 与命中原词（`清关`/`分销`）；互补正文双向都在（`分销渠道` / `清关与仓储`）；档案区含对方昵称/城市与**字段中文标签**；`matches-connect-coming` 可见；**无横向滚动**（`scrollWidth - clientWidth ≤ 1`） |
| 3 | 🔒 AC-03 双重扫描 | ① **页面 HTML** 不含 `bio` 值 / `email` / 非互补者与被门控者的昵称；② **API**：`profileAudience === 'CANDIDATE'`；`candidate.subject` 键集**恰好** `['city','displayName']`；`considered === 2`；`gatedOut` 精确等于 `[{code:'intent_not_active',count:1},{code:'not_participant',count:1}]`；响应 JSON 不含 `email`/`bio`/`age` 值；`subject.age` **键不存在** |

### 7.1 夹具：`scripts/qa/seed-t04-e2e.mjs`（新增）

**为什么单独开一个脚本**：`seed-t02-e2e.mjs` 的"每次从零开始"语义
（清空 `MissionParticipation` / `SocialIntent`）是 T02/T03 两条 E2E 的前提。
往里塞 T04 样本会同时改动三条用例的初始态 —— 一旦失败将无法判断是谁弄坏的。
因此 T04 的夹具**只做追加式 upsert，不删除任何东西**。

样本设计（全部落在 `mission_e2e_active`）：

| 样本 | 特征 | 期望 |
|---|---|---|
| `u_e2e_member` | 互补的发起方，自带 ACTIVE 意图 | 登录者本人 |
| `u_e2e_peer` | 与 member **互为 need/offer 镜像** | ✅ 必须出现，且恰好 1 条 |
| `u_e2e_noise` | 任务参与人但**无互补** | ❌ 排除（`considered` 里但不进候选） |
| `u_e2e_dormant` | 意图 **WITHDRAWN** | ❌ 硬门控 `intent_not_active` |
| `u_e2e_outsider` | 意图 ACTIVE 但**不是参与人** | ❌ 硬门控 `not_participant` |

`peer` 的披露表刻意**用满四个档位**：
`displayName: CANDIDATE` / `city: CANDIDATE` / `age: COUNTERPARTY` / `bio: ORGANIZER`
→ 候选页只能看到 昵称 + 城市。**若候选投影写成了 `COUNTERPARTY`，`age` 就会漏出来** ——
这正是"档位方向有没有写反"的端到端判据。

### 7.2 夹具自检（用**真实内核**验证文案，而不是复刻逻辑）

写夹具时最大的风险不是脚本语法，而是**文案不构成互补** —— 那种失败会伪装成"功能没实现"。
词元化规则是 CJK 2-gram + 拉丁 ≥3 字符，凭直觉写中文句子极易失手。

因此用一次性脚本直接调 `buildCandidates`（`recall.ts` 无依赖，可独立 import）跑通并断言：

```
我需,需要,要东,东南,南亚,亚的,的清,清关,关与,与仓,仓储,储伙,伙伴   ← member.need
我能,能提,提供,供东,东南,南亚,亚的,的清,清关,关与,与仓,仓储,储伙,伙伴 ← peer.offer
  交集 A = 东南,南亚,亚的,的清,清关,关与,与仓,仓储,储伙,伙伴        (10)
  交集 B = 印尼,尼本,本地,地的,的分,分销,销渠,渠道                  (8)
noise 交集 A/B = 空
candidates = u_e2e_peer(18)   considered = 2   gatedOut = intent_not_active:1, not_participant:1
```

两侧交集都非空 → 双向成立；`noise` 两侧交集都空 → 被排除。

### 7.3 E2E 跑通过程中的一次真实失败（值得记下来）

第一次运行：**2 passed / 1 failed**。失败的是第 2 例，断言是
「登录后 `session-token` 必须存在」→ **false**，而第 3 例（同样登录）却通过了。

根因：**我的 `beforeAll` 漏了 `/api/auth/login` 的预热**。
dev 模式下该端点首次请求要现场冷编译（实测 7-14s，本机更慢），
3 次登录重试全部落在编译窗口内 → 拿不到 cookie。

**为什么这个失败极具误导性**：症状是"鉴权坏了"，且**后一个用例又好了**
（因为模块已被前面的失败尝试编译完），非常容易被误判为"随机抖动"而去加重试次数 ——
那样只会把问题掩盖得更深。补上预热后 3/3 通过。

> 同源教训（T02/T03 都踩过）：**dev 下的 E2E 必须预热每一条会被首访的动态路由**，
> 包括登录端点自己。

---

## 8. 生产库状态

**本刀零 DDL**（见 `changes.md` §2.1）：新增枚举成员不产生任何 schema 差异，
`prisma migrate diff` 输出为空。因此**没有**需要上生产库的迁移，也没有回滚脚本。
生产库的现有数据完全不受影响（`disclosure` 里不可能出现 `CANDIDATE`，因为此前代码不认识这个值）。

应用层改动随代码发布生效，无需任何数据操作。

---

## 9. 未覆盖 / 遗留

| 项 | 状态 | 归属 |
|---|---|---|
| 语义召回（同义词命中） | ❌ 未做（结构化路径） | M6 迁 PG + pgvector |
| 向量索引 / Agent 上下文两条 AC-03 下游 | ❌ 在 T04 无落点 | T09 |
| "建立连接"（双边同意、联系方式交换） | ❌ 未做，候选页明确标注"下一步开放" | T05 |
| 真实双人互动的 E2E（两个账号互相看到对方） | ❌ 只做了"单账号看到互补伙伴" | T05/T12 |
| 性能（大任务下的候选规模） | ⚠️ 未做压测；`limit` 默认 50 | T12 |
