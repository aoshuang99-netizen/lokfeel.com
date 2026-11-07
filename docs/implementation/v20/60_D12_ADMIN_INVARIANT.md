# 60 · D-12 收口：成员角色写路径 + 「至少一名管理员」不变量

> 结论：**代码已修，生产未改角色。** D-12 的根因不是"数据脏"，而是「产品里没有任何入口能
> 把一个人提成管理员」。补齐写路径 + 不变量后，一个失去管理员的组织可以**自助**恢复；
> 生产 `default` 组织目前仍是 0 管理员，修复需要指定"由谁担任"（见 §6，待裁决）。

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

修复脚本刻意保守：**只提升该组织已有成员**，绝不代人创建成员关系（那等于把人塞进别人的组织）；
只设 ADMIN，不碰 OWNER；写入后**回读校验**；同时写一条 `membership.role_changed` 审计
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

## 5. 仍然没做的（不美化）

| 项 | 状态 |
|---|---|
| 生产 `default` 的角色修复 | **未执行** —— 需指定"由谁担任管理员"，见 §6 |
| 成员邀请（`member.invite`） | 仍未实现。能力在矩阵里，但流程（发信 + 接受链接 + 幂等）缺失 |
| 成员移除（`member.remove`） | 同上，另一个状态机切片 |
| 组织创建时自动 ADMIN | 无创建入口，规则无处落地；等组织创建接口出现时必须一并做 |
| Console 角色下拉的视觉/axe 回归 | 未跑 `v204-visual-audit` / axe；本轮只经 tsc + eslint + 单测 |
| 生产端到端（真 HTTP 打 PATCH） | 未做 —— 端点未部署，部署后应补一条复验脚本 |

---

## 6. 生产修复待裁决（三选一）

| 方案 | 动作 | 代价 / 风险 |
|---|---|---|
| **A（推荐）** | 把 `admin@lokfeel.com` 加入 `default` 并给 ADMIN | 需要一个"新增成员关系"的显式开关（当前脚本拒绝代建）。收益：真实运维账号拿到审批权，QA 账号角色不变 |
| B | 把 `qa.male@lokfeel.com` 提升为 ADMIN | 改动最小，但**会破坏 S3 B 段的 403 断言**（OPERATOR 批准必须被拒），且审批权落在一个共享测试账号上 |
| C | 暂不动生产 | 代码与工具先落地；下次需要审批/核验时继续用 `--elevate` 临时提权并回滚 |

> 我的建议是 A：`default` 是真实客户会进入的租户，它的管理员应当是一个真实运维账号，
> 而不是 QA 人格；同时保持 `qa.male` 为 OPERATOR，S3 的"同一个人不能既触发又批准"才继续可验证。
