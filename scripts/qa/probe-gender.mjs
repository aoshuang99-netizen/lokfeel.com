/**
 * QA 探测 2：性别枚举实际取值 + 真实用户样本 + e2e.test 详情
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'

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

const q = async (label, sql) => {
  const r = await db.execute(sql)
  console.log(`\n=== ${label} ===`)
  for (const row of r.rows) console.log('  ' + JSON.stringify(row))
}

await q('gender 取值分布（全表）', `SELECT gender, COUNT(*) n FROM Profile GROUP BY gender ORDER BY n DESC`)
await q('preferredGender 取值', `SELECT preferredGender, COUNT(*) n FROM Profile GROUP BY preferredGender ORDER BY n DESC LIMIT 10`)
await q('sexuality 取值', `SELECT sexuality, COUNT(*) n FROM Profile GROUP BY sexuality ORDER BY n DESC LIMIT 12`)
await q('relationshipGoal 取值', `SELECT relationshipGoal, COUNT(*) n FROM Profile GROUP BY relationshipGoal ORDER BY n DESC LIMIT 10`)
await q('profileStatus 取值', `SELECT profileStatus, COUNT(*) n FROM Profile GROUP BY profileStatus ORDER BY n DESC`)
await q('subscription plan 取值', `SELECT plan, status, COUNT(*) n FROM Subscription GROUP BY plan, status ORDER BY n DESC LIMIT 12`)
await q('avatarType 取值', `SELECT avatarType, COUNT(*) n FROM Profile GROUP BY avatarType ORDER BY n DESC LIMIT 8`)

await q('真实用户样本(isBot=0, 非bot域)', `
  SELECT u.email, u.name, u.role, p.gender, p.profileStatus, p.onboardingStep, p.avatarType,
         (SELECT plan FROM Subscription s WHERE s.userId=u.id LIMIT 1) AS plan
    FROM User u JOIN Profile p ON p.userId=u.id
   WHERE u.isBot=0 AND u.email NOT LIKE '%@lokfeel.bot'
   ORDER BY u.createdAt DESC LIMIT 15`)

await q('e2e.test 详情', `
  SELECT u.id, u.email, u.name, u.role, u.isBot, u.emailVerified, u.password IS NOT NULL AS hasPwd, u.tokenVersion,
         p.displayName, p.gender, p.sexuality, p.age, p.profileStatus, p.onboardingStep, p.isApproved
    FROM User u LEFT JOIN Profile p ON p.userId=u.id WHERE u.email='e2e.test@lokfeel.com'`)

await q('真实用户总数 / bot 总数', `
  SELECT (SELECT COUNT(*) FROM User WHERE isBot=0) realUsers,
         (SELECT COUNT(*) FROM User WHERE isBot=1) bots,
         (SELECT COUNT(*) FROM Profile WHERE gender IN ('MAN','MALE')) maleProfiles,
         (SELECT COUNT(*) FROM Profile WHERE gender IN ('WOMAN','FEMALE')) femaleProfiles`)

await db.close()
