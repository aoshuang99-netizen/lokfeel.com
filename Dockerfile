# ==============================================================================
# LokFeel — 生产镜像多阶段构建
# ==============================================================================
# 设计目标（P1-1 自托管交付物）：
#   1. 镜像尽量小：仅携带 standalone 产物与必要运行时文件
#   2. 非 root 运行：容器内以非特权用户执行
#   3. 构建期不需要真实密钥：所有密钥在运行时注入
#   4. 可复现：锁定基础镜像与依赖安装方式
#
# 构建：docker build -t lokfeel:latest .
# 运行：见 docker-compose.yml 或 docs/SELF-HOSTING.md
# ==============================================================================

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: 依赖安装
# ──────────────────────────────────────────────────────────────────────────────
FROM node:26-alpine AS deps

WORKDIR /app

# 仅复制清单文件，最大化利用 Docker 层缓存
COPY package.json package-lock.json ./
COPY prisma ./prisma

# 使用 npm ci 保证可复现安装；postinstall 会执行 prisma generate
RUN npm ci --ignore-scripts \
  && npx prisma generate

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: 构建
# ──────────────────────────────────────────────────────────────────────────────
FROM node:26-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma 7 在 generate 阶段需要 schema，但不需要真实数据库连接。
# 这里提供占位值，确保构建期不依赖任何真实凭证。
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"

# 触发 next.config.ts 中的 standalone 输出（见该文件 output 字段的环境变量门控）
ENV BUILD_TARGET=standalone

# 目标为 standalone 输出（见 next.config 的 output: 'standalone'）
RUN npx prisma generate \
  && npm run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 3: 运行时
# ──────────────────────────────────────────────────────────────────────────────
FROM node:26-alpine AS runner

WORKDIR /app

# 时区与字符集：避免中文/时间显示问题
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata curl \
  && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
  && echo $TZ > /etc/timezone \
  && apk del tzdata

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 非特权用户运行（uid/gid 1001，避免与宿主常见占用冲突）
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

# standalone 产物
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# 迁移与种子所需：Prisma schema + migrations + CLI
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# 入口脚本：等待数据库就绪 → 执行迁移 → 启动应用
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs

EXPOSE 3000

# 健康检查：与 /api/health 约定一致；若该端点不存在，改为对根路径的探活
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/ >/dev/null || exit 1

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]

# ==============================================================================
# 说明
# ==============================================================================
# · 本镜像**不包含**任何凭证、用户内容、种子数据或运营数据。
# · 首次启动需要 DATABASE_URL / REDIS_URL / NEXTAUTH_SECRET 等环境变量，
#   完整清单见 .env.example 与 docs/SELF-HOSTING.md。
# · 若 next.config 尚未设置 output: 'standalone'，构建会失败 —— 这是有意为之，
#   请先完成该配置（属于 P1-1 的一部分）。
# ==============================================================================
