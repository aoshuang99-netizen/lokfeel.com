# Vercel 自动部署配置
# Vercel 会自动识别 Next.js 项目，无需额外 vercel.json

# ============================================================
# 1. Vercel 必需环境变量 (在 Vercel Dashboard 配置)
# ============================================================

## Database
DATABASE_URL=libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io
TURSO_AUTH_TOKEN=your-turso-auth-token-here

## NextAuth (核心)
AUTH_SECRET=generate-with-openssl-rand-base64-32
AUTH_URL=https://app.lokfeel.com
NEXTAUTH_URL=https://app.lokfeel.com

## App Config
NEXT_PUBLIC_APP_URL=https://app.lokfeel.com
NEXT_PUBLIC_APP_NAME=LokFeel
NEXT_PUBLIC_ADMIN_URL=https://admin.lokfeel.com

## OAuth (Google)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

## Email (Resend)
RESEND_API_KEY=re_your_resend_api_key
SMTP_FROM=noreply@lokfeel.com

## Stripe Payment
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRICE_ID=price_xxxxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx

## Pusher Real-time
PUSHER_APP_ID=your-app-id
PUSHER_KEY=your-key
PUSHER_SECRET=your-secret
PUSHER_CLUSTER=us2
NEXT_PUBLIC_PUSHER_KEY=your-key
NEXT_PUBLIC_PUSHER_CLUSTER=us2

## Upstash Redis (可选 - 缓存)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxxxx

## OpenAI (AI 功能)
OPENAI_API_KEY=sk-xxxxx

# ============================================================
# 2. GitHub Secrets 配置清单
# ============================================================
#
# 在 GitHub 仓库 Settings > Secrets and variables > Actions 中添加:
#
# VERCEL_TOKEN          - Vercel API Token (从 vercel.com/account/tokens)
# VERCEL_ORG_ID         - 团队/用户 ID (运行 vercel inspect 获取)
# VERCEL_PROJECT_ID      - 项目 ID (运行 vercel inspect 获取)
#
# 生成 VERCEL_ORG_ID 和 VERCEL_PROJECT_ID:
#   1. npm i -g vercel
#   2. vercel login
#   3. vercel link --yes
#   4. cat .vercel/project.json
# ============================================================

# ============================================================
# 3. 本地开发环境变量
# ============================================================
# 复制 .env.example 为 .env.local 并填写实际值
# .env.local 已在 .gitignore 中，不会提交到仓库
