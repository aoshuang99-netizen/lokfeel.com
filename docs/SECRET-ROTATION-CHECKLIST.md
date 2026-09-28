# 凭证轮换清单 (Secret Rotation Checklist)

> 状态：**待执行** · 2026-09-27
> 关联任务：P1-8 密钥卫生与安全加固

---

## 1. 为什么必须轮换

在本机磁盘上发现了**含真实凭证**的文件（虽然它们在 `.gitignore` 中，未进入版本控制）：

| 文件 | 大小 | 内容性质 |
|---|---|---|
| `.env.production` | 2.5 KB | 含真实 Vercel OIDC token、项目归属信息 |
| `.cf-secrets.json` | 3.5 KB | Cloudflare 相关密钥 |
| `.env.local` | 2.0 KB | 本地开发用真实凭证 |
| `.env.vercel` | 1.3 KB | Vercel 环境拉取结果 |
| `.env.pull` | 45 B | 环境拉取辅助 |
| `.env.creem-check` | 1.3 KB | 支付通道校验凭证 |
| `.env.test` | 646 B | 测试环境凭证 |

### 为什么"没进 git"还不够

1. **开源前必然要分享仓库/磁盘内容**（打包交付、镜像构建、CI 接入），这些文件有被误纳入的风险
2. **凭证有效性不因"没提交"而降低** —— 一旦本机被入侵或文件被误传，凭证立即失效
3. **历史提交教训**：本仓库曾有过硬编码密钥，已通过提交 `b111e17` 清理。说明这类问题在本项目中**真实发生过**
4. **开源后审计更严**：外部研究者会主动扫描你的仓库与镜像

> **结论：不是"删掉文件"就够了，而是"让这些凭证作废并从新的来源重新签发"。**

---

## 2. 轮换执行清单

### 2.1 前置准备

- [ ] 确认所有服务的控制台访问权限可用（避免轮换后无法登录）
- [ ] 选定一个维护窗口（轮换会导致服务短暂中断）
- [ ] 准备安全的凭证存放位置（密码管理器 / 云 Secret Manager），**不要放在项目目录**
- [ ] 备份当前 `DATABASE_URL` 等信息（仅用于迁移，用后即销毁）

### 2.2 数据库

- [ ] **PostgreSQL 密码轮换**（Neon / 自建）
  - 生成新密码：`openssl rand -base64 32`
  - 在控制台更新 → 同步更新所有部署环境的环境变量
  - 验证连接后，**作废旧密码**
- [ ] 检查数据库用户权限是否最小化（应用账号不应是超级用户）
- [ ] 若存在 `TURSO_AUTH_TOKEN` / `LIBSQL` 相关 token：**作废并重新签发**（或确认数据库路线已统一到 PostgreSQL 后彻底移除）

### 2.3 应用密钥

- [ ] **`NEXTAUTH_SECRET`** —— 轮换会使所有用户会话失效（用户需重新登录），属预期行为
  - 生成：`openssl rand -base64 32`
  - ⚠️ 多实例部署时必须**同时**更新，否则会话校验不一致
- [ ] 检查是否存在其他 JWT / 加密密钥（`jsonwebtoken` 相关），同样轮换

### 2.4 支付通道

- [ ] **作废并重新签发各通道 API Key**
- [ ] **重新生成 webhook signing secret**，并同步更新通道后台的回调地址与密钥
- [ ] 验证回调签名校验仍然生效（用测试事件触发一次）
- [ ] 检查是否曾把通道密钥写进过任何非 `.env` 文件

### 2.5 部署平台

- [ ] **Vercel** —— 轮换 token；检查项目归属与协作者列表，移除不必要成员
- [ ] **Cloudflare** —— 轮换 API Token；`scoped` 权限最小化（不要用全局 key）
- [ ] **Netlify** —— 轮换 access token
- [ ] 检查各平台的环境变量列表，清理不再使用的变量

### 2.6 第三方服务

- [ ] **Redis**（Upstash / 自建）—— 轮换密码
- [ ] **邮件**（Resend / SMTP）—— 轮换 API Key
- [ ] **Sentry** —— 轮换 DSN 或 auth token（若 DSN 曾泄露）
- [ ] **Firebase** —— 轮换 service account key；检查是否仍需要 `firebase-admin`
- [ ] **OAuth**（Google / Twitter）—— 轮换 client secret；检查回调白名单是否最小化
- [ ] **对象存储** —— 轮换 access key

### 2.7 清理

- [ ] 从本机删除所有含真实凭证的 `.env*` 文件（保留 `.env.example`）
- [ ] 删除 `.cf-secrets.json`
- [ ] 确认 `.gitignore` 覆盖全部相关模式（`.env*` 已被忽略，需确认 `.cf-secrets.json` 也在内）
- [ ] 全盘搜索一次，确认无遗漏：

```bash
# 在本机项目目录内搜索疑似凭证文件
find . -maxdepth 2 -name '.env*' -o -maxdepth 2 -name '*secret*' | grep -v node_modules

# 确认版本控制中没有任何凭证文件
git ls-files | grep -iE '\.env|secret|\.pem|\.key' || echo "版本控制中无凭证文件 ✓"
```

- [ ] 检查 git 历史是否仍有残留（`b111e17` 已清理过，需复核）：

```bash
# 用 gitleaks 扫描完整历史
gitleaks detect --source . --config .gitleaks.toml --verbose
```

- [ ] 若历史中仍有残留：评估是否需要重写历史（`git filter-repo`）—— 注意这会改变所有 commit hash，需与协作者协调

### 2.8 验证

- [ ] 轮换后完整跑一次端到端流程：
  - 用户注册 / 登录（验证 NEXTAUTH_SECRET）
  - 发送消息（验证 Redis）
  - 上传头像（验证对象存储）
  - 触发一次测试支付（验证通道密钥与 webhook 签名）
  - 收到一封邮件（验证邮件服务）
- [ ] 确认旧凭证**已失效**（用旧 Key 尝试调用，应返回 401/403）

---

## 3. 防复发机制

### 3.1 已建立

| 机制 | 文件 | 作用 |
|---|---|---|
| 密钥扫描配置 | `.gitleaks.toml` | 自定义了本项目实际使用的服务商规则（Creem / Turso / Neon / NextAuth / Vercel / Cloudflare / Stripe）|
| CI 阻断 | `.github/workflows/ci.yml` → `secret-scan` | 检出即失败，扫描完整历史（`fetch-depth: 0`）|
| 依赖审计 | `.github/workflows/ci.yml` → `dependency-audit` | `npm audit --audit-level=high` |
| 工作规范 | `CONTRIBUTING.md` §6 | 明确禁止提交凭证，规定误提交后的处理流程 |
| 部署方检查清单 | `SECURITY.md` §5.1 | 自托管上线前的安全确认项 |

### 3.2 建议补充

- [ ] 在 GitHub 仓库设置中启用 **Secret Scanning** 与 **Push Protection**（组织级功能）
- [ ] 引入 secret manager（Doppler / 1Password CLI / AWS Secrets Manager），避免本地明文 `.env`
- [ ] 为 `.env*` 文件设置文件系统权限：`chmod 600 .env*`
- [ ] 在 CI 中使用 GitHub Secrets，**绝不**把密钥写进 workflow 文件

### 3.3 误提交时的应急流程

```
发现误提交 → 1 小时内作废该凭证 → 重新签发 → 更新所有环境
          → 清理历史（必要时重写）→ 复盘并补规则到 .gitleaks.toml
```

**顺序很重要**：先作废凭证，再清理历史。因为清理历史需要时间，而凭证在作废前一直有效。

---

## 4. 执行记录

> 执行时请在此表格登记，便于审计与交接。

| 日期 | 项目 | 执行人 | 结果 | 备注 |
|---|---|---|---|---|
| | | | ⬜ | |
| | | | ⬜ | |
| | | | ⬜ | |

---

*最后更新：2026-09-27*
