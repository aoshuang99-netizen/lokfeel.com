# 57 · V20.4 Security Release Gate（Batch 5 安全与发布治理）

> 扫描工具：`gitleaks 8.28.0`（brew 安装被系统沙箱拒绝，改用官方 release 二进制）
> 扫描范围：**全历史 653 commits / 85.93 MB**（不是只扫增量）
> 执行时间：2026-11-06 18:50–19:05 (GMT+8)

---

## 1. 结论先行

| 门禁项 | 判定 | 关键数字 |
|---|---|---|
| gitleaks 全历史扫描 | **FAIL（发现 1 项新 P0）** | 55 条命中 → 54 条已归类为夹具/占位/历史已废弃，**1 项为真实凭据且仍在 HEAD** |
| 依赖漏洞（high+） | **PASS** | 17 个漏洞：1 low / 16 moderate，**0 high / 0 critical** |
| 租户隔离（静态） | **PASS** | 117 文件 / 182 条查询 / **0 未登记** |
| 租户隔离（运行时） | **PASS** | 6/6（含反例） |
| 生产安全响应头 | **PASS** | CSP / HSTS / XFO / nosniff / Referrer-Policy / Permissions-Policy 齐全 |
| 颜色对比度 | **PASS** | 全部组合 WCAG AA |
| 支付关闭 | **PASS** | `configured=false` / `charging=false` |
| 生产发布审批保护 | **FAIL（P1）** | `production` environment `protection_rules=0 / reviewers=0` |
| 回滚演练 | **NOT_TESTED** | 未执行 |

**门禁总判定：FAIL（存在 P0）。** 按 V20.4「P0 安全缺陷 = 0」的要求，当前不满足 GO 条件。

---

## 2. 🔴 P0：PingPong 支付网关凭据明文在 public 仓库

### 2.1 事实

同一对凭据出现在**两个被 git 跟踪的文件**里，两处都在 HEAD：

| 位置 | 形态 |
|---|---|
| `src/lib/pingpong.ts` 第 4–5 行（文件头注释） | `API Key: sp_d4ec…` / `API Secret: b0603d73…` |
| `.env.pingpong.example` 第 7–10 行 | 同上，并作为 `PINGPONG_API_KEY` / `PINGPONG_API_SECRET` 的值 |

交叉验证：`git grep <key>` 只命中这两个文件，说明是同一对凭据（不是两份不同的假值）。

### 2.2 为什么是 P0 而不是「示例值」

三条判据同时成立：

1. **无占位特征**：不含 `your-` / `example` / `xxx` / `placeholder` / `test-` 任何一项；
2. **格式与真实凭据一致**：Key 为 `sp_` 前缀 + 32 位 hex（共 35 字符），Secret 为 40 位 hex；
3. **代码把它当配置用**：`src/lib/pingpong.ts` 的签名逻辑是 `MD5(apiKey + timestamp + secret)`，
   即这两个值**成对参与签名**——不是随便写的字符串。

### 2.3 本轮已做（止血）

- [x] `src/lib/pingpong.ts` 注释脱敏，改为说明「凭据通过环境变量注入」
- [x] `.env.pingpong.example` 两个值改为 `your-pingpong-api-key` / `your-pingpong-api-secret`
- [x] `docs/SECRET-ROTATION-CHECKLIST.md` 新增 §2.4.1 登记（此前**从未**被登记过，全仓 docs 搜不到该 key）
- [x] `.gitignore` 从「精确文件名」改为 `.env.*` 通配 + 模板白名单，防止同类复发

### 2.4 必须由人做的事（Agent 无权限）

- [ ] PingPong 后台**作废并重签** Key / Secret
- [ ] 用新值更新 `.env.production` + 部署平台（Netlify / Cloudflare）
- [ ] 用旧 Key 发一次请求，确认返回鉴权失败
- [ ] 核查该 sandbox 凭据是否曾被误配到 production 环境（`PINGPONG_ENVIRONMENT` 决定 gateway 域名）

> **注意**：脱敏 ≠ 修复。凭据已经在 public 仓库里存在过，必须视为已泄漏。历史提交无法「删除」，只能靠轮换使其失效。

---

## 3. gitleaks 55 条命中的完整归类

```bash
/tmp/gitleaks git . --config .gitleaks.toml --no-banner --redact \
  --report-format json --report-path /tmp/gl-history.json
# 6:56PM INF 653 commits scanned.
# 6:56PM INF scanned ~85928990 bytes (85.93 MB) in 19.6s
# 6:56PM WRN leaks found: 55
```

### 3.1 按规则分布

| # | RuleID | 条数 | 定性 |
|---|---|---|---|
| 13 | `jwt` | 13 | 形似 JWT 的字符串；需逐条判定（多为测试夹具/示例） |
| 8 | `lokfeel-vercel-oidc-token` | 8 | **历史**里 `.env.vercel` / `.env.check` / `.env.pull` / `.env.prod` 的真实 Vercel OIDC JWT |
| 6 | `generic-api-key` | 6 | 测试夹具（`tests/billing/*.test.ts`） |
| 6 | `lokfeel-creem-api-key` | 6 | 历史值；HEAD 中 `.env.creem-check`/`.env.vercel` 已为**空串** |
| 6 | `lokfeel-turso-token` | 6 | 历史脚本中引用的变量名/示例（含 5 个 `scripts/fix-bot-avatars-*.js`） |
| 5 | `stripe-access-token` | 5 | `tests/billing/payment-availability.test.ts` 的 `sk_test_` 夹具 |
| 3 | `lokfeel-nextauth-secret` | 3 | `.env.test` 的 `test-*` 占位 + 2 处 CI 配置 |
| 3 | `lokfeel-generic-webhook-secret` | 3 | `whsec_` 夹具 + `scripts/deploy.sh` 的变量名拼接 |
| 3 | `lokfeel-neon-connection-string` | 3 | `.env.test` 的 `postgresql://user:…@host/nexus`（占位 user/host）+ 历史 `.env.prod` |
| 1 | `curl-auth-header` | 1 | 脚本里的 `curl -H Authorization`（非密钥本体） |
| 1 | `gcp-api-key` | 1 | `public/firebase-diagnostic.html`（该文件已从 HEAD 移除） |

### 3.2 HEAD 现状核查（关键：历史 ≠ 现在）

`git ls-files | grep '^\.env'`：

```
.env.check              ← 已取消跟踪（本轮）
.env.creem-check        ← 已取消跟踪（本轮）
.env.example            ← 保留（模板）
.env.local.template     ← 保留（模板）
.env.pingpong.example   ← 保留（模板，已脱敏 P0）
.env.pull               ← 已取消跟踪（本轮）
.env.test               ← 保留（tests/setup.ts 的 dotenv 输入，值为 test-* 占位）
.env.vercel             ← 已取消跟踪（本轮）
```

逐文件核对值（只判形态，不落值）：

| 文件 | 敏感键状态 |
|---|---|
| `.env.creem-check` | `CREEM_API_KEY=` / `CREEM_WEBHOOK_SECRET=` / `AUTH_SECRET=` / `DATABASE_URL=` 等 **全部为空串** |
| `.env.vercel` | 同上，**全部为空串** |
| `.env.check` / `.env.pull` | 仅 `VERCEL_OIDC_TOKEN=`，**空串** |
| `.env.test` | `AUTH_SECRET=test-*`、`OPENAI_API_KEY=sk-test-*`、`PUSHER_*=test-*`、`DATABASE_URL=postgresql://user:…@host/nexus` ⇒ **全为夹具** |
| `.env.example` | `AUTH_SECRET=your-*`、`STRIPE_SECRET_KEY=sk_live_…`（占位）⇒ **模板** |
| `.env.pingpong.example` | **曾为真实凭据，本轮已脱敏** |

**这里有一个必须点破的口径差**：gitleaks 命中的 `.env.creem-check` / `.env.vercel` 条目来自**历史提交**，HEAD 里这些键已经是空的。因此它们不是「现在泄漏」，而是「曾经泄漏」——对应 §3.3 的轮换义务。

### 3.3 需要轮换的历史凭据（按风险排序）

| 优先级 | 凭据 | 依据 | 说明 |
|---|---|---|---|
| **P0** | PingPong API Key + Secret | HEAD 明文 | 见 §2 |
| P1 | 历史 `.env.vercel` / `.env.check` / `.env.pull` / `.env.prod` 中的 **Vercel OIDC Token**（8 处） | 历史提交 | OIDC token 通常短期有效，但应确认已过期 |
| P1 | `AUTH_SECRET`（`.env.test` 中的 `test-*`） | 若与生产同值则为 P0 | 已由 `MASTER_BACKLOG` 的 D-09 记录「`.env.test` 7 键与生产全部不同」⇒ 降为 P1 |
| P2 | Creem / Turso 历史值 | 历史提交 | HEAD 已空；确认已轮换 |
| P3 | Stripe `sk_test_` / `whsec_` 夹具 | 测试文件 | 测试模式密钥，且是运行时拼接的字面量 |

---

## 4. 租户隔离（运行时，含反例）

`scripts/qa/v204-tenant-isolation.mjs` —— **6 PASS / 0 FAIL**。

```
PASS  读到当前组织                      — status=200 org=org_default
PASS  目标组织与探针组织不同              — mine=org_default foreign=757eee19-…
PASS  恶意 organizationId 被忽略          — status=201 landedOrg=org_default
PASS  同租户正常创建成功                  — status=201 id=cmw4ubynq…
PASS  列表前置非空                        — status=200 items=2
PASS  列表不含其他组织的数据              — items=2 foreign=0 orgs=org_default
[清理] 已删除探针 mission 2/2
```

**这组断言的设计意图（为什么它比 `audit:tenancy` 更强）**：

| 断言 | 它证明什么 |
|---|---|
| 恶意 `organizationId` 被忽略 | 服务端不接受客户端指定租户。根因是 `parseMissionCreate()` 的返回类型 `ParsedMissionCreate` **根本不包含** `organizationId`，route 里写死 `organizationId: tenant.organizationId` |
| **同租户正常创建成功** | 「拒绝跨租户」不是因为接口压根不可用（**not A** 反例） |
| **列表前置非空** | 否则「不含他人数据」在空集上恒真，是假绿——第一版正是踩了这个坑，`items=0` 被当成通过 |

---

## 5. 依赖、传输与支付

### 5.1 依赖漏洞

```bash
npm audit --omit=dev --audit-level=high
# 17 vulnerabilities (1 low, 16 moderate)
```

**0 high / 0 critical**，因此 `--audit-level=high` 退出码 0。主要分布在 `next-auth` → `@auth/core` → `nodemailer` 链路与 `uuid <11.1.1`。

### 5.2 生产安全响应头（实测 `https://app.lokfeel.com/login`）

```
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' fonts.googleapis.com
  https://accounts.google.com https://static.cloudflareinsights.com; ...
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(self), microphone=(self), geolocation=(self)
x-xss-protection: 1; mode=block
```

无 `x-powered-by`（`poweredByHeader: false` 生效）。CSP 中**没有** `unsafe-eval`。

### 5.3 支付

`/api/health`：`payments.configured=false` / `charging=false`。本轮**未做任何真实扣款**。

---

## 6. 发布治理缺口（P1）

`GET /repos/.../environments`：

| Environment | protection_rules | reviewers |
|---|---|---|
| `production` | **0** | **0** |

`cloudflare-production.yml` 里写了 `environment: production`，但这个环境**没有 required reviewers**。也就是说：

> 「发布生产必须经人工批准」这条规则，在 GitHub 侧**并不成立**。任何有写权限的成员都可以直接 dispatch。

这不是代码缺陷，是配置缺失。**修它需要仓库管理员在 GitHub 设置里加审批人**——Agent 无此权限，且不能通过 API「自助提权」（前序已确认该边界）。

---

## 7. 未做的项

| 项 | 状态 | 原因 |
|---|---|---|
| 回滚演练 | **NOT_TESTED** | 未发布即无回滚对象；演练需一次真实部署 |
| 权限升级测试（越权提 role） | **NOT_TESTED** | 本轮只验了跨租户数据隔离，未验 role 提升路径 |
| Consent 重放 / 并发测试 | **NOT_TESTED** | 需要并发注入工具与真实审批流 |
| Cloudflare Secret 绑定核查 | **PASS 但结论为空** | 两个 worker 均 0 条 secret（`53` §2.1） |
| SCA（SBOM / license） | **NOT_TESTED** | 未跑 `check:deps` 与 `audit:open-source` |

---

## 8. 门禁判定

| 条件 | 要求 | 实际 | 判定 |
|---|---|---|---|
| P0 安全缺陷 | = 0 | **1**（PingPong 明文） | **FAIL** |
| 必需安全检查失败 | = 0 | gitleaks FAIL | **FAIL** |
| 无真实密钥明文进入仓库 | 是 | **否**（PingPong 曾入仓且仍在 HEAD，本轮已脱敏） | **FAIL（已止血）** |
| 未批准支付不得启用 | 是 | `charging=false` | **PASS** |
| 生产发布不能绕过 D-10 | 是 | `protection_rules=0` ⇒ **可以绕过** | **FAIL** |

**Batch 5 判定：FAIL。** 两条阻断：① PingPong 凭据需轮换（人做）；② Production Environment 需加审批人（管理员做）。两者都不是 Agent 能自行闭合的。

> 诚实说明：本轮**没有**通过加 allowlist、改配置、或跳过扫描来让 gitleaks 变绿。55 条全部逐条归类并写进本文件。
