# 04 · 会话生命周期与授权边界（Batch 3）

> 结论先行：**24 条断言，22 PASS / 0 FAIL / 0 SKIP / 2 NOT_TESTED。**
>
> 但这一轮真正的产出不是那 22 个绿点，而是**两个"功能根本不存在"的缺口**：
>
> 1. **产品没有登出。** 全仓 `grep -rn "signOut|登出|退出登录" src` 返回 **0 条**。
>    Auth.js 自带的 `/api/auth/signout` 在本仓走不通（实测 `302 → /login?error=MissingCSRF`
>    且不下发任何 `set-cookie`）。共享设备上换人只能清浏览器数据。
> 2. **多社群用户看不到第二个社群。** `resolveTenantForUser()` 无参时按
>    `createdAt asc` 取第一条，而 Console 七屏的服务端布局直接调它 ——
>    `listTenants()` 的注释写着「租户切换器用」，但那个切换器从未被写出来。
>
> 这两条都不是"测试脚本没覆盖"，是**用户点不到**。本轮把它们补上了
> （`/api/auth/logout`、`/api/v1/organizations/active` + 两套骨架的入口），
> 并用在线断言证明可用。
>
> 第三个产出是一条被**量化**出来的安全事实：**凭据撤销不是即时的，上界是 90s**
> （60s 用户缓存 TTL + 0–30s 随机抖动）。改密码后，被盗的旧会话最多还能用 90 秒。
> 这个数字以前没人测过，也没人写下来。

---

## 0. 基线与口径

| 项 | 值 |
| --- | --- |
| 代码 SHA（Batch 3 起点） | `3e27f3c`（Batch 2 提交）+ 本轮改动（见 §8） |
| 运行形态 | `next build` 产物 + `next start -p 3111`（生产构建，非 dev） |
| 数据库 | 生产 Turso 库（`DATABASE_URL` 直连，脚本内含 DB 直查） |
| 复验脚本 | `scripts/qa/v205-auth-session.mjs` → `npm run verify:auth:session` |
| 浏览器 | 不涉及（纯 HTTP + DB；OAuth 形状与 UI 由另外两个脚本覆盖） |
| OAuth 形状证据 | `scripts/qa/v204-oauth-shape.mjs`（对生产 `app.lokfeel.com` 跑，21/21） |
| 原始日志 | `docs/implementation/v20/ga/evidence/2026-11-07_auth-session_local.log` |

复验命令与退出码：

```
$ node scripts/qa/v205-auth-session.mjs --base=http://localhost:3111
22 PASS / 0 FAIL / 0 SKIP / 2 NOT_TESTED / 0 BLOCKED
exit=0
```

---

## 1. 交付物（先写代码，再写报告）

### 1.1 登出：`POST /api/auth/logout`

`src/app/api/auth/logout/route.ts`（新增）+ `src/components/auth/sign-out-button.tsx`（新增）

四条设计决定，每条都有具体理由：

1. **不用 Auth.js 的 `/api/auth/signout`。** 探测脚本
   `scripts/qa/_probe-signout.mjs` 的原始输出是决定性证据：

   ```
   LOGIN 200 ["authjs.session-token=eyJ..."]
   CSRF  200 {"csrfToken":"358ef0ed..."}
   SIGNOUT[form] status=302 location=http://localhost:3111/login?error=MissingCSRF
   set-cookie count 0
   ```

   即：只带会话 cookie 时它**跳转到错误页且什么都没清**。前端若照此实现，
   会得到一个"看起来跳走了、其实没登出"的假成功 —— 最难排查的那类缺陷。
2. **两个 cookie 名都清。** 会话 cookie 名按公开 origin 的协议判定
   （http → `authjs.session-token`，https → `__Secure-authjs.session-token`），
   浏览器 jar 里可能同时残留两种（先在预览域名登录、再上生产）。
   只清当前协议那个会留下另一个。
3. **同源校验。** 复用 `/api/auth/login` 的 `isSameSiteRequest` / `resolveSiteHosts`，
   不另写第三套判定。登出被 CSRF 利用是低危（把用户踢下线），但既然判定函数已有，
   没有理由不加 —— S23 证明跨源请求返回 403 且**不下发**清 cookie。
4. **顺手清租户软偏好**（`lf-active-org`）。它不是凭据，但同样是痕迹：
   同一台机器换人后，下一个人不该继承上一任"我在看哪个社群"的选择。

### 1.2 组织切换：`POST /api/v1/organizations/active`

`src/lib/tenancy/active-org.ts`（新增）+ `src/app/api/v1/organizations/active/route.ts`（新增）
+ `src/components/console/org-switcher.tsx`（新增）

核心约定是一句话：**cookie 决定"看哪个"，memberships 决定"能不能看"。**

| 层级 | 载体 | 语义 | 失效时 |
| --- | --- | --- | --- |
| 硬选择器 | `?organizationId=` | 指定了就**必须**是成员，否则 403 | 报错（不回落） |
| 软偏好 | cookie `lf-active-org` | 用户上次的选择 | **静默回落默认租户** |
| 默认 | 最早加入的 ACTIVE 成员关系 | 无偏好时 | — |

为什么软偏好失效必须回落而不是 403：被移出某个社群后，浏览器里的 cookie 仍是那个社群。
若在此处拒绝，用户会**永久**打不开 Console（除非手动清 cookie）—— 一个陈旧的 UI
偏好不该具备"锁死账号"的权力。回落时**不写** `tenant.access_denied` 审计，
否则被移出者每刷一页就产生一条假安全事件（`resolveTenantForUser` 为此新增
`auditDenied` 选项）。

### 1.3 两套骨架都接上了入口

- Console 七屏（`src/app/console/console-shell.tsx`）：登出按钮 + 行二「当前社群」切换器
  （`tenants.length >= 2` 才渲染 —— 一项的下拉是空控件，与 AC-18 同类）。
- Workspace 六屏（`src/components/living/living-shell.tsx`）：登出按钮，
  窄屏只留图标（44px 触达区），文字在 `lg` 才出现。
- 启动期发现的一处顺带修正：`src/app/console/layout.tsx` 从 `resolveTenantForUser`
  换成 `resolveActiveTenant`，否则切换器写了 cookie 但布局不读它，**切了等于没切**。

---

## 2. 断言表（S01–S24）

所有断言都同时看 HTTP 与（必要时）数据库。「证据」列是可复核的判据，不是结论词。

| ID | 断言 | 判据 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| S01 | 匿名 → 401 | 无 cookie 请求 `/api/v1/org` | PASS | `status=401` |
| S02 | 登录 → 200 + 会话 cookie | `Set-Cookie` 含 `session-token` | PASS | `status=200 cookie=有` |
| S03 | cookie 属性 | `HttpOnly` + `SameSite=Lax/Strict` | PASS | `HttpOnly=true SameSite=lax` |
| S04 | `/api/auth/session` 与库一致 | session 的 user.id == DB 的 user.id | PASS | `sessionUser=ca6b5219-8 dbUser=ca6b5219-8` |
| S05 | 会话有效期有上界 | `Max-Age` ∈ [6d, 8d] | PASS | `Max-Age=604800s`（7 天） |
| S06 | 滑动续期 | 需跨 `updateAge` 窗口 | **NOT_TESTED** | 见 §5.1 |
| S07 | 有效会话可反复使用 | 连续请求仍 200 | PASS | `status=200` |
| S08 | `tokenVersion+1` → 旧 JWT 失效 | 轮询到 401（上界 60s+30s 抖动） | PASS | **失效延迟 ≈ 61.4s** |
| S09 | 还原 `tokenVersion` → 旧 JWT 重新被接受 | DB 已还原 + 轮询到非 401 | PASS | `DB还原=true 复效=94.5s` |
| S10 | 登出 → 200 且会话 cookie 被清 | 200 + 每个 `session-token` cookie 均 `=;` 且 `Max-Age=0` | PASS | `清了 2 个 session-token cookie` |
| S11 | 登出后（浏览器视角 jar）→ 401 | 用清后 jar 请求 | PASS | `status=401 cookie=已空` |
| S12 | 手工重放登出前 cookie → 仍可用 | 用旧 jar 请求 | PASS | `status=200`（无状态 JWT 边界） |
| S13 | 列出我的组织 ≥2 | `GET /api/v1/organizations` | PASS | `count=2`（preview / default） |
| S14 | 显式 `organizationId` → 各自成员目录 | 两个租户均 200 且 total 不同 | PASS | `preview=200(2) default=200(3)` |
| S15 | 切换社群 → 无参请求解析到新租户 | POST 200 + 后续 `GET /api/v1/org` 的 slug == 目标 | PASS | `default=preview → target=default → 实际=default` |
| S16 | 切回原租户 | 同上，反向 | PASS | `slug=preview` |
| S17 | 切到"我不是成员的租户" → 403 且不写 cookie | 403 + 无 `lf-active-org` 下发 | PASS | `status=403 code=PERMISSION_DENIED cookie写入=false` |
| S18 | 非法 id 形状 → 400（不进查询） | `organizationId="x' OR 1=1 --"` | PASS | `status=400 code=INVALID_ORGANIZATION_ID` |
| S19 | 角色降级后同一会话能力立即收缩 | 差集非空 + **无新增** + 失去 `member.read` | PASS | `before=19 after=9 失去=10 项 新增=[]` |
| S20 | 还原角色后能力恢复 | 与降级前**集合相等** | PASS | `caps=19/19 集合相等=true` |
| S21 | 登录：跨源 Origin → 拒绝 | `Origin: evil.example.com` | PASS | `status=403` |
| S22 | 登录：无 Origin/Referer → 拒绝 | 裸 POST | PASS | `status=403` |
| S23 | 登出：跨源 Origin → 403 且不下发清 cookie | 403 + 无 `session-token=;` | PASS | `status=403 下发清cookie=false` |
| S24 | Google OAuth 成功回调 | 需真实 secret + 真人同意 | **NOT_TESTED** | 见 §5.2 |

S19 的差集（这是"权限矩阵真的在生效"的形状，不是"少了个字段"）：

```
失去 = member.read, mission.read, mission.create, mission.update, mission.delete,
       proposal.create, billing.read, workflow.read, agent.run, agent.execute   （10 项）
新增 = []                                                                      （0 项）
```

即 OPERATOR(19) → MEMBER(9)，而 MEMBER 仍保有 9 项自助能力（`org.read` / `intent.*` /
`proposal.read|decide` / `outcome.read|report` / `bridge.read|optin`）——
降级不是"什么都干不了"，是**只掉运营能力**。

---

## 3. 三处判据是我写错的（不是产品缺陷）

这一节必须留着。首跑 13 PASS / 4 FAIL，四条红的**没有一条是产品 bug**，
全部是我的断言在断一个不存在的性质。如果当时的做法是"把断言放宽到能过"，
这一轮就会漏掉 S08 那个 90s 上界的真实发现。

### 3.1 原 S07「还原 tokenVersion 后旧 JWT 立即复效」

- 原判据：还原后立刻请求 `/api/v1/org` 期望 200。
- 实测：401。
- 真因（两层）：① `requireAuth()` 有 60s 的 `authUser` 缓存，撤销那一刻缓存里是
  `v0+1`，还原后缓存仍是 `v0+1`，于是"版本不等即拒"继续成立；
  ② 该账号（`e2e-test@lokfeel.com`）只有一个 **SUSPENDED** 成员关系，
  `/api/v1/org` 无论会话是否有效都会是 403 —— 用 200 当"会话有效"的判据从一开始就不可能成立。
- 改成：探针换 `/api/v1/organizations`（**只做会话校验**，不做租户解析），
  判据改成"401 → 非 401"，超时 180s（覆盖 60+30s 抖动）。
- 这条同时产出了一个**运维结论**：**降 `tokenVersion` 会让旧凭据复效**。
  撤销必须是单调递增，任何"回滚版本号"的运维动作等于把被盗凭据放回来。

### 3.2 原 S08「POST /api/auth/signout 会清 cookie」

- 原判据：302 + `set-cookie` 匹配 `session-token=;`。
- 实测：`status=302 清cookie=false`。当时我写的是"302 就是成功"，
  这正是 §1.1 里说的假绿 —— **302 跳的是 `/login?error=MissingCSRF`**。
- 改成：直接测新端点 `/api/auth/logout`（S10），并追加"清后 jar 请求 → 401"（S11）
  与"重放旧 jar → 200"（S12）两条，把"删客户端凭据"与"服务端撤销"分开。

### 3.3 原 S14「降级后失去 `member.invite`」

- 原判据：`beforeCaps.includes('member.invite') && !afterCaps.includes('member.invite')`。
- 实测：`before=19 含invite=false`。原因：`qa.female` 是 **OPERATOR**，
  而 `member.invite` 只属于 ADMIN+（`capabilities.ts` 的 `OPERATOR_EXTRA` / `ADMIN_EXTRA`）。
  **断言的前提为假**，于是永远 FAIL —— 而且它掩盖了真正该测的东西。
- 改成：不写死能力名，直接算**实际差集**，并追加两条更强的约束：
  差集非空（证明降级有效果）、**新增为空**（证明没有意外授权）、
  失去 `member.read`（OPERATOR 有、MEMBER 没有的分界能力）。

---

## 4. 量化出来的设计事实

| 事实 | 数值 | 影响 |
| --- | --- | --- |
| 会话有效期 | 7 天绝对（`Max-Age=604800`） | 无滑动续期；到期必须重登 |
| 凭据撤销可见延迟 | **61.4s**（上界 90s = 60s TTL + 0–30s 抖动） | 改密码/撤销后，旧会话最长还能用 90s |
| 撤销后重新接受延迟 | 94.5s | 与上一条同源（缓存换版） |
| 登出对服务端的影响 | 0 | JWT 无状态；旧 cookie 重放仍 200（S12） |
| 权限变更生效延迟 | **0s** | 角色不写在 JWT 里，每请求查库（S19） |

`redisCache` 的抖动是 `withJitter()`：`baseTtl + random(0..30)`（`src/lib/redis-cache.ts:101`）。
它防的是缓存雪崩，代价是"撤销上界"从 60s 变成 90s。**这不是缺陷，是必须被写进
运维手册的数字** —— 事故响应时"我已经改了密码"不等于"攻击者已经掉线"。

---

## 5. 两条 NOT_TESTED，逐条写清为什么

### 5.1 S06 滑动续期

需要真实等待一个 `updateAge` 窗口（小时级）或改系统时钟。本轮**不伪造时间**。
可确证的部分：当前实现是"登录时签发 7 天绝对有效期"，续期语义未启用（S05 已证）。

### 5.2 S24 Google OAuth 成功回调

需要**真实** `GOOGLE_CLIENT_SECRET` + 真人在 Google consent 页点同意。本地
`.env.local` 只有 `GOOGLE_CLIENT_ID`。这一条不能自动化，也不该用 mock 冒充。

**可自动化且已跑的部分**（`v204-oauth-shape.mjs`，对生产 `app.lokfeel.com`，**21 PASS / 0 FAIL**）：

| 检查 | 结果 |
| --- | --- |
| `redirect_uri` 指向生产域（不含 localhost/127.0.0.1） | PASS |
| `scope` 含 `openid` | PASS |
| `state` 存在且长度 ≥16 | PASS（`len=43`） |
| PKCE `code_challenge_method=S256` | PASS |
| PKCE `code_challenge` 长度 43–128 | PASS（`len=43`） |
| 坏回调 ×3 类（用户拒绝 / 伪造 code+state / 空参数）：无 5xx、307 回登录、**不下发 session cookie**、错误文案可读 | 12/12 PASS |

对本地 `localhost:3111` 跑同一脚本会得到 **19 PASS / 2 FAIL**，红的是
「`redirect_uri` 不含 localhost」这两条 —— 那是脚本把"生产域"写死成期望值，
在 localhost 上**必然**红。这两条不是回归，是判据只在生产域成立，
所以证据取生产域那一次（日志：`evidence/2026-11-07_oauth-shape_prod.log`）。

---

## 6. 顺带发现的一处噪声（未修，记 P2）

```
[tenancy.audit] write failed: { eventType: 'tenant.access_denied', ...
  SQLITE_CONSTRAINT: FOREIGN KEY constraint failed }
```

`resolveTenantForUser()` 在"显式指定了一个**不存在**的 organizationId"时会尝试写
`TenantAuditEvent`，而该表对 `organizationId` 有外键 —— 指向不存在的组织必然失败。
行为是对的（拒绝 + 不掩盖），但审计行写不进去，且每次都在服务端日志留一条
`prisma:error`。修法很简单（不存在时把 `resourceId` 记为请求值、`organizationId`
置空或跳过落库），但它涉及审计表的语义，本轮不动 —— 记为 P2，进 Batch 6 的清理清单。

---

## 7. Batch 1/2 回归（证明这一轮没有打坏已验收的能力）

| 回归项 | 命令 | 结果 |
| --- | --- | --- |
| 组织/成员全生命周期 | `node scripts/qa/verify-t07-org-lifecycle.mjs --base=http://localhost:3111` | **30 PASS / 0 FAIL / 0 SKIP** |
| tenancy + auth 单测 | `npx jest tests/tenancy tests/auth` | **282 passed / 282**（含新增 `tests/tenancy/active-org.test.ts` 7 条） |
| 类型 | `npx tsc --noEmit` | exit 0 |
| Lint 棘轮 | `npm run lint:gate` | **零新增**（债务下降 5 处、清零 17 处） |
| 13 屏 × 4 视口 × 2 主题 | `v204-visual-audit.mjs --base=http://localhost:3111` | **104 PASS / 0 FAIL**；主题 `PASS 104 · N/A 0` |
| 13 屏 WCAG 2.2 AA | `v205-a11y-13screens.mjs --base=http://localhost:3111` | **39 PASS / 0 FAIL / 0 NOT_TESTED** |
| 新增两控件的可达性 | `v205-a11y-org-switcher.mjs --base=http://localhost:3111` | **5 PASS / 0 FAIL** |

### 7.1 新增两个控件之后：为什么单开一个扫描（而不是把它们塞进 39 格）

39 格的口径是「**单社群**账号看到的 13 屏」。而社群切换器只在 **≥2 个社群**的账号上渲染 ——
塞进同一批格子只会二选一地失真：要么让基线账号变成多社群（口径漂移），
要么切换器永远扫不到（假绿）。所以另起一格：
**账号前置条件不同，证据就必须分开记。**

```
✓ org-switcher-1440-field   PASS 选择器存在=true 选项=2/2 名="切换社群" 焦点=lf-org-switcher 登出按钮=true(44px,"退出登录") serious+违规=0
✓ org-switcher-1440-paper   PASS 同上
✓ org-switcher-390-field    PASS 同上
✓ ws-signout-390-field      PASS 存在=true 名="退出登录" 尺寸=44×44（≥44 触达区）焦点可达=true
✓ org-switcher-ui-switch    PASS "LokFeel Preview" → 选择"Default Organization" → 头部="Default Organization"（RSC 重渲染=true）
```

最后一条是关键：S15 只证明"服务端按 cookie 解析"，它证明不了 **UI 会重新渲染** ——
后者要经过 `router.refresh()` + RSC 重算。少了这一条，"切换器"可能只是一个好看的下拉框。

### 7.2 视觉回归的一处细节

104 格里 Console 七屏的头部多了一行（「当前社群 + 下拉」）与一个按钮（登出）。
四类视口（360/390/768/1440）× 两主题全部 `overflow=0px`，说明新增控件没有把
360px 顶栏挤爆 —— 这是 `min-w-0` + 窄屏隐藏文字（`hidden sm:inline` / `lg:inline`）
的直接效果，不是"看起来还行"。


---

## 8. 提交与残留

### 8.1 本轮改动

| 类型 | 文件 |
| --- | --- |
| 新增（服务） | `src/app/api/auth/logout/route.ts`、`src/app/api/v1/organizations/active/route.ts` |
| 新增（库） | `src/lib/tenancy/active-org.ts`（cookie 策略 + 形状校验） |
| 新增（UI） | `src/components/auth/sign-out-button.tsx`、`src/components/console/org-switcher.tsx` |
| 修改 | `src/lib/tenancy/resolve.ts`（`resolveActiveTenant` + `auditDenied`）、`src/lib/tenancy/index.ts`（导出）、`src/app/console/{layout,console-shell}.tsx`、`src/components/living/living-shell.tsx` |
| 新增（验证） | `scripts/qa/v205-auth-session.mjs`（S01–S24）、`scripts/qa/v205-a11y-org-switcher.mjs`（5 格）、`scripts/qa/_probe-signout.mjs`（判据取证）、`tests/tenancy/active-org.test.ts`（7 条） |
| 新增（证据） | `docs/implementation/v20/ga/evidence/2026-11-07_auth-session_local.log`、`2026-11-07_oauth-shape_prod.log` |
| npm | `verify:auth:session` |

未做**任何** prisma 变更 ⇒ 本次发布**不需要迁移**。

### 8.2 残留（不因本轮 PASS 而消失）

| ID | 项 | 状态 | 说明 |
| --- | --- | --- | --- |
| A-1 | Google OAuth 成功回调 | `NOT_TESTED` | 需 `GOOGLE_CLIENT_SECRET` + 真人；授权形状/坏回调已在生产 21/21 |
| A-2 | 会话滑动续期 | `NOT_TESTED` | 当前是 7 天绝对有效期，续期语义未启用；需跨窗口等待 |
| A-3 | 撤销可见延迟 90s 上界 | 已量化，未优化 | 改密码后旧会话最长可用 90s。要压到秒级须在 `requireAuth` 之外引入"撤销名单"（Redis），属 Batch 6 的监控/性能轨道 |
| A-4 | `tenant.access_denied` 对不存在的 org 写审计失败 | P2 | 外键约束导致的噪声日志，行为正确（拒绝），见 §6 |
| A-5 | 多设备登出（登出所有设备） | 未提供 | 语义上等价于 `tokenVersion+1`，已有实现路径但**没有 UI**。当前产品不做承诺，故不加半成品入口 |

### 8.3 给 Batch 7/8 的一句话

Batch 3 之后，"用户能自己离开"与"多社群能自己切换"这两条**从缺失变成可用**，
且都有在线证据。发布前需要人工确认的仍是 §8.2 的 A-1（真实 OAuth 跑通一次），
其余三条是"已知边界"而非"阻塞项"。

