/**
 * 创建 P0 QA 测试账号（一男一女），幂等。
 *
 * 设计要点：
 *  - isBot = false  ← 关键！若为 true，Bot 引擎会以该账号身份自动回复（lib/im/bot-gate.ts）
 *  - profileStatus = APPROVED / onboardingStep = 9  ← 与真实可用用户一致
 *  - 女性账号建 LADY_FREE 订阅（对齐 register/route.ts:315-329 的真实行为）
 *  - 男性账号**不建**订阅 → 走 FREE 兜底，便于测试付费升级链路
 *  - 密码用 bcrypt cost 12，与 src/lib/auth/auth.ts:hashPassword 完全一致
 *  - email 前缀 `qa.` 便于后续按前缀清理
 *
 * 用法: node scripts/qa/create-qa-accounts.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createClient } from '@libsql/client'
import bcrypt from 'bcryptjs'

const root = path.resolve(import.meta.dirname, '../..')
function parseEnv(f) {
  const o = {}
  if (!fs.existsSync(f)) return o
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return o
}
const env = { ...parseEnv(path.join(root, '.env')), ...parseEnv(path.join(root, '.env.local')) }
const db = createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })

// 凭据统一从 scripts/qa/qa-credentials.mjs 解析（public 仓库不入库）
import { QA_PASSWORD } from './qa-credentials.mjs'
const PASSWORD = QA_PASSWORD
const now = new Date().toISOString()

function dicebear(gender, seed) {
  // 现行词表是 MAN/WOMAN（历史 MALE/FEMALE 已于 2026-10 迁移）
  const isFemale = ['FEMALE', 'WOMAN', 'TRANSGENDER_WOMAN'].includes((gender || '').toUpperCase())
  const bg = isFemale ? 'f3a8f9,ec4899,f472b6' : '3b82f6,6366f1,06b6d4'
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${bg}&radius=50`
}

const ACCOUNTS = [
  {
    email: 'qa.male@lokfeel.com',
    name: 'Ethan Brooks',
    gender: 'MAN',
    age: 31,
    sexuality: 'STRAIGHT',
    preferredGender: 'WOMAN',
    relationshipGoal: 'MONOGAMY',
    occupation: 'Software Engineer',
    city: 'San Francisco, CA',
    bio: 'QA baseline account (male). Used for internal end-to-end verification of matching, chat and payments.',
    tags: ['Hiking', 'Coffee', 'Tech', 'Cycling'],
    withSubscription: false,
  },
  {
    email: 'qa.female@lokfeel.com',
    name: 'Sophie Bennett',
    gender: 'WOMAN',
    age: 28,
    sexuality: 'STRAIGHT',
    preferredGender: 'MAN',
    relationshipGoal: 'MONOGAMY',
    occupation: 'Product Designer',
    city: 'New York, NY',
    bio: 'QA baseline account (female). Used for internal end-to-end verification of matching, chat and video calls.',
    tags: ['Yoga', 'Travel', 'Art', 'Brunch'],
    withSubscription: true,
  },
]

const hash = await bcrypt.hash(PASSWORD, 12)
console.log('bcrypt hash ready (cost 12)\n')

const results = []

for (const a of ACCOUNTS) {
  const existing = await db.execute({
    sql: 'SELECT id FROM User WHERE email = ?',
    args: [a.email],
  })

  let userId
  if (existing.rows.length) {
    userId = existing.rows[0].id
    await db.execute({
      sql: `UPDATE User SET name=?, password=?, role='USER', isBot=0, emailVerified=?, tokenVersion=0, updatedAt=?, deletedAt=NULL WHERE id=?`,
      args: [a.name, hash, now, now, userId],
    })
    console.log(`↻ 更新既有账号 ${a.email}`)
  } else {
    userId = crypto.randomUUID()
    await db.execute({
      sql: `INSERT INTO User (id, name, email, emailVerified, password, role, isBot, cardVerified, createdAt, updatedAt, tokenVersion)
            VALUES (?,?,?,?,?,'USER',0,0,?,?,0)`,
      args: [userId, a.name, a.email, now, hash, now, now],
    })
    console.log(`+ 新建账号 ${a.email}`)
  }

  const avatar = dicebear(a.gender, `${a.name}-${a.email}`)
  const prof = await db.execute({
    sql: 'SELECT id FROM Profile WHERE userId = ?',
    args: [userId],
  })

  const profileCols = {
    displayName: a.name,
    age: a.age,
    gender: a.gender,
    genderIdentity: a.gender,
    sexuality: a.sexuality,
    bio: a.bio,
    avatar,
    avatarType: 'photo',
    galleryPhotos: '[]',
    city: a.city,
    country: 'US',
    relationshipGoal: a.relationshipGoal,
    attachmentStyle: 'Secure',
    communicationStyle: 'Direct',
    conflictResolution: 'Collaborative',
    loveLanguage: 'Quality Time',
    boundaries: JSON.stringify(['Respect personal space', 'Honest communication']),
    dealbreakers: JSON.stringify(['Dishonesty']),
    lifePriorities: JSON.stringify(['Career', 'Health', 'Family']),
    emotionalAvailability: 'Fully Available',
    selectedTags: JSON.stringify(a.tags),
    preferredAgeMin: 24,
    preferredAgeMax: 40,
    preferredGender: a.preferredGender,
    preferredDistance: 100,
    preferredLocation: a.city,
    profileStatus: 'APPROVED',
    onboardingStep: 9,
    isApproved: 1,
    isVerified: 1,
    occupation: a.occupation,
    updatedAt: now,
  }

  if (prof.rows.length) {
    const keys = Object.keys(profileCols)
    await db.execute({
      sql: `UPDATE Profile SET ${keys.map(k => `${k}=?`).join(', ')} WHERE userId=?`,
      args: [...keys.map(k => profileCols[k]), userId],
    })
    console.log(`  ↻ Profile 已更新 (${a.gender}, APPROVED, step 9)`)
  } else {
    const keys = Object.keys(profileCols)
    await db.execute({
      sql: `INSERT INTO Profile (id, userId, createdAt, ${keys.join(', ')}) VALUES (?,?,?,${keys.map(() => '?').join(',')})`,
      args: [crypto.randomUUID(), userId, now, ...keys.map(k => profileCols[k])],
    })
    console.log(`  + Profile 已创建 (${a.gender}, APPROVED, step 9)`)
  }

  if (a.withSubscription) {
    const sub = await db.execute({
      sql: "SELECT id FROM Subscription WHERE userId=? AND plan='LADY_FREE'",
      args: [userId],
    })
    if (!sub.rows.length) {
      await db.execute({
        sql: `INSERT INTO Subscription (id, userId, plan, status, weeklyMatchLimit, canInitiateChat, canViewFullProfile, startsAt, endsAt, createdAt, updatedAt)
              VALUES (?,?,'LADY_FREE','ACTIVE',5,1,1,?,?,?,?)`,
        args: [crypto.randomUUID(), userId, now, new Date('2099-12-31').toISOString(), now, now],
      })
      console.log('  + LADY_FREE 订阅已创建')
    } else {
      console.log('  ↻ LADY_FREE 订阅已存在')
    }
  } else {
    console.log('  · 不建订阅（走 FREE 兜底，用于测试付费升级）')
  }

  results.push({ ...a, userId })
}

console.log('\n================ 回读验证 ================')
for (const r of results) {
  const v = await db.execute({
    sql: `SELECT u.id, u.email, u.name, u.role, u.isBot, u.emailVerified IS NOT NULL AS verified, u.password IS NOT NULL AS hasPwd,
                 p.gender, p.profileStatus, p.onboardingStep, p.isApproved, p.preferredGender, p.galleryPhotos,
                 (SELECT plan FROM Subscription s WHERE s.userId=u.id AND s.status='ACTIVE' LIMIT 1) AS plan
            FROM User u LEFT JOIN Profile p ON p.userId=u.id WHERE u.email=?`,
    args: [r.email],
  })
  console.log(JSON.stringify(v.rows[0], null, 0))
}

console.log('\n================ 凭据 ================')
console.log(`登录地址: https://app.lokfeel.com/login`)
console.log(`统一密码: ${PASSWORD}`)
for (const r of results) {
  console.log(`  ${r.gender.padEnd(7)} ${r.email.padEnd(24)} ${r.name}`)
}

await db.close()
