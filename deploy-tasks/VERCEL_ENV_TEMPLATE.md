# ===========================================
# Vercel 环境变量配置模板
# ===========================================
# 请在 Vercel Dashboard > Settings > Environment Variables 中配置以下变量：
# 
# 1. 登录 https://vercel.com
# 2. 选择项目 Settings > Environment Variables
# 3. 添加以下变量（针对 Production, Preview, Development）：

# ===========================================
# 数据库配置 (Turso)
# ===========================================
DATABASE_URL=libsql://lokfeelcom-lokfeelboss.aws-us-east-1.turso.io
TURSO_AUTH_TOKEN=eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3Nzc1NTEzMTcsImlkIjoiMDE5ZGRkMDMtZGQwMS03Y2VmLWI5NjQtNzg4OThmMjljNTgwIiwicmlkIjoiNTNmMGQ0MjYtNjgzNC00ZjJkLTg1YjAtZTY3MTk4MmI2YTg1In0.ELXcqcJUSGKZpS6HPc8hjY2KZL7ZsKeGYmCr9UdwhfyYrTM57-4_mC5h8b8OrjUgjrcN_DO_xwWGGC1ajs7pCw

# ===========================================
# 认证配置
# ===========================================
# 生成新的 AUTH_SECRET: openssl rand -base64 32
AUTH_SECRET=dev-secret-change-in-production-nexus-2026
NEXTAUTH_URL=https://app.lokfeel.com
AUTH_URL=https://app.lokfeel.com

# ===========================================
# 应用配置
# ===========================================
NEXT_PUBLIC_APP_URL=https://app.lokfeel.com
NEXT_PUBLIC_APP_NAME=Nexus

# ===========================================
# 可选：OAuth (Google)
# ===========================================
# GOOGLE_CLIENT_ID=your_google_client_id
# GOOGLE_CLIENT_SECRET=your_google_client_secret

# ===========================================
# 可选：Stripe 支付
# ===========================================
# STRIPE_SECRET_KEY=sk_live_...
# STRIPE_WEBHOOK_SECRET=whsec_...
# STRIPE_PRICE_ID=price_...
# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...

# ===========================================
# 可选：Pusher 实时消息
# ===========================================
# PUSHER_APP_ID=your_app_id
# PUSHER_KEY=your_key
# PUSHER_SECRET=your_secret
# PUSHER_CLUSTER=us2
# NEXT_PUBLIC_PUSHER_KEY=your_key
# NEXT_PUBLIC_PUSHER_CLUSTER=us2
