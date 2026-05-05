# Vercel 部署快速指南

## 一键部署命令

### 本地部署
```powershell
# 安装依赖后直接部署
npm install
npm run build
vercel --prod

# 使用部署脚本 (带交互)
.\deploy-vercel.ps1

# 使用 Vercel API (CI/CD)
.\deploy-vercel-api.ps1 -Token "xxx" -ProjectId "prj_xxx"
```

### GitHub Actions 自动部署
推送到 `main` 分支自动触发:
```bash
git add .
git commit -m "feat: 部署配置"
git push origin main
```

---

## 环境变量配置步骤

### 1. 获取 Vercel 凭证

```bash
# 1. 登录 Vercel
vercel login

# 2. 链接项目
vercel link

# 3. 获取项目配置
cat .vercel/project.json
```

### 2. GitHub Secrets 配置

在 GitHub 仓库 Settings > Secrets 中添加:

| Secret 名称 | 获取方式 |
|------------|---------|
| `VERCEL_TOKEN` | vercel.com/account/tokens (Create Token) |
| `VERCEL_ORG_ID` | .vercel/project.json 的 orgId 字段 |
| `VERCEL_PROJECT_ID` | .vercel/project.json 的 projectId 字段 |
| `DATABASE_URL` | Turso 数据库连接 URL |
| `TURSO_AUTH_TOKEN` | Turso Dashboard > Database > Connection |
| `AUTH_SECRET` | `openssl rand -base64 32` 生成 |
| `STRIPE_SECRET_KEY` | Stripe Dashboard > Developers > API Keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard > Webhooks |
| `GOOGLE_CLIENT_ID` | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console |
| `RESEND_API_KEY` | resend.com/api-keys |
| `PUSHER_*` | Pusher Dashboard |
| `OPENAI_API_KEY` | platform.openai.com |

### 3. Vercel Dashboard 配置

在 vercel.com/dashboard > Your Project > Settings > Environment Variables:

```bash
# Production
DATABASE_URL=libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io
TURSO_AUTH_TOKEN=<from-turso>
AUTH_SECRET=<generate-with-openssl>
AUTH_URL=https://app.lokfeel.com
NEXTAUTH_URL=https://app.lokfeel.com
NEXT_PUBLIC_APP_URL=https://app.lokfeel.com
NEXT_PUBLIC_APP_NAME=LokFeel

# Stripe
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx

# Google OAuth
GOOGLE_CLIENT_ID=xxxxx
GOOGLE_CLIENT_SECRET=xxxxx

# Pusher
PUSHER_APP_ID=xxxxx
PUSHER_KEY=xxxxx
PUSHER_SECRET=xxxxx
PUSHER_CLUSTER=us2
NEXT_PUBLIC_PUSHER_KEY=xxxxx
NEXT_PUBLIC_PUSHER_CLUSTER=us2

# Resend
RESEND_API_KEY=re_xxxxx
SMTP_FROM=noreply@lokfeel.com
```

---

## 数据库迁移

### 开发环境
```bash
# 推送 schema 到本地/开发数据库
npm run db:push

# 创建迁移文件
npm run db:migrate

# 重置数据库 (慎用!)
npm run db:reset
```

### 生产环境
```bash
# GitHub Actions 自动执行
# 或手动执行:
npx prisma migrate deploy
```

---

## 常见问题

### Q: 部署失败 "Module not found"
```bash
npm install
npx prisma generate
npm run build
```

### Q: 数据库连接失败
检查 `TURSO_AUTH_TOKEN` 是否正确设置，确保 IP 白名单包含 Vercel IP。

### Q: NextAuth 认证失败
确保 `AUTH_SECRET` 和 `AUTH_URL` 在所有环境正确配置。

### Q: Stripe Webhook 不工作
在 Stripe Dashboard 添加 Vercel 部署 URL 作为 webhook 端点。

---

## 部署检查清单

- [ ] Vercel 账户已连接 GitHub
- [ ] 项目已导入 Vercel
- [ ] 所有环境变量已配置
- [ ] 自定义域名已绑定
- [ ] `app.lokfeel.com` DNS 已配置 CNAME
- [ ] `admin.lokfeel.com` DNS 已配置 CNAME
- [ ] Stripe Webhook 已配置
- [ ] Turso 数据库 IP 白名单已开放
