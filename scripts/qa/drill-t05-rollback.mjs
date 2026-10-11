#!/usr/bin/env node
/**
 * T05 · 回滚演练（隔离库副本，不碰任何真实库）
 *
 * 目的：把 `docs/implementation/T05/rollback.md` 里的 DROP 语句**真的跑一遍**，
 * 而不是只贴一段"应该能跑"的 SQL。
 *
 * 用法：
 *   cp /tmp/t02-e2e.db /tmp/t05-drill.db   # 先复制一份种子库
 *   node scripts/qa/drill-t05-rollback.mjs
 */
import { createClient } from '@libsql/client'
import { copyFileSync, existsSync } from 'node:fs'

const SRC = '/tmp/t02-e2e.db'
const DST = '/tmp/t05-drill.db'

if (!existsSync(DST)) copyFileSync(SRC, DST)

const client = createClient({ url: `file:${DST}` })

const q = async (sql) => (await client.execute(sql)).rows
const count = async (table) => {
  try {
    const rows = await q(`SELECT COUNT(*) AS n FROM "${table}"`)
    return Number(rows[0].n)
  } catch (e) {
    return `ERR:${String(e.message).split('\n')[0]}`
  }
}

console.log('── ① 演练库现状（回滚前）──')
for (const t of ['ConnectionProposal', 'ProposalDecision']) {
  console.log(`   ${t} 行数 = ${await count(t)}`)
}

console.log('\n── ② 执行回滚 DDL（顺序：先子表后父表，避免外键悬念）──')
await client.execute('DROP TABLE IF EXISTS "ProposalDecision"')
await client.execute('DROP TABLE IF EXISTS "ConnectionProposal"')
console.log('   DROP TABLE ProposalDecision → ok')
console.log('   DROP TABLE ConnectionProposal → ok')

console.log('\n── ③ 回滚后核对 ──')
for (const t of ['ConnectionProposal', 'ProposalDecision']) {
  console.log(`   ${t} 行数 = ${await count(t)}（期望 ERR:no such table）`)
}
// 反向自证：**其他**表必须原封不动 —— 否则"回滚"就误伤了别人的数据。
for (const t of ['SocialIntent', 'MissionParticipation', 'User', 'Mission']) {
  console.log(`   ${t} 行数 = ${await count(t)}（期望仍是原值）`)
}

client.close()
