# 01 · 凭据泄漏应急与恢复

**状态：PASS（泄漏凭据已全部失效、会话已撤销、门禁已落地）**
**执行时间：2026-11-07 15:32–16:40 CST**
**生产基线：`bc46a22` / deploy `6aeeb9cd`**

---

## 0. 一句话结论

`LokFeel@<年份>!` 形态的管理员口令在一个 **public** 仓库里以字面量存在了 **6 个提交**，而在本轮处置前，
它**仍然可以登录生产并拿到 `SUPER_ADMIN`**。这不是"潜在风险"，是一个**当时就敞开的后门**。
现在：5 个受影响账号的密码全部轮换、`tokenVersion` 全部推进（旧 JWT 立即失效）、
代码中零明文、门禁与自检接入 CI。

---

## 1. 暴露面

### 1.1 仓库可见性

```
GET https://api.github.com/repos/aoshuang99-netizen/lokfeel.com
→ private=false  visibility=public  default_branch=main
```

**public**。任何人不需任何凭据即可读到源码与全部历史。

### 1.2 字面量位置（处置前，当前树）

| 文件 | 形态 |
|---|---|
| `scripts/qa/ui-gallery.mjs` | `admin: { password: "…" }`；另有 `test.male` / `test.female` 同款 |
| `scripts/qa/v16-ux-audit.mjs` | `process.env.QA_ADMIN_PASSWORD \|\| '…'` |
| `scripts/qa/v16-release-audit.mjs` | 同上 |
| `scripts/qa/verify-llm-live.mjs` | `argOf('password', '…')` |
| `prisma/init-admin.ts` | `defaultPassword: process.env.ADMIN_PASSWORD \|\| '…'` |
| `scripts/create-test-users.ts` | `const PASSWORD = 'Test123456!'`（测试账号口令） |

`|| '<字面量>'` 这个写法是关键放大器：**忘了配环境变量不会报错，会静默降级到一个
全世界都能读到的密码**。它在四个文件里出现了四次。

### 1.3 Git 历史

```
git log --all -S '<admin 字面量>'  → 6 个提交
git log --all -S '<test 字面量>'   → 4 个提交
```

最早可追到 `57e0b3f`（photo gallery），最近一次仍在 `7f0ff4a`（本日文档提交）。
**删除当前文件 ≠ 撤销历史泄漏** —— 这也是为什么本轮的主处置是"轮换凭据"，不是"删文件"。

### 1.4 生产可用性（决定性证据）

```
POST https://app.lokfeel.com/api/auth/login
{"email":"admin@lokfeel.com","password":"<泄漏字面量>"}
→ 200
{"success":true,"redirectUrl":"/admin","role":"SUPER_ADMIN", …}
```

处置前实测 **200 + SUPER_ADMIN**。这一条把整件事从"代码卫生问题"升级为 **P0 入侵面**。

---

## 2. 影响范围

用 bcrypt 逐账号比对两个泄漏口令（`@lokfeel.com` 域 65 个账号）：

| 账号 | 角色 | 使用哪个泄漏口令 | 处置 |
|---|---|---|---|
| `admin@lokfeel.com` | **SUPER_ADMIN** | 管理员口令字面量 | 已轮换 |
| `test.male@lokfeel.com` | USER | 测试口令字面量 | 已轮换 |
| `test.female@lokfeel.com` | USER | 测试口令字面量 | 已轮换 |
| `test.new@lokfeel.com` | USER | 测试口令字面量 | 已轮换 |
| `e2e-test@lokfeel.com` | USER | 测试口令字面量 | 已轮换 |

e2e 夹具口令（`E2E-…`，字面量不再复述）**没有**被任何生产账号复用（同一轮比对确认）。

> 只扫 `@lokfeel.com` 是有意的：`727` 个含 `demo`/`bot` 的账号逐个 bcrypt 会超过命令超时，
> 且它们的口令由种子脚本生成、不是这两个字面量。这一点作为**残余不确定性**登记在 §7。

---

## 3. 处置动作与证据

### 3.1 轮换（脚本 `scripts/ops/rotate-user-credential.mjs`）

为什么需要脚本而不是控制台点一下：NextAuth 用的是 **JWT 策略**，改密码**不会**踢掉已签发的 token。
`src/lib/auth/auth.ts:70-75` 的 `requireAuth()` 会比较 JWT 里的 `tokenVersion` 与库里的值，
所以正确做法是**同一条 UPDATE 里同时改密码与推进版本号**——分开写就会出现
"密码已换、旧 token 仍可用"的中间态，轮换变成假动作。

脚本的硬约束：
- 新密码**只从 `NEW_PASSWORD` 环境变量读**，不接受 `--password=`（argv 会进 shell history 与 `ps`）；
- 任何路径都不打印密码；默认 dry-run，必须 `--apply`；
- 写完**回读 + bcrypt 双向校验**（新密码匹配 && 旧密码不匹配 && 版本号 +1）；
- 同时删除该用户名下的 `Session` 行（当前策略下应为 0，但表在就必须清）。

实测输出（每个账号同构）：

```
目标：admin@lokfeel.com（SUPER_ADMIN）
tokenVersion：0 → 1
回读：tokenVersion=1（期望 1） ✓
回读：新密码 bcrypt 匹配 ✓
回读：旧泄漏密码 bcrypt 匹配 ✓ 已失效
✅ 轮换完成。旧密码与全部旧 JWT 会话均已失效。
```

新密码写入 `.qa-credentials.local.json`（键 `adminPassword` / `testmalePassword` /
`testfemalePassword` / `testnewPassword` / `e2etestPassword`，权限 `0600`，
`.gitignore:93` 已覆盖）。**报告中不出现任何凭据明文。**

### 3.2 会话撤销验证（4/4 PASS）

先取一份旧会话作为样本（轮换前用泄漏口令登录并保存 cookie），轮换后再验证：

| # | 断言 | 结果 |
|---|---|---|
| P1 | 用泄漏口令登录 | `401` → **PASS** |
| P2 | 用新口令登录 | `200 success=true` → **PASS** |
| P3 | 轮换前取得的旧会话 cookie 访问 `/api/v1/members` | `401`（`tokenVersion` 已推进）→ **PASS** |
| P4 | 新会话访问同一接口 | `200` → **PASS** |

P3 是这次处置的核心证据：**改密码**只挡住下一个登录的人，**推进 tokenVersion** 才把已经在里面的人请出去。

### 3.3 代码清除

统一收敛到 `scripts/qa/qa-credentials.mjs` 单一入口，新增 `requireCredential(envKey, fileKey, what)`
与 `getAdminPassword()`：**取不到就抛**，错误信息给出两条可行路径，**绝不返回默认值**。

| 文件 | 改动 |
|---|---|
| `scripts/qa/qa-credentials.mjs` | 新增 `requireCredential()` / `ADMIN_EMAIL` / `getAdminPassword()`；文件头写明事故与原则 |
| `scripts/qa/ui-gallery.mjs` | 三个账号全部改为解析凭据，无字面量 |
| `scripts/qa/v16-ux-audit.mjs` | 删 `\|\| '<字面量>'` |
| `scripts/qa/v16-release-audit.mjs` | 同上 |
| `scripts/qa/verify-llm-live.mjs` | 删默认密码参数 |
| `prisma/init-admin.ts` | 删默认密码；**空密码/短于 16 字符直接 `exit 2`**（空密码 bcrypt 后仍可被空密码登录命中＝后门）；更新分支同时 `tokenVersion: { increment: 1 }`；**不再打印密码到 stdout** |
| `scripts/create-test-users.ts` | 删 `const PASSWORD = '…'`，改 `TEST_USER_PASSWORD` 必填 |
| `scripts/verify-final.js` / `verify-v2.js` / `verify-avatars-playwright.js` | 字面量改 `process.env.VERIFY_PASSWORD` |

`node --check` 对 7 个改动脚本全部通过；凭据解析实测：本地文件可解析、`ADMIN_PASSWORD` 环境变量优先。

---

## 4. 门禁（可复现的退出码，不是一句"我扫过了"）

`scripts/check-secrets.mjs`（零依赖，2295 个跟踪文件，约 1s）：

- **G1 已知泄漏字面量** —— 精确串，命中即 P0；
- **G2 凭据类 `process.env.X || '字面量'`** —— 只匹配变量名含
  `PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|CREDENTIAL|PRIVATE_KEY` 的写法，**零误报**。

### 4.1 为什么砍掉了"通用硬编码密码"规则

第一版把 `password: '字面量'` 直接当红灯，结果 **163 条命中**：其中 155 条是
`process.env.APP_URL || 'http://localhost:3000'`，另有 zod 的 `password: 'reg-password'`（i18n 键）、
`password: 'MAGIC_LINK_AUTH'`（魔法标记）、`password: 'Test123!'`（e2e 假账号）。
**误报多的门禁等于没有门禁** —— 真正的那一条会淹在噪音里，人很快就会学会忽略它。
所以规则收窄到"零误报"，其余候选只在 `--report` 里列给人看，不参与退出码。

### 4.2 自检带负控（9/9）

```
✓ G1 抓到已知泄漏字面量
✓ G2 抓到 env 回退字面量
✓ G2 放过正常 env 读取
✓ G2 放过回退到函数
✓ G2 放过 URL 默认值
✓ G2 只认 ||（?? 不误报）
✓ G1/G2 对 i18n 键与标记零误报
✓ --report 能看到候选
✓ docs/ 不在门禁范围
自检：9/9
```

自检过程中**抓到扫描器自己的两个 bug**（读文件用了进程启动时的 ROOT；`\1` 反向引用指向变量名
而非引号 —— 后者导致正例反而漏报）。这两条恰好说明了为什么负控是必需的。

### 4.3 CI 接入

`ci.yml` 的 `secret-scan` job 在 gitleaks 之前先跑：
`node scripts/check-secrets.mjs --self-test` → `node scripts/check-secrets.mjs`（两步都阻断）。

gitleaks 侧新增 `lokfeel-product-password-literal` 规则（`(?i)["'\s:=]LokFeel@[…]{6,}`），
并**没有**新增通用密码规则（理由见 4.1）。
历史提交用 `[allowlist].commits` 精确豁免 9 个 SHA，注释写明"豁免的前提是凭据已失效"。

> 现状暴露：gitleaks-action 之前一直是绿的，而明文管理员口令就在仓库里。这说明
> "有一个 secret-scan job" 与 "secret 会被拦住" 是两件事。

---

## 5. 为什么不改写 Git 历史

结论：**不改写**。

1. 仓库是 public，已被 clone / fork / 镜像 / 抓取的可能性无法排除；改写只能让
   **本仓库**看不到，不能让别人手上的副本消失。
2. 改写 public 历史是破坏性操作（所有外部引用、PR、CI 记录、部署 commit 关联全部失效），
   代价远大于收益——**收益本来就是零**：凭据已经失效了。
3. 真正的补救是轮换。这也是 §3 把"轮换"放在第一位、把"删文件"放在第二位的原因。

写进 `.gitleaks.toml` 的豁免注释里，避免下一个人以为"allowlist = 掩盖问题"。

---

## 6. 事后取证能力：从 0 到 1

处置过程中要回答一个必然被问到的问题：「**这个账号最近有没有被人异常登录过？**」

查库结果：

```
AuditLog     总行数 = 0
AdminAudit   总行数 = 0
```

**系统从来没有记录过登录事件。** 也就是说，最需要取证的那一刻，取证能力恰好不存在。

### 6.1 补的代码

`src/lib/auth/login-audit.ts` + `src/app/api/auth/login/route.ts` 四处接入
（未知邮箱 / OAuth-only / 密码错误 / 成功）：

- 复用既有 `AuditLog` 哈希链（`prevHash → entryHash`），不另起一张表；
- **绝不阻塞登录**：写入失败只 `console.error`，返回 `null`；
- **绝不记录密码，也不记录密码长度**；`details` 只允许 `outcome` / `reason`；
- **未知邮箱不落库**：`AuditLog.userId` 是外键，硬塞会写出孤儿行；
- UA 截断 200 字符（客户端完全可控，不截断等于给了一个超长写入面）；
- `clientIpFrom()` 只取 `x-forwarded-for` **第一跳**。

### 6.2 测试（16/16，含负控）

关键负控：把 `buildLoginAuditRecord` 改成 `{...input, outcome}` 后，**5 条测试立刻变红**
（说明"密码不会进审计"这条断言真的有牙齿），还原后 16/16 复绿。

同时修正了一条**写得太粗的断言**：原本用 `not.toMatch(/password/i)` 判断"无凭据"，
被 reason 码 `bad_password` 自己命中而误报 —— 改判"字段集合只允许 outcome/reason"。

### 6.3 但历史异常登录审查仍然是 NOT_TESTED

补上审计只能保证**今后**可查。**过去**这段（凭据公开暴露期间）的登录行为：

- 没有任何服务端登录日志留存（平台日志保留期已过 / 未集中采集）；
- 数据库无登录记录；
- 因此**无法证明**也没有证据表明曾被他人使用。

**登记为 `NOT_TESTED`，不写成 PASS。** 缓解措施：全部凭据已轮换、全部旧 JWT 已失效，
即使有人曾登录，其会话也已作废。

---

## 7. 残余风险（不美化）

| # | 风险 | 状态 / 建议 |
|---|---|---|
| R1 | GitHub **Secret Scanning Push Protection** 未确认开启（自定义规则不覆盖 `LokFeel@…` 形态） | 待开启；在 Settings → Code security 打开 push protection |
| R2 | 公开历史中仍存在 9 个含字面量的提交（已 allowlist） | 已失效；如需彻底清除需改写历史（不建议，见 §5） |
| R3 | 只对 `@lokfeel.com` 域做了口令复用比对；`demo`/`bot` 等 662 个账号未逐字节比对 | 这些账号由种子脚本生成，口令不来自这两个字面量；如要彻底确认需离线跑一次全量 bcrypt |
| R4 | 旧管理员口令（字面量见 git 历史，正文不再复写）若在**本系统之外**（邮箱、其他 SaaS）被复用，本仓库无从得知 | **需人工处置**：请确认该口令没有用于其他服务 |
| R5 | 轮换后的口令保存在开发者本机 `.qa-credentials.local.json` | 已 0600 + gitignore；生产 CI 应改用 Secret Store 注入 |
| R6 | 无登录速率限制 / 无爆破告警 | `AuditLog` 现在有数据了，但**告警规则未接**；列入 Batch 6 |

---

## 8. 待人工完成（唯一的外部动作）

1. 确认旧管理员口令（git 历史中的那条）是否在**其他系统**复用；如有，逐个更换（R4）。
2. 在 GitHub 仓库设置里开启 **Secret Scanning + Push Protection**（R1）——需要仓库管理员权限。
3. 如需在生产 CI 跑需要管理员凭据的脚本，把新口令写入 GitHub Secrets（`ADMIN_PASSWORD`），
   不要提交任何凭据文件。

---

## 9. 证据索引

| 项 | 位置 / 命令 |
|---|---|
| 轮换脚本 | `scripts/ops/rotate-user-credential.mjs` |
| 密钥门禁 | `scripts/check-secrets.mjs`（`npm run check:secrets` / `verify:secrets`） |
| gitleaks 规则 | `.gitleaks.toml`（`lokfeel-product-password-literal` + `allowlist.commits`） |
| CI | `.github/workflows/ci.yml` → job `secret-scan` |
| 登录审计 | `src/lib/auth/login-audit.ts`、`src/app/api/auth/login/route.ts` |
| 审计测试 | `tests/auth/login-audit.test.ts`（16/16） |
| 凭据单一入口 | `scripts/qa/qa-credentials.mjs` |
