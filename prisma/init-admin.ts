/**
 * 生产环境管理员初始化脚本
 * 用途：在生产数据库创建超级管理员账号（不包含演示数据）
 *
 * 用法：
 *   DATABASE_URL="..." npx tsx prisma/init-admin.ts
 *   或设置 .env 后运行 npx tsx prisma/init-admin.ts
 */

import 'dotenv/config'
import { PrismaClient, UserRole } from '../src/generated/client'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new (PrismaClient as any)({ adapter }) as PrismaClient

// ── 修改这里的管理员信息 ──────────────────────
const ADMIN_CONFIG = {
  name: 'Nexus Admin',
  email: process.env.ADMIN_EMAIL || 'admin@nexus.app',
  // 管理员通过 OAuth（Google/GitHub）登录，无需密码
  role: UserRole.SUPER_ADMIN as UserRole,
}
// ──────────────────────────────────────────────

async function main() {
  console.log('🔐 初始化生产管理员账号...')

  // 检查是否已存在
  const existing = await prisma.user.findUnique({
    where: { email: ADMIN_CONFIG.email },
  })

  if (existing) {
    // 更新角色确保是 SUPER_ADMIN
    await prisma.user.update({
      where: { email: ADMIN_CONFIG.email },
      data: { role: UserRole.SUPER_ADMIN },
    })
    console.log(`✅ 管理员账号已存在，确保角色为 SUPER_ADMIN`)
    console.log(`   Email: ${ADMIN_CONFIG.email}`)
  } else {
    const admin = await prisma.user.create({
      data: {
        name: ADMIN_CONFIG.name,
        email: ADMIN_CONFIG.email,
        emailVerified: new Date(),
        role: UserRole.SUPER_ADMIN,
      },
    })
    console.log(`✅ 管理员账号创建成功`)
    console.log(`   ID:    ${admin.id}`)
    console.log(`   Email: ${admin.email}`)
    console.log(`   Role:  ${admin.role}`)
  }

  // 初始化系统配置（如不存在）
  const configs = [
    { key: 'matching.min_score', value: '40', description: '最低匹配分数（0-100）' },
    { key: 'matching.weekly_limit', value: '5', description: '每周匹配上限' },
    { key: 'matching.match_expiry_days', value: '7', description: '匹配过期天数' },
    { key: 'pricing.premium_monthly', value: '9.99', description: 'Premium 月付价格 (USD)' },
    { key: 'pricing.premium_yearly', value: '79.99', description: 'Premium 年付价格 (USD)' },
    { key: 'app.maintenance_mode', value: 'false', description: '维护模式开关' },
    { key: 'app.allow_registration', value: 'true', description: '是否允许新用户注册' },
    { key: 'app.auto_approve_profiles', value: 'false', description: '是否自动审核 Profile' },
  ]

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: {},
      create: config,
    })
  }

  console.log(`✅ 系统配置初始化完成（${configs.length} 项）`)
  console.log('')
  console.log('🎉 生产数据库初始化完成！')
  console.log(`   管理员登录：${process.env.NEXTAUTH_URL || 'https://your-domain.com'}/login`)
  console.log(`   使用邮箱 ${ADMIN_CONFIG.email} 通过 Google/GitHub OAuth 登录`)
  console.log(`   或进入 Admin: /admin`)
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('❌ 初始化失败:', e)
    prisma.$disconnect()
    process.exit(1)
  })
