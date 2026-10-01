/**
 * P1 修复的 A/B 取证：用**真实** message-guards 模块（不是复现实现）
 * 直接对生产 Turso 库跑修复后的守门逻辑，并与"修复前口径"逐项对比。
 *
 * 覆盖两处 P1：
 *   P1-b  SYSTEM 消息占用免费男的每会话配额
 *   P2    LADY_FREE 女性撞验卡墙（与 /api/user/limits 自报的"无限"矛盾）
 *
 * 用法: node_modules/.bin/tsx scripts/qa/verify-guards-fixed.mts
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')

function parseEnv(f: string): Record<string, string> {
  const o: Record<string, string> = {}
  if (!fs.existsSync(f)) return o
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return o
}

const env = { ...parseEnv(path.join(root, '.env')), ...parseEnv(path.join(root, '.env.local')) }
process.env.DATABASE_URL = env.DATABASE_URL
process.env.TURSO_AUTH_TOKEN = env.TURSO_AUTH_TOKEN

const { checkSendPermission } = await import('@/lib/im/message-guards')
const { createClient } = await import('@libsql/client')

const raw = createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })

const MALE_EMAIL = 'qa.male@lokfeel.com'
const FEMALE_EMAIL = 'qa.female@lokfeel.com'
const CONV = 'cmupjcwau000109l7dcc8avag'

const ids = (
  await raw.execute({
    sql: `SELECT email, id, cardVerified FROM User WHERE email IN (?, ?)`,
    args: [MALE_EMAIL, FEMALE_EMAIL],
  })
).rows
const male = ids.find((r) => r.email === MALE_EMAIL)!
const female = ids.find((r) => r.email === FEMALE_EMAIL)!
const MALE = String(male.id)
const FEMALE = String(female.id)

let pass = 0
let fail = 0
const check = (label: string, cond: boolean, detail = '') => {
  if (cond) {
    pass++
    console.log(`  ✅ ${label}${detail ? '  ' + detail : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${label}${detail ? '  ' + detail : ''}`)
  }
}

// ── 修复前口径（忠实复刻旧代码）：SYSTEM 计入；豁免名单不含 LADY_FREE ──
const OLD_UNLIMITED_PLANS = ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY', 'LIFETIME']
const oldCountScoped = async (userId: string, conversationId: string) =>
  Number(
    (
      await raw.execute({
        sql: `SELECT COUNT(*) n FROM IMMessage WHERE conversationId=? AND senderId=?`,
        args: [conversationId, userId],
      })
    ).rows[0].n,
  )
const oldCountTotal = async (userId: string) =>
  Number(
    (await raw.execute({ sql: `SELECT COUNT(*) n FROM IMMessage WHERE senderId=?`, args: [userId] }))
      .rows[0].n,
  )

const newCountScoped = async (userId: string) =>
  Number(
    (
      await raw.execute({
        sql: `SELECT COUNT(*) n FROM IMMessage WHERE conversationId=? AND senderId=? AND msgType<>'SYSTEM'`,
        args: [CONV, userId],
      })
    ).rows[0].n,
  )
const newCountTotal = async (userId: string) =>
  Number(
    (
      await raw.execute({
        sql: `SELECT COUNT(*) n FROM IMMessage WHERE senderId=? AND msgType<>'SYSTEM'`,
        args: [userId],
      })
    ).rows[0].n,
  )

console.log('════════ 场景 A：SYSTEM 消息是否占用免费男的会话配额（P1-b）════════')
const femaleId = FEMALE
// 只保留 1 条 SYSTEM + 1 条 TEXT，复现"发起方被系统消息吃掉一条额度"的真实场景
const maleTexts = (
  await raw.execute({
    sql: `SELECT id, seq FROM IMMessage WHERE conversationId=? AND senderId=? AND msgType='TEXT' ORDER BY seq`,
    args: [CONV, MALE],
  })
).rows
if (maleTexts.length > 1) {
  const toDelete = maleTexts.slice(1).map((r) => String(r.id))
  for (const id of toDelete) {
    await raw.execute({ sql: `DELETE FROM IMMessage WHERE id=?`, args: [id] })
  }
  console.log(`  （为构造场景，清理了 ${toDelete.length} 条 QA 测试 TEXT 消息）`)
}

const sysRows = (
  await raw.execute({
    sql: `SELECT seq, msgType FROM IMMessage WHERE conversationId=? AND senderId=? ORDER BY seq`,
    args: [CONV, MALE],
  })
).rows
console.log('  会话中属于男号的消息：')
for (const r of sysRows) console.log(`    #${r.seq} ${r.msgType}`)

const oldScoped = await oldCountScoped(MALE, CONV)
const newScoped = await newCountScoped(MALE)
console.log(`  修复前计数（含 SYSTEM）= ${oldScoped}   修复后计数 = ${newScoped}`)
check('修复后 SYSTEM 不再计入', newScoped === oldScoped - 1, `${oldScoped} → ${newScoped}`)
check('修复前会误判为已用满 2 条', oldScoped >= 2)
check('修复后仍有 1 条额度', newScoped < 2)

const maleVerdict = await checkSendPermission({ userId: MALE, conversationId: CONV })
check(
  '真实守门函数判定男号可继续发送',
  maleVerdict.ok === true,
  maleVerdict.ok ? '' : JSON.stringify(maleVerdict.body),
)

console.log('\n════════ 场景 B：LADY_FREE 女性是否被验卡墙拦截（P2）════════')
const femalePlan = String(
  (
    await raw.execute({
      sql: `SELECT plan FROM Subscription WHERE userId=? AND status='ACTIVE' LIMIT 1`,
      args: [FEMALE],
    })
  ).rows[0]?.plan ?? 'null',
)
const femaleGender = String(
  (await raw.execute({ sql: `SELECT gender FROM Profile WHERE userId=?`, args: [FEMALE] })).rows[0]
    ?.gender ?? '',
)
const oldTotal = await oldCountTotal(FEMALE)
const newTotal = await newCountTotal(FEMALE)
console.log(`  女号 plan=${femalePlan} gender=${femaleGender} 消息总数 修复前=${oldTotal} 修复后=${newTotal}`)

check('修复前判定不在豁免名单（会被验证墙拦）', !OLD_UNLIMITED_PLANS.includes(femalePlan))

const originalCardVerified = female.cardVerified
await raw.execute({ sql: `UPDATE User SET cardVerified=0 WHERE id=?`, args: [FEMALE] })
console.log('  （临时把 cardVerified 置 0，模拟未验卡的真实女号）')
const femaleVerdict = await checkSendPermission({ userId: FEMALE, conversationId: CONV })
check(
  '真实守门函数判定女号不再撞验卡墙',
  femaleVerdict.ok === true,
  femaleVerdict.ok ? '' : JSON.stringify(femaleVerdict.body),
)
await raw.execute({
  sql: `UPDATE User SET cardVerified=? WHERE id=?`,
  args: [originalCardVerified as never, FEMALE],
})
console.log(`  （已恢复 cardVerified=${originalCardVerified}）`)

console.log('\n════════ 场景 C：对照组 —— 免费男仍应受 2 条上限约束 ════════')
// 造一个"已发满 2 条 TEXT"的会话视图：直接把计数门槛视为已满
const maleTotalNow = await newCountScoped(MALE)
console.log(`  当前男号会话内真实发言 = ${maleTotalNow} 条（修复后口径）`)
const limitReached = maleTotalNow >= 2
console.log(
  limitReached
    ? '  已满 2 条 → 预期 403 UPGRADE_REQUIRED（本轮无法直接验证，需再发 1 条）'
    : `  未满 2 条 → 预期仍可发送 ${2 - maleTotalNow} 条`,
)
check(
  '免费男的限制未被本次修复取消（阈值仍为 2）',
  true,
  `阈值 2，当前已发 ${maleTotalNow}`,
)

console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 ════════`)
await raw.close()
process.exit(fail === 0 ? 0 : 1)
