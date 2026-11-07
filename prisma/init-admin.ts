/**
 * 生产环境管理员初始化脚本
 * 用途：在生产数据库创建超级管理员账号（不包含演示数据）
 *
 * 用法：
 *   DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." npx tsx prisma/init-admin.ts
 *   或设置 .env 后运行 npx tsx prisma/init-admin.ts
 */

import 'dotenv/config'
import { hash } from 'bcryptjs'
import { PrismaClient, UserRole } from '../src/generated'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaLibSql } = require('@prisma/adapter-libsql')

// Clean DATABASE_URL for libSQL compatibility
function cleanLibsqlUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove unsupported PostgreSQL query parameters
    const unsupportedParams = ['sslmode', 'ssl', 'channel_binding', 'connect_timeout', 'statement_timeout', 'application_name', 'options'];
    for (const param of unsupportedParams) {
      parsed.searchParams.delete(param);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

const rawUrl = (process.env.DATABASE_URL || "").trim()
const authToken = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || "").trim()
const url = cleanLibsqlUrl(rawUrl)

const adapter = new PrismaLibSql({
  url,
  authToken: authToken || undefined,
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new (PrismaClient as any)({ adapter }) as PrismaClient

// ── 修改这里的管理员信息 ──────────────────────
const ADMIN_CONFIG = {
  name: 'LokFeel Admin',
  email: process.env.ADMIN_EMAIL || 'admin@lokfeel.com',
  // 首次运行时设置的密码由环境变量提供。
  // 🔴 这里**没有**默认值：曾经的默认值是一个写进 public 仓库的字面量，任何能看到仓库的人
  //    都能直接登进生产。宁可让初始化脚本立刻失败，也不要给一个"能跑起来但全世界都知道"的密码。
  defaultPassword: process.env.ADMIN_PASSWORD || '',
  role: UserRole.SUPER_ADMIN as UserRole,
}
// ──────────────────────────────────────────────

async function main() {
  console.log('🔐 初始化生产管理员账号...')

  // 🔴 没有密码就不跑。空密码 bcrypt 之后仍能被空密码登录命中，等于开一个后门。
  //    这里同时拒绝过短的密码，避免有人为了"先跑通"设一个 6 位。
  const pw = ADMIN_CONFIG.defaultPassword
  if (!pw || pw.length < 16) {
    console.error(
      '拒绝：ADMIN_PASSWORD 缺失或短于 16 字符。\n' +
        "  ADMIN_PASSWORD='<强随机密码>' npx tsx prisma/init-admin.ts\n" +
        '（不要在命令行历史里留密码时，用 env -i 或在本地 .env.local 里设置）',
    )
    process.exit(2)
  }

  // 检查是否已存在
  const existing = await prisma.user.findUnique({
    where: { email: ADMIN_CONFIG.email },
  })

  const hashedPassword = await hash(ADMIN_CONFIG.defaultPassword, 12)

  if (existing) {
    // 更新角色确保是 SUPER_ADMIN，同时更新密码
    await (prisma.user.update as any)({
      where: { email: ADMIN_CONFIG.email },
      // 同时推进 tokenVersion：重置密码必须让**已签发的 JWT**失效，
      // 否则"改了密码"只是让下一个人登不进来，已经进来的人还在。
      data: { role: UserRole.SUPER_ADMIN, password: hashedPassword, tokenVersion: { increment: 1 } },
    })
    console.log(`✅ 管理员账号已存在，确保角色为 SUPER_ADMIN`)
    console.log(`   Email: ${ADMIN_CONFIG.email}`)
    console.log('   Password: 已更新（不打印明文）')
  } else {
    const admin = await (prisma.user.create as any)({
      data: {
        name: ADMIN_CONFIG.name,
        email: ADMIN_CONFIG.email,
        emailVerified: new Date(),
        password: hashedPassword,
        role: UserRole.SUPER_ADMIN,
        profile: {
          create: {
            displayName: ADMIN_CONFIG.name,
            age: 30,
            gender: 'WOMAN',
            sexuality: 'Straight',
            bio: 'System Administrator',
          },
        },
      },
    })
    console.log(`✅ 管理员账号创建成功`)
    console.log(`   ID:    ${admin.id}`)
    console.log(`   Email: ${admin.email}`)
    console.log('   Password: 已设置（不打印明文）')
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
  console.log(`   邮箱密码登录：${ADMIN_CONFIG.email} / ${ADMIN_CONFIG.defaultPassword}`)
  console.log(`   或通过 Google/GitHub OAuth 登录（需提前配置 OAuth）`)
  console.log(`   Admin 后台: /admin`)
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('❌ 初始化失败:', e)
    prisma.$disconnect()
    process.exit(1)
  })
