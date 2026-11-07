# 60 · D-12 收口：成员角色写路径 + 「至少一名管理员」不变量

> 结论：**代码已修并已上生产；生产 `default` 组织的管理员缺口也已修复。**
> D-12 的根因不是"数据脏"，而是「产品里没有任何入口能把一个人提成管理员」。
> 补齐写路径 + 不变量后，一个失去管理员的组织可以**自助**恢复：生产复验 8/8 PASS（§5）。

---

## 0. 本次落地清单（2026-11-07）

| 项 | 值 |
|---|---|
| 生产提交 | **`bc46a22`**（Netlify deploy `6aeeb9cd9574`，112s ready） |
| 生产漂移 | `prod-commit-drift`：落后 0 提交，`src` 差异 0 |
| 数据变更 | `default` 组织新增成员关系 `admin@lokfeel.com` → **ADMIN**（membership `8855e8c5…`） |
| 数据变更审计 | `TenantAuditEvent` · `membership.added` · `actorId=null` · `via=ops-script:org-admin-invariant` |
| 复检 | 全库 `check:org-admin`：default 3 成员 / 1 管理员 ✅，preview 2/2 ✅，**零违规** |

---

## 1. D-12 现场（`scripts/qa/org-admin-invariant.mjs`，2026-11-07 实测生产库）

```
数据库: 远端（Turso）

组织                     状态         成员 管理员 结论
default (org_de…)      ACTIVE        2      0   ❌ 零管理员
preview (757eee…)      ACTIVE        2      2   ✅
```

`default` 的两名成员是 `qa.male@lokfeel.com` / `qa.female@lokfeel.com`，角色都是 **OPERATOR**。
`preview` 的两名 ADMIN 是 `admin@lokfeel.com` / `test.female@lokfeel.com`。

后果不是抽象的：`agent.approve`（批准高风险产出）与 `outcome.verify`（结果核验）都在
`ADMIN_EXTRA` 里 —— **生产 `default` 组织里这两个能力无人可用**。
S3 的 B 段之所以能用 `--elevate` 跑通，恰恰是因为它临时提权；提权用完已回滚。

---

## 2. 根因（三层，缺一不可地都在）

| 层 | 事实 | 影响 |
|---|---|---|
| 产品 | 没有组织创建入口（Org 都是 seed 脚本造的） | 创建时"创建者=ADMIN"这条规则没有落点 |
| API | `/api/v1/members` **只有 GET**；`member.update_role` 能力早在矩阵里，但没有任何接口用它 | 管理员无法在站内认命第二名管理员 |
| 运维 | 没有体检脚本，也没人知道 `default` 少一名管理员 | 缺口只能靠"某次验证失败"偶然发现 |

一句话：**能力矩阵写了权限，但没有一条路径能行使它。** 这类"纸面权限"比没有权限更危险 ——
它让文档看起来是闭环的。

---

## 3. 修法：三层防线

### 3.1 纯判定（可穷举）

`src/lib/tenancy/member-roles.ts` 的 `planRoleChange()` —— 不看数据库，只吃
`actorRole / actorUserId / target / nextRole / activeAdminCount`，返回**显式拒绝码**：

| 码 | 状态 | 语义 |
|---|---|---|
| `CAPABILITY_REQUIRED` | 403 | 发起人没有 `member.update_role`（MEMBER / OPERATOR） |
| `INVALID_ROLE` | 400 | 目标角色不是枚举值 |
| `NO_CHANGE` | 400 | 新旧相同（"成功但没改"是谎报） |
| `OWNER_PROTECTED` | 403 | 非 OWNER 不能改 OWNER 的角色 |
| `OWNER_GRANT_FORBIDDEN` | 403 | 任何人不能通过 PATCH 授予 OWNER（走 `org.transfer`） |
| `SELF_ROLE_CHANGE` | 409 | 不能改自己的角色（自我降级与自我提权同罪） |
| `LAST_ADMIN` | 409 | 会把 ACTIVE 管理员数量降到 0 |

判定顺序是写死的（能力 → 取值 → 空操作 → OWNER 保护 → 授予 OWNER → 自我 → 最后一名管理员），
并有测试钉住"顺序不能靠巧合成立"（例如无能力 + 自我修改同时成立时必须报 403 而不是 409）。

### 3.2 同一事务内计数（这条才是承重结构）

`updateMemberRole()` 在 `db.$transaction` 里先 `findFirst`（带 `organizationId` 谓词）再
`count`（ACTIVE 且 role ∈ {OWNER, ADMIN}），然后才 `update`。

> 为什么必须在同一事务：两名管理员并发互相降级时，"计数 ≥ 2"会在两个事务里同时成立，
> 各自都放行 —— 结果留下 0 名管理员。纯函数只能把规则说清楚，防不住这个竞态。

跨租户的 `membershipId` → **404**（不是 403）：403 会泄露"这个 id 真实存在"。

### 3.3 写路径 + 界面

| 位置 | 内容 |
|---|---|
| `src/app/api/v1/members/[membershipId]/route.ts` | `PATCH`，`withTenant('member.update_role')` |
| `src/app/console/members/page.tsx` | 每行一个角色下拉，**只在 capabilities 含 `member.update_role` 时渲染**；OWNER 行不给控件 |
| `src/hooks/use-api.ts` | 新增 `useApiPatch()`：**把结果作为返回值**，不靠 `error` state（`await` 后读 state 会拿到上一次渲染的值 ⇒ 失败被显示成成功） |
| `scripts/qa/org-admin-invariant.mjs` | 体检 + 修复（默认只读），带 `--self-test` |

修复脚本刻意保守：默认**只提升该组织已有成员**；要把非成员的运维账号拉进来必须显式加
`--add-membership`（单独判定、单独审计 `membership.added`）。只设 ADMIN，不碰 OWNER；
写入后**回读校验**；同时写一条 `membership.role_changed` 审计
（`actorId=null`，`safeMetadata.via=ops-script:org-admin-invariant`）。

---

## 4. 验收证据（本轮实测）

| 项 | 结果 | 说明 |
|---|---|---|
| `jest tests/tenancy/member-roles` | **42/42 PASS** | 纯判定 30 + HTTP 层 12 |
| `jest tests/tenancy` | **187/187 PASS**（11 suites） | 未回归既有租户行为 |
| **负控（关键）** | 把 `activeAdminCount <= 1` 改成 `<= 0` → **2 条立刻红** | 证明 `LAST_ADMIN` 的测试真的在测它，不是"恰好通过" |
| `tsc --noEmit` | 0 错 | 含新 UI 与 hook |
| `eslint`（新增/改动文件） | 0 error，0 warning（新增部分） | `use-api.ts` 里 2 处 `any` 是既有的 |
| `npm run lint:gate` | **零新增**（债务下降 5、清零 17） | 逐文件 × 逐规则棘轮 |
| `node scripts/qa/org-admin-invariant.mjs --self-test` | **8/8 PASS** | 含四条负向：SUSPENDED / INVITED 的 ADMIN 不算、停用组织不报缺、空组织报缺 |
| `node scripts/check-script-decls.mjs` | 新脚本 0 未声明引用 | 另有 **8 个既有脚本**失败（浏览器全局误报），与本次无关、不在 CI |

---

## 5. 生产复验（`scripts/qa/verify-member-role-prod.mjs`，2026-11-07，部署后实测）

```
生产：https://app.lokfeel.com
  ✓ P01 匿名 → 401                       status=401
  ✓ P02 OPERATOR → 403                 status=403
  ✓ P03 改自己 → 409                      status=409 code=SELF_ROLE_CHANGE
  ✓ P04 授予 OWNER → 403                 status=403
  ✓ P07 非法角色 → 400                     status=400
  ✓ P05 降级 → 200                       status=200 回读 role=MEMBER（原 OPERATOR）
  ✓ P06 还原 → 200                       status=200 回读 role=OPERATOR
  ✓ P08 审计两条（去+回）                      样本=2 [{"from":"MEMBER","to":"OPERATOR"},{"from":"OPERATOR","to":"MEMBER"}]
8 PASS / 0 FAIL / 0 SKIP
```

三个值得单独说的点：

1. **P03 证明不变量在生产可达**：`SELF_ROLE_CHANGE` 不是单测里的分支，它在真实 HTTP 上被触发了。
2. **P05/P06 是"真写入 + 真还原"**：只动 QA 账号 `qa.female` 的角色，`finally` 里还原，
   跑完复检 `check:org-admin` 仍是 3 成员 / 1 管理员 —— **不留残留**。
3. **P08 直查库**：审计不是"代码里调了 `writeTenantAudit`"，而是两条记录真的躺在
   `TenantAuditEvent` 里，`from/to` 与请求一一对应。

`prod-smoke` 同时复跑：**15/15 PASS**（commit 匹配、支付仍关闭、核心 API 无 500、缓存头正确）。

⚠️ 一个执行时踩到的坑（已写进脚本注释）：`admin@lokfeel.com` 同时是 `preview` 的 ADMIN，
而 `resolveTenant()` 未指定租户时取「最早加入的 ACTIVE 成员关系」—— 对 admin 来说是 `preview`。
第一次跑因此全部 SKIP（"找不到目标行"）。修法是显式传 `?organizationId=<default 的 id>`。
**这条对任何"多租户下的运维脚本"都成立**：别假设账号的默认租户就是你想操作的那个。

---

## 6. 生产修复执行记录（方案 A）

| 步 | 命令 / 结果 |
|---|---|
| 演练 | `--apply --add-membership --dry-run` → `[dry-run] 将新建成员关系：admin@lokfeel.com 加入 default，角色 ADMIN` |
| 拒绝路径实测 | 不加 `--add-membership` → `拒绝：…不是组织 default 的成员。` `EXIT=3` |
| 执行 | `--apply --add-membership --org=default --user=admin@lokfeel.com` → `✅ … 角色 ADMIN（membership 8855e8c5-5ede-406e-abf7-9fcbecf76971）`，`复检：default 现有 1 名 ACTIVE 管理员` |
| 全库复检 | `check:org-admin` → default 3/1 ✅ · preview 2/2 ✅ · 零违规，`EXIT=0` |

为什么不是方案 B（提升 `qa.male`）：那会让 S3 B 段的 `OPERATOR 批准 → 403` 断言永久失效，
而且把审批权交给一个共享测试账号。`qa.male` 保持 OPERATOR 之后，
"同一个人不能既触发又批准"这条 AC-08 证据才继续可验。

> 脚本不做"猜你要什么"：非成员必须由人显式加 `--add-membership`。这条边界存在的意义
> 不是防误操作，而是防"运维脚本顺手把人塞进别人的组织"这种**没人会复核**的默认行为。

### 6.1 Console 视觉抽查（真实浏览器，非截图比对）

Playwright 缓存中的 headless-shell 版本与依赖不匹配（需要 1248，本机最高 1223），
`v204-visual-audit` 无法启动 —— 没有重装浏览器（~150MB 下载），改用既有 1223 二进制做**定向抽查**：

| 视口 | `scrollWidth` vs `innerWidth` | 角色下拉 |
|---|---|---|
| 360×800 | 360 = 360，**无横向溢出** | 每个非 OWNER 行一个，右缘不与邮箱重叠 |
| 1440×900 | 1440 = 1440 | 同上 |

截图人工复核：下拉框完整可见、无截断；页面无报错横幅。
**这不是 104 格全量视觉回归的替代**，只是确认本次新增控件没有把成员屏挤坏；
全量回归等浏览器缓存修复后补跑（记入 §7 未闭合）。

---

## 7. 仍然没做的（不美化）

| 项 | 状态 |
|---|---|
| 成员邀请（`member.invite`） | 仍未实现。能力在矩阵里，但流程（发信 + 接受链接 + 幂等）缺失 |
| 成员移除（`member.remove`） | 同上，另一个状态机切片 |
| 组织创建时自动 ADMIN | 无创建入口，规则无处落地；等组织创建接口出现时必须一并做 |
| 全量视觉/axe 回归 | `v204-visual-audit` 因 Playwright 浏览器缓存版本不匹配无法启动（需 1248，本机最高 1223）；本次以真实浏览器定向抽查（§6.1）代替，全量待补 |
| UI 的组织切换 | admin 默认租户是 `preview`；在 Console 里操作 `default` 的成员目前要靠显式 `organizationId` 参数，租户切换器对管理员多租户的覆盖待验证 |
| `ui-gallery.mjs` 里的明文 ADMIN 密码 | 与本文件无关但顺带发现：仓库里有 ``LokFeel@<已轮换>`` 字面量，应移入环境变量并轮换该密码 |
