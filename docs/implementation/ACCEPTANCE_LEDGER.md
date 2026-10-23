# ACCEPTANCE_LEDGER · 验收台账

> **本文件是生成物，不要手改。** 重新生成：`npm run ledger:acceptance`；一致性由 `npm run check:evidence` 强制。
>
> **真相源**：判定来自 `docs/implementation/v17/15_ACCEPTANCE_MATRIX_V17.md` 的逐行数据；
> 可复跑命令只存在于 `docs/implementation/v17/07_EVIDENCE_LENS.md`（本文件只给指针，不复制命令 ——
> 复制就会多一份会漂的副本）。
>
> **本文件没有时间戳，这是刻意的。** 「最后核验时间」用 `git log -1 -- <证据文件>` 取：
> 重新生成 ≠ 重新验证，给生成物盖一个"刚刚"的时间戳只会伪造新鲜度。

**台账基线**：`a2b96c55@15 · 1f905c4b@07`

---

## 1. 计数（由逐行数据重算，不是从汇总表抄的）

| 组 | 项数 | PASS | FAIL | BLOCKED | N/A | 完成度 |
|---|---|---|---|---|---|---|
| SEC（安全与隔离） | 8 | 8 | 0 | 0 | 0 | 100% |
| PAY（支付与订阅） | 10 | 7 | 0 | 3 | 0 | 70% |
| UX（十三屏与体验） | 12 | 9 | 0 | 3 | 0 | 75% |
| OPS（运维与可观测） | 8 | 5 | 0 | 3 | 0 | 63% |
| BIZ（商业与合规） | 4 | 0 | 0 | 4 | 0 | 0% |
| **合计** | **42** | **29** | **0** | **13** | **0** | **69%** |

> 「完成度」= (PASS + N/A) / 项数。**BLOCKED 不算完成**，也不折算成半分 —— 没验就是没验。

---

## 2. 逐条

| ID | 组 | 判据 | 判定 | 层级 | 证据 | 命令 | 失效形态 |
|---|---|---|---|---|---|---|---|
| SEC-01 | SEC | 多租户面上每个 org 模型查询都带租户谓词 | **PASS** | 代码 | `audit:tenancy --strict`，5 条白名单已登记并注明理由；`scanned===0` 直接 FAIL | `07 · SEC-01` | 新增一条不带 organizationId 谓词的 org 查询且未登记白名单 |
| SEC-02 | SEC | 多能力守卫不得"混入弱能力即放行" | **PASS** | 代码 | `withTenantAll/Any` 拆开；MEMBER 有 `org.read` 无 `mission.update` → 403；换… | `07 · SEC-02` | 把 `withTenantAll` 的 `every()` 改回 `some()` |
| SEC-03 | SEC | 授权必须可撤回（不能是单行道） | **PASS** | 代码 | 新增 `DELETE /api/im/consent`；`isRevoked` 此前**只读不写**，读取路径已过滤但无写入者 | `07 · SEC-03` | 删掉 `DELETE /api/im/consent` 或不写 `isRevoked` |
| SEC-04 | SEC | 隐私接口的对象只能来自会话 | **PASS** | 代码 | `GET.length===0` 结构性证据；`?userId=受害者` 仍只作用于本人（导出+删除各一条） | `07 · SEC-04` | 让导出/删除从 query 取 userId |
| SEC-05 | SEC | 不存在绕过租户谓词的写入口 | **PASS** | 代码 | 删 `withdrawFromMission`（零调用）；`compensate` 硬删补当事方谓词；3 处写操作补租户谓词 | `07 · SEC-05` | 新增 `update/delete` 只按 id 定位 |
| SEC-06 | SEC | 角色能力矩阵无断层（单调） | **PASS** | 代码 | MEMBER ⊆ OPERATOR ⊆ ADMIN ⊆ OWNER 逐能力断言 | `07 · SEC-06` | 给低角色加一条高档位才该有的能力 |
| SEC-07 | SEC | Webhook mock 旁路不得在生产生效 | **PASS** | 代码 | `isMock && !allowMock → 401`；配了真实 secret 后 mock 签名被拒（单测） | `07 · SEC-07` | 把 `!allowMock` 判断去掉，或让 mock 判断先于 secret 判断 |
| SEC-08 | SEC | 生产可达依赖无已知高危 | **PASS** | 代码 | CI `Dependency audit（生产可达 · 棘轮）` 绿；16→3 overrides | `07 · SEC-08` | 新增未登记的生产高危依赖，或让某条豁免过期 |
| PAY-01 | PAY | 未接入支付时给 503 + 稳定码，不伪装成 500/200 | **PASS** | 生产 | 分两种路径（`03` §2 逐条实测）：**公共**端点匿名即 503 —— `GET /api/payments/creem/produ… | `07 · PAY-01` | 任一入口返回 500，或返回 200 假装可用 |
| PAY-02 | PAY | 首购开通正确入账（金额/币种/归属） | **BLOCKED** | — | 需真实 checkout；缺 4 凭据 | `07 · PAY-02` | 拿到凭据后金额或归属仍错 |
| PAY-03 | PAY | 同一笔交易只入账一次（幂等） | **PASS** | 代码 | 同事件重放 `duplicate: true`；不同期续费键不同 | `07 · PAY-03` | 幂等键改回用订阅 id（第二期会被判重复） |
| PAY-04 | PAY | 续费必须入账（`subscription.paid`） | **PASS** | 代码 | 原实现**完全没处理**；现补上并以 `creem:tran:<tran_id>` 为键 | `07 · PAY-04` | 从 `KIND_BY_EVENT` 删掉 `subscription.paid` |
| PAY-05 | PAY | 乱序降级不得把已付费订阅打成逾期 | **PASS** | 代码 | 以 `stripeCurrentPeriodEnd` 为逻辑时钟；迟到 `past_due` → `ignored: 'stale'`，同… | `07 · PAY-05` | 去掉 `stripeCurrentPeriodEnd` 逻辑时钟判断 |
| PAY-06 | PAY | 事件目录完整，无永不可达的死分支 | **PASS** | 代码 | 17 条穷举；删 4 个 Stripe 词汇死分支；自证断言"真源码死分支=0" + 合成夹具证检测器仍有效 | `07 · PAY-06` | 在 route 里写回 `subscription.created` 这类 Creem 不存在的事件 |
| PAY-07 | PAY | 退款只翻原账单，不改订阅状态 | **PASS** | 协议 | `refund-e2e.mjs`（真实 SDK + 本地假 Stripe，5 场景 19 断言 + 变异） | `07 · PAY-07` | 退款时顺手把订阅置为 CANCELED |
| PAY-08 | PAY | 真实退款拿到网关回执 | **BLOCKED** | — | 无凭据、无真实交易 | `07 · PAY-08` | 拿到回执后金额或原交易键对不上 |
| PAY-09 | PAY | 订阅状态与权益发放一致 | **PASS** | 代码 | `isEntitled`：仅 ACTIVE/TRIALING 发权益；`paused` 有损映射到 PAST_DUE（宁可停权不白送） | `07 · PAY-09` | 把 PAST_DUE 也算作有权益（会白送） |
| PAY-10 | PAY | 三方对账（发票 / 账单 / 退款）一致 | **BLOCKED** | — | `03_PAYMENT_RECONCILIATION.md` 列 E1~E5 五项证据全缺 | `07 · PAY-10` | 有数据后对账出现差额 |
| UX-01 | UX | 无"点了没反应"的按钮 | **PASS** | 代码 | `check-ui-invariants` R1/R2，扫 49 文件 | `07 · UX-01` | 新增 `<button>` 既无 onClick 也无 disabled |
| UX-02 | UX | 未就绪能力 disabled 且有**具体**原因 | **PASS** | 代码 | R4；原因是具体句子，不是"敬请期待" | `07 · UX-02` | 写 `ready: false` 却不写 `reason` |
| UX-03 | UX | 三态渲染是真的（不拿空数组当成功） | **PASS** | 代码 | `Loadable` 统一三态；`tenantSource` 区分"仍在读"与"读失败" | `07 · UX-03` | 把 `null` 与 `[]` 合并成同一个分支 |
| UX-04 | UX | 计数不得把"读不到"显示成 0 | **PASS** | 代码 | `null` → `—`；`countHint` 说明口径；有单测 + 变异 | `07 · UX-04` | 用 `?? 0` 兜底 |
| UX-05 | UX | 文本对比度达 WCAG AA | **PASS** | 代码 | 5 板块 × 15 组全达标 | `07 · UX-05` | 调暗某个 `--lf-text-muted` |
| UX-06 | UX | 双世界切换不产生死色 | **PASS** | 代码 | 令牌作用域，对比度门禁覆盖两个世界 | `07 · UX-06` | 给组件传 theme 而不是用 `[data-lf-world]` 作用域 |
| UX-07 | UX | `prefers-reduced-motion` 降级 | **PASS** | 代码 | R11（新）：四档 `[data-lf-motion='0'/'1'/'3']` 存在且 L3 > L1 > 0、默认档落在 L1 与 L… | `07 · UX-07` | 删掉 `prefers-reduced-motion` 块，或把 L3 改成与 L1 同值 |
| UX-08 | UX | 移动端（<1024px）不溢出可操作 | **BLOCKED** | **行为** | V18-06（2026-10-22 收口）变成 CI 门禁，`3046f2b` 全绿（42 条）：**公开 6 路由 + 认证 9 屏 +… | `07 · UX-08` | 真实视口下出现横向溢出或触控目标过小 |
| UX-09 | UX | 界面与契约不脱节（枚举漂移） | **PASS** | 代码 | `verify:workspace-drift` 变异自证；本轮已修"从未进 CI" | `07 · UX-09` | 改枚举却不同步 `WorkspaceSpec` schema |
| UX-10 | UX | 不把假数据/示例当真实数据 | **PASS** | 代码 | R5 无假数据标识、R6 agent 节点必须有源 | `07 · UX-10` | 加 `mockData`，或让 agent 节点没有 `runs` |
| UX-11 | UX | 空态告诉用户下一步做什么 | **BLOCKED** | — | 有 `emptyText`，未逐屏实测 | `07 · UX-11` | 某屏空态只有"暂无数据" |
| UX-12 | UX | 十三屏在真实登录态下完整走通 | **BLOCKED** | **部分**（行为） | 2026-10-22 收口：CI 用隔离库自造账号（`seed-authed-e2e-user.mjs`）+ `global-setup.… | `07 · UX-12` | 某屏白屏或某个动作无响应 |
| OPS-01 | OPS | 站点是否活着能被自动发现 | **PASS** | 生产 | `uptime-probe` 打 4 个面；`uptime.yml` 每 20 分钟，失败即 job 红 | `07 · OPS-01` | 任一检查 FAIL，或探针自身崩掉 |
| OPS-02 | OPS | 探针本身不得恒绿 | **PASS** | 代码 | 自证 12 条：9 变异（503/慢库/状态错/Redis 降级/支付矛盾/非 JSON/空白页/越权 200/挂死）+ 1 负数对照 | `07 · OPS-02` | 删掉任一变异用例，或让 `probeAll` 忽略传入的 base |
| OPS-03 | OPS | 导出/删除有闸门，默认只看不动 | **PASS** | 代码 | `GET` 不执行；`apply` 只认 `1`（`0/yes/true/裸 apply` 均不执行）；`NotFoundError → … | `07 · OPS-03` | 把 `apply` 判定改成"非空即为真" |
| OPS-04 | OPS | 删除过程可断言、可对账 | **PASS** | 代码 | 返回 `plan/applied/cache`；`applied` 与 `plan.impact` 不一致须在报告注明 | `07 · OPS-04` | 只返回成功布尔值，不回影响面 |
| OPS-05 | OPS | 业务指标（注册/付费/失败率）可观测 | **BLOCKED** | — | 无指标存储，且当前无真实用户（基线会是编的） | `07 · OPS-05` | 接上后指标与 `billing:reconcile` 对不上 |
| OPS-06 | OPS | 错误追踪可用且已脱敏 | **BLOCKED** | — | Sentry 代码在，DSN 是否配置未确认；**无 `beforeSend` 脱敏** | `07 · OPS-06` | 事件里出现邮箱／userId 明文 |
| OPS-07 | OPS | CI 全绿可作发布前置 | **PASS** | 代码 | `f8dd997`：15 成功 / 2 跳过 / 0 失败（共 17 项） | `07 · OPS-07` | 任一 job 红，或有人把红 job 改成 `continue-on-error` |
| OPS-08 | OPS | 发布可回滚且回滚过 | **BLOCKED** | — | Netlify 有 rollback；本轮**未实际回滚验证** | `07 · OPS-08` | 回滚后 cookie／跳转因窗口期域名而失效 |
| BIZ-01 | BIZ | 客户能真的付钱（含大陆可达） | **BLOCKED** | — | `payments.configured=false`（缺 4 凭据）；Gumroad 大陆不可达（DNS 污染 + 12s 超时） | `07 · BIZ-01` | 配好凭据后大陆仍不可达 |
| BIZ-02 | BIZ | 退款政策唯一且合法 | **BLOCKED** | — | `/refunds` 写 **14 天**、`pay.html` 写 **7 天**，两处同时在线；已定临时仲裁（宽者优先=14 天），法… | `07 · BIZ-02` | 定了窗口但只改一处文案 |
| BIZ-03 | BIZ | 法律主体 / 数据控制者明确 | **BLOCKED** | — | `privacy@` `billing@` 背后是谁未定 ⇒ "我们会删除您的数据"在法律上没有承诺人 | `07 · BIZ-03` | 隐私政策承诺了却没有承诺人 |
| BIZ-04 | BIZ | 至少 1 个真实客户走通完整闭环 | **BLOCKED** | — | 无真实用户、无真实交易 | `07 · BIZ-04` | 有客户但卡在退款或删除请求上 |

---

## 3. 未验条目（BLOCKED）与解除条件

共 **13** 条。逐条解除条件以矩阵 §5 为准（本文件不复制，理由同上）。

| ID | 判据 | 卡在哪 |
|---|---|---|
| PAY-02 | 首购开通正确入账（金额/币种/归属） | 需真实 checkout；缺 4 凭据 |
| PAY-08 | 真实退款拿到网关回执 | 无凭据、无真实交易 |
| PAY-10 | 三方对账（发票 / 账单 / 退款）一致 | `03_PAYMENT_RECONCILIATION.md` 列 E1~E5 五项证据全缺 |
| UX-08 | 移动端（<1024px）不溢出可操作 | V18-06（2026-10-22 收口）变成 CI 门禁，`3046f2b` 全绿（42 条）：**公开 6 路由 + 认证 9 屏 + `/workspace` 六个页签**… |
| UX-11 | 空态告诉用户下一步做什么 | 有 `emptyText`，未逐屏实测 |
| UX-12 | 十三屏在真实登录态下完整走通 | 2026-10-22 收口：CI 用隔离库自造账号（`seed-authed-e2e-user.mjs`）+ `global-setup.ts` 真实登录产出 storageSt… |
| OPS-05 | 业务指标（注册/付费/失败率）可观测 | 无指标存储，且当前无真实用户（基线会是编的） |
| OPS-06 | 错误追踪可用且已脱敏 | Sentry 代码在，DSN 是否配置未确认；**无 `beforeSend` 脱敏** |
| OPS-08 | 发布可回滚且回滚过 | Netlify 有 rollback；本轮**未实际回滚验证** |
| BIZ-01 | 客户能真的付钱（含大陆可达） | `payments.configured=false`（缺 4 凭据）；Gumroad 大陆不可达（DNS 污染 + 12s 超时） |
| BIZ-02 | 退款政策唯一且合法 | `/refunds` 写 **14 天**、`pay.html` 写 **7 天**，两处同时在线；已定临时仲裁（宽者优先=14 天），法律适用需外部意见 |
| BIZ-03 | 法律主体 / 数据控制者明确 | `privacy@` `billing@` 背后是谁未定 ⇒ "我们会删除您的数据"在法律上没有承诺人 |
| BIZ-04 | 至少 1 个真实客户走通完整闭环 | 无真实用户、无真实交易 |

---

## 4. 这份台账守不住什么

1. **它不判断对错，只判断一致。** 矩阵写 PASS 而证据其实不成立时，台账照样显示 PASS；
   承重的是 `07` 里那条命令能不能跑红，不是本文件的数字。
2. **层级不升级。** 代码级 PASS 不会因为时间流逝变成生产级 PASS；要升级只能真跑一遍并改矩阵。
3. **BLOCKED 的解除条件不在本文件。** 它是矩阵 §5 的文本，台账只汇总「卡在哪」一句话。

_（42 条：29 PASS / 0 FAIL / 13 BLOCKED / 0 N/A）_
