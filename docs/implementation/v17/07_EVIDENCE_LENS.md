# 07 · 证据透镜（Evidence Lens）

**产出**：2026-10-21 · WB17-07
**基线**：`abac5d8`
**配套门禁**：`node scripts/qa/verify-evidence-lens.mjs`（`npm run check:evidence` · 自证 `npm run verify:check:evidence`）
**它守的对象**：`15_ACCEPTANCE_MATRIX_V17.md` 的 42 条判定，以及 `00`–`06` 里的全部结论。

---

## 0. 为什么要有这份文档

验收矩阵已经写了 42 条 PASS / BLOCKED。那 25 条 PASS 现在是对的 ——
问题是**它们会腐烂**，而腐烂时不会有人告诉你。

三种已经在本仓发生过的腐烂：

1. **判据被搬走了，断言还在**。WB17-02 把 Creem 事件映射从 `route.ts` 的 `switch`
   搬进 `creem-events.ts` 的 `KIND_BY_EVENT`。`payment-credentials-apply.mjs`
   里的提取器仍按 `switch` 的形态抓事件名 ⇒ 抓到 **0 条**。它没有报错，
   它输出了"0 个未处理事件"—— 一个**恒真的空集**。
   更糟的是同一个提取器在**生产路径**上也读 0 条：照它配 webhook，一个事件都不会订阅。
2. **门禁从未接入**。`verify-workspace-spec-drift.mjs` 存在了很久，`ci.yml` 里
   零引用。脚本是绿的，门禁是**不存在**的。UX-09 的 PASS 因此在很长一段时间里没有承重。
3. **判定和证据脱钩**。`03` 原文写「7 个支付入口统一 503」。实测：公共端点匿名 503、
   需登录端点先撞 401、`GET checkout` 是 405。结论没错到离谱，但**照它去验会验错**。

所以这份文档不做总结 —— 它做**索引**：每条结论后面挂一条能当场跑的命令，
跑出来不是那个数，结论就该改。

> 这不是"补充说明"。这是让 `15` 里的每个字都有溯源。

---

## 1. 四条硬规则（由门禁强制）

`scripts/qa/verify-evidence-lens.mjs` 双向对照 `15` 与本文，违反任一条即 CI 红：

| # | 规则 | 为什么 |
|---|---|---|
| 1 | **双向集合相等**：`15` 的每条 ID 在本文都有行，本文不许有 `15` 没有的 ID | 单边检查会让"漏写一条"伪装成"没有这一条" |
| 2 | **判定必须一致**：同一个 ID 在两份文档里判定相同 | `15` 写 PASS、本文写 BLOCKED 是最典型的自欺 |
| 3 | **命令必须真实存在**：`npm run X` 的 X 在 `package.json` 里，脚本路径在盘上 | 指向一个不存在的脚本 = 比没有命令更坏，它看起来像有证据 |
| 4 | **BLOCKED 行不许给命令** | "跑一条会绿的命令"证明不了这条 ⇒ 那是假绿。没有判据就写 `—` |

另加两条软规则（同样判红）：

- 「期望输出」不得出现"应该 / 大概 / 基本 / 差不多 / 看起来 / 似乎"这类**无法机器判读**的措辞；
- 「失效形态」不得为空 —— 说不出"什么改动会让它变红"，说明这根本不是判据。

---

## 2. 怎么复跑

```bash
# 一次性跑完所有**离线**判据（约 40s，不联网、不连库）
npm run audit:tenancy && npm run check:ui-invariants && npm run verify:contrast \
  && npm run check:deps && npm run verify:uptime && npm run verify:payment:apply \
  && npm run check:evidence

# 需要真实生产（联网）
npm run probe:uptime
E2E_BASE_URL=https://app.lokfeel.com npm run verify:payment:off

# 只能 CI 跑（原因见下表）
npx jest <path>            # 本地 node_modules 缺 ts-jest，跑不起来
npm run qa:refund:e2e      # 同上（需要 stripe SDK 与假服务端）
npm run verify:workspace-drift   # 本地沙箱会 SIGTERM（exit 137），CI 绿
npm run audit:ux13 / audit:release  # 需要 Playwright + 生产 QA 账号（当前无账号 ⇒ 本身 BLOCKED）
```

**判据层级**写在「当前实测」列的第一段：`代码` / `生产` / `协议`。
层级不是"分数"，是**维度** —— 100 条 `代码` 证据也推不出 1 条 `真实` 证据。

---

## 3. 逐条透镜（42 行）

### 3.1 SEC · 安全与隔离（8 / 8 PASS）

| ID | 可被证伪的句子 | 复跑命令 | 期望输出 | 当前实测 | 失效形态 |
|---|---|---|---|---|---|
| SEC-01 | 多租户面上每个 org 模型查询都带租户谓词 | `npm run audit:tenancy` | exit 0，且「未登记 0 条」「baseline 失效 0 条」 | PASS · 代码 · 需人工判定 5 条／未登记 0 条／baseline 失效 0 条 | 新增一条不带 organizationId 谓词的 org 查询且未登记白名单 |
| SEC-02 | 多能力守卫不会"混入一个弱能力就放行" | `npx jest tests/tenancy/capability-semantics.test.ts` | 全绿，且含「换 Any → 200」的反向对照断言 | PASS · 代码 · CI 实测绿（本地缺 ts-jest） | 把 `withTenantAll` 的 `every()` 改回 `some()` |
| SEC-03 | 授权可撤回，不是单行道 | `npx jest tests/tenancy/consent-revocation.test.ts` | 全绿，且断言 `isRevoked` 有写入者 | PASS · 代码 · CI 实测绿 | 删掉 `DELETE /api/im/consent` 或不写 `isRevoked` |
| SEC-04 | 隐私接口的对象只能来自会话 | `npx jest tests/lifecycle/privacy-rights-api.test.ts` | 全绿，含 `GET.length === 0` 与 `?userId=受害者` 仍只作用于本人 | PASS · 代码 · CI 实测绿 | 让导出/删除从 query 取 userId |
| SEC-05 | 不存在绕过租户谓词的写入口 | `npm run audit:tenancy` | exit 0；写操作同样被扫 | PASS · 代码 · 未登记 0 条（含写路径） | 新增 `update/delete` 只按 id 定位 |
| SEC-06 | 角色能力矩阵单调（MEMBER ⊆ OPERATOR ⊆ ADMIN ⊆ OWNER） | `npx jest tests/tenancy/capability-semantics.test.ts` | 全绿，逐能力断言包含关系 | PASS · 代码 · CI 实测绿 | 给低角色加一条高档位才该有的能力 |
| SEC-07 | Webhook 的 mock 旁路在生产不生效 | `npx jest tests/billing/creem-webhook-matrix.test.ts` | 全绿，含「配了真实 secret 后 mock 签名被拒」 | PASS · 代码 · CI 实测绿 | 把 `!allowMock` 判断去掉，或让 mock 判断先于 secret 判断 |
| SEC-08 | 生产可达依赖无已知高危 | `npm run check:deps` | exit 0，无未登记豁免、无到期豁免 | PASS · 代码 · ASSERTIONS=1 通过 | 新增未登记的生产高危依赖，或让某条豁免过期 |

### 3.2 PAY · 支付与订阅（5 PASS / 5 BLOCKED）

| ID | 可被证伪的句子 | 复跑命令 | 期望输出 | 当前实测 | 失效形态 |
|---|---|---|---|---|---|
| PAY-01 | 未接入支付时给 503 + 稳定码，不伪装成 500/200 | `E2E_BASE_URL=https://app.lokfeel.com npm run verify:payment:off` | 18/18，且「本轮没有任何端点返回 500」 | PASS · 生产 · 18/18 通过 | 任一入口返回 500，或返回 200 假装可用 |
| PAY-02 | 首购开通正确入账（金额／币种／归属） | — | 需真实 checkout 与 4 个凭据 | BLOCKED · 缺 CREEM_API_KEY 等 4 键 | 拿到凭据后金额或归属仍错 |
| PAY-03 | 同一笔交易只入账一次 | `npx jest tests/billing/creem-events.test.ts` | 全绿，含同事件重放 `duplicate: true` | PASS · 代码 · CI 实测绿 | 幂等键改回用订阅 id（第二期会被判重复） |
| PAY-04 | 续费会入账（`subscription.paid`） | `npx jest tests/billing/creem-events.test.ts` | 全绿，含续费返回 `renew` 且键为 `creem:tran:` | PASS · 代码 · CI 实测绿 | 从 `KIND_BY_EVENT` 删掉 `subscription.paid` |
| PAY-05 | 迟到的降级事件不会把已付费订阅打成逾期 | `npx jest tests/billing/creem-events.test.ts` | 全绿，含 `isStaleDowngrade` 真/假两向断言 | PASS · 代码 · CI 实测绿 | 去掉 `stripeCurrentPeriodEnd` 逻辑时钟判断 |
| PAY-06 | 事件目录完整，无永不可达的死分支 | `npm run verify:payment:apply + npx jest tests/billing/creem-webhook-matrix.test.ts` | 自证 27/27；矩阵测试全绿；真源码死分支 0 | PASS · 代码 · 27/27 + CI 绿 | 在 route 里写回 `subscription.created` 这类 Creem 不存在的事件 |
| PAY-07 | 退款只翻原账单，不改订阅状态 | `npm run qa:refund:e2e` | 5 场景 19 断言全过 | PASS · 协议 · CI 实测绿（真实 SDK + 假服务端） | 退款时顺手把订阅置为 CANCELED |
| PAY-08 | 真实退款能拿到网关回执 | — | 需真实交易 + 凭据 | BLOCKED · 无凭据、无真实交易 | 拿到回执后金额或原交易键对不上 |
| PAY-09 | 订阅状态与权益发放一致 | `npx jest tests/billing/creem-events.test.ts` | 全绿，含 `isEntitled` 仅 ACTIVE/TRIALING 为真 | PASS · 代码 · CI 实测绿 | 把 PAST_DUE 也算作有权益（会白送） |
| PAY-10 | 三方对账（发票／账单／退款）一致 | — | 需 E1~E5 五项证据（见 `03`） | BLOCKED · 五项证据全缺 | 有数据后对账出现差额 |

### 3.3 UX · 十三屏与体验（8 PASS / 4 BLOCKED）

| ID | 可被证伪的句子 | 复跑命令 | 期望输出 | 当前实测 | 失效形态 |
|---|---|---|---|---|---|
| UX-01 | 没有"点了没反应"的按钮 | `npm run check:ui-invariants` | exit 0；R2 零命中 | PASS · 代码 · R1–R11 全绿 | 新增 `<button>` 既无 onClick 也无 disabled |
| UX-02 | 未就绪能力 disabled 且给了具体原因 | `npm run check:ui-invariants` | exit 0；R4 零命中 | PASS · 代码 · R4 零命中 | 写 `ready: false` 却不写 `reason` |
| UX-03 | 三态是真的（空数组 ≠ 仍在读） | `npx jest tests/living/adaptive-stages.test.ts` | 全绿，含「空数组与 null 必须区分」 | PASS · 代码 · CI 实测绿 | 把 `null` 与 `[]` 合并成同一个分支 |
| UX-04 | 计数不把"读不到"显示成 0 | `npx jest tests/living/adaptive-stages.test.ts` | 全绿，含「三个端点都没返回时计数全是 null」 | PASS · 代码 · CI 实测绿 | 用 `?? 0` 兜底 |
| UX-05 | 文本对比度达 WCAG AA | `npm run verify:contrast` | exit 0，5 板块 × 15 组全达标 | PASS · 代码 · 全部组合达到 WCAG AA | 调暗某个 `--lf-text-muted` |
| UX-06 | 双世界切换不产生死色 | `npm run verify:contrast` | 两个世界各自达标（令牌作用域，不是覆盖） | PASS · 代码 · 全部组合达标 | 给组件传 theme 而不是用 `[data-lf-world]` 作用域 |
| UX-07 | 动效四档（L0–L3）且系统偏好可强制降级 | `npm run check:ui-invariants + npm run verify:ui-invariants` | R11 零命中；2 条变异均被捕获 | PASS · 代码 · R11 全绿 + 2 变异被捕获 | 删掉 `prefers-reduced-motion` 块，或把 L3 改成与 L1 同值 |
| UX-08 | 移动端（<1024px）不溢出且可操作 | — | 需真浏览器 + 生产登录态 | BLOCKED · 无 Playwright 账号态验证 | 真实视口下出现横向溢出或触控目标过小 |
| UX-09 | 界面与契约不枚举漂移 | `npm run verify:workspace-drift` | 变异后 exit 1，还原后 exit 0 | PASS · 代码 · CI 实测绿（本地沙箱 SIGTERM 137） | 改枚举却不同步 `WorkspaceSpec` schema |
| UX-10 | 不把假数据／示例当真实数据 | `npm run check:ui-invariants` | exit 0；R5/R6 零命中 | PASS · 代码 · R5/R6 零命中 | 加 `mockData`，或让 agent 节点没有 `runs` |
| UX-11 | 空态告诉用户下一步做什么 | — | 需逐屏实测（有 `emptyText` 但未验） | BLOCKED · 未逐屏实测 | 某屏空态只有"暂无数据" |
| UX-12 | 十三屏在真实登录态下完整走通 | — | 需生产测试账号 | BLOCKED · 无 QA 账号，且不得用真实客户数据 | 某屏白屏或某个动作无响应 |

### 3.4 OPS · 运维与可观测（4 PASS / 4 BLOCKED）

| ID | 可被证伪的句子 | 复跑命令 | 期望输出 | 当前实测 | 失效形态 |
|---|---|---|---|---|---|
| OPS-01 | 站点是否活着能被自动发现 | `npm run probe:uptime` | exit 0；4 项检查无 FAIL | PASS · 生产 · health/landing/pay/auth 全非 FAIL（health 为 WARN 冷启动 11175ms） | 任一检查 FAIL，或探针自身崩掉 |
| OPS-02 | 探针本身不得恒绿 | `npm run verify:uptime` | 12/12，含 9 条变异 + 1 条负数对照 | PASS · 代码 · 12/12 通过 | 删掉任一变异用例，或让 `probeAll` 忽略传入的 base |
| OPS-03 | 导出／删除有闸门，默认只看不动 | `npx jest tests/lifecycle/privacy-rights-api.test.ts` | 全绿，含 `apply=0/yes/true/裸 apply` 均不执行 | PASS · 代码 · CI 实测绿 | 把 `apply` 判定改成"非空即为真" |
| OPS-04 | 删除过程可断言、可对账 | `npx jest tests/lifecycle/privacy-rights-api.test.ts` | 全绿，含 `plan/applied/cache` 三字段断言 | PASS · 代码 · CI 实测绿 | 只返回成功布尔值，不回影响面 |
| OPS-05 | 业务指标（注册／付费／失败率）可观测 | — | 需指标存储 + 真实流量基线 | BLOCKED · 无指标存储，当前无真实用户（基线会是编的） | 接上后指标与 `billing:reconcile` 对不上 |
| OPS-06 | 错误追踪可用且已脱敏 | — | 需确认 DSN 并补 `beforeSend` | BLOCKED · DSN 未确认，且**无 `beforeSend`** | 事件里出现邮箱／userId 明文 |
| OPS-07 | CI 全绿可作发布前置 | `curl -s https://api.github.com/repos/aoshuang99-netizen/lokfeel.com/commits/abac5d8/check-runs` | `total_count=17`，failure 与 cancelled 均为 0 | PASS · 代码 · 15 成功／2 跳过／0 失败（abac5d8） | 任一 job 红，或有人把红 job 改成 `continue-on-error` |
| OPS-08 | 发布可回滚，且回滚过 | — | 需在 Netlify 真回滚一次再前滚 | BLOCKED · 本轮未实际回滚 | 回滚后 cookie／跳转因窗口期域名而失效 |

### 3.5 BIZ · 商业与合规（0 PASS / 4 BLOCKED）

| ID | 可被证伪的句子 | 复跑命令 | 期望输出 | 当前实测 | 失效形态 |
|---|---|---|---|---|---|
| BIZ-01 | 客户能真的付钱（含大陆可达） | — | 需 4 凭据 + 大陆可达通道 | BLOCKED · `payments.configured=false`；Gumroad 大陆 DNS 污染 | 配好凭据后大陆仍不可达 |
| BIZ-02 | 退款政策唯一且合法 | — | 需先定 7 天或 14 天 | BLOCKED · `/refunds` 写 14 天、`pay.html` 写 7 天，两处同时在线 | 定了窗口但只改一处文案 |
| BIZ-03 | 法律主体／数据控制者明确 | — | 需确定主体与联系人 | BLOCKED · `privacy@`／`billing@` 背后无主体 | 隐私政策承诺了却没有承诺人 |
| BIZ-04 | 至少 1 个真实客户走通完整闭环 | — | 需真实客户 | BLOCKED · 无真实用户、无真实交易 | 有客户但卡在退款或删除请求上 |

---

## 4. 会假绿的 11 种情形（都是本仓真踩过的）

这一节比上面 42 行更重要 —— 因为上面的表只能防"忘了记"，防不了"记了但记错"。

| # | 形态 | 本仓实例 | 现在的防线 |
|---|---|---|---|
| 1 | **空集恒真** | 提取器读到 0 条事件 → 报"0 个未处理事件" | 断言"非空"先于断言"内容"；`scanned===0` 直接 FAIL |
| 2 | **夹具即真相源** | 用真 route 源码当夹具证明"能识别死分支"，死分支删掉后夹具变空 | 拆成"真源码断言清零" + "合成夹具断言检测器仍有效" |
| 3 | **门禁没进 CI** | `verify:workspace-drift` 存在但 `ci.yml` 零引用 | 已进 test job；本文每条命令都可被门禁反查存在性 |
| 4 | **只改宽松的一侧** | 断言过期时把 `toEqual` 改成 `toMatchObject` | 改断言必须**更强**：钉住完整谓词，而不是放宽 |
| 5 | **证"能跑"当"证"对""** | probe 自证里 `probeAll()` 没透传 base，实际一直在打生产 | 自证必须有负数对照（喂坏输入**必须**红） |
| 6 | **`grep` 静默失效** | 本仓某些文件 `grep` 无输出，看起来"没命中" | 涉及源码断言改用 `node -e` 读文件 |
| 7 | **工具被杀当成通过** | `npx eslint` 被杀（exit 1、输出空、137）被读成"通过" | 用 `node node_modules/eslint/bin/eslint.js`；`cmd >log 2>&1; echo $?` 取真码 |
| 8 | **假指标** | `/api/health` 的 `cache.hitRate` 恒 `0/0` | 该字段不进任何判据；见 `05` §6 |
| 9 | **窗口期判据** | 发版后约 20 分钟 `request.url` 是部署域名，跳转丢 cookie | 一律经 `public-origin.ts`；`verify:public-origin` 专测 |
| 10 | **枚举里的块注释打穿守卫** | schema 漂移守卫只过滤 `//`，把 `/** */` 读成一个取值 | 守卫先整段剔 `/* */`；schema 一律用 `//` |
| 11 | **中断即污染** | 漂移守卫被 SIGKILL 两次，把 `schema.ts` 留在变异态 | 落盘快照 + 启动自愈；R11 改用**副本 + 环境变量**，真实文件零改动 |

---

## 5. 本轮复跑录（2026-10-21，逐条真跑）

| 命令 | 结果 |
|---|---|
| `npm run audit:tenancy` | exit 0 · 需人工判定 5 条／未登记 0 条／baseline 失效 0 条 |
| `npm run check:ui-invariants` | exit 0 · R1–R11 全绿（新增 R11） |
| `npm run verify:ui-invariants` | exit 0 · 11 条变异 + 5 个 scope + R11 的 2 变异 1 对照全部被捕获 |
| `npm run verify:contrast` | exit 0 · 全部组合达到 WCAG AA |
| `npm run check:deps` | exit 0 · ASSERTIONS=1 |
| `npm run verify:uptime` | exit 0 · 自证 12/12 |
| `npm run verify:payment:apply` | exit 0 · 27/27 |
| `npm run probe:uptime`（生产） | exit 0 · health WARN（冷启动 11175ms → 1319ms）／landing 670ms／pay-surface 582ms／auth-guard 307 |
| `E2E_BASE_URL=… npm run verify:payment:off`（生产） | exit 0 · 18/18 |
| `curl …/commits/abac5d8/check-runs` | total 17 · success 15 · skipped 2 · failure 0 |
| `node scripts/qa/verify-evidence-lens.mjs` | exit 0 · 42 条双向对齐 |

**没跑的三类，以及为什么**：

- `npx jest <path>`：本地 `node_modules` 缺 `ts-jest`，只能由 CI 跑（`Test (Jest)` job 绿即等价）。
- `npm run verify:workspace-drift`：本地沙箱 SIGTERM（exit 137），CI 绿。
- `npm run audit:ux13` / `audit:release`：需要 Playwright + 生产 QA 账号，当前无账号 ⇒ 它们本身是 UX-08/12 的 BLOCKED 原因。

---

## 6. 这份透镜自身的失效条件

诚实写出来，因为它是全篇最容易被忽略的：

1. **它只能守"有没有"，守不了"对不对"**。命令存在、能跑绿，但判据本身可能在测一件无关的事。
   §4 那 11 条是人工纪律，门禁管不到。
2. **`当前实测` 列是快照**。它是 2026-10-21 的值，会过期。门禁不校验这一列是否仍成立
   （那需要联网 + 凭据，CI 每次跑全部 42 条不现实）。
   ⇒ **规则**：改动上述任一被引用文件时，必须重跑对应命令并更新这一列。
3. **BLOCKED 行是零证据**。17 行 `—` 不是"待办清单"，是"这里什么都没验"。
   它们占 42 条的 40% —— 这个比例本身就是结论。
4. **命令可被"合法地绕过"**：`LF_MOTION_CSS` 这类环境变量覆盖是给变异自证用的。
   如果有人拿它指向一个自己写的假 CSS，R11 依然会绿。
   防线是"CI 跑默认路径"这个约定，不是代码。

---

## 7. 维护规则

- **新增一条验收条目** ⇒ 必须同时在本文加一行，否则 `npm run check:evidence` 红（规则 1）。
- **改变一条判定** ⇒ 两份文档一起改，否则红（规则 2）。
- **删掉一个脚本 / 改脚本名** ⇒ 本文对应行的命令会解析失败，红（规则 3）。
- **一条还没法验** ⇒ 写 `—` + 说清缺什么。**不许借一条会绿的相邻命令充数**（规则 4）。

> 一句话：这份文档的价值不在它写了什么，而在**它说了哪些话是没证据的**。
> 42 条里 17 条写着"什么都没验"—— 那 17 行才是它最诚实的部分。
