#!/usr/bin/env node
/**
 * P0-09 / G5 · 真人用户测试统计门禁
 *
 * 作战包 §2：5 位真实非项目成员，至少 4/5 能说出「平台面向谁、提供什么结果」；
 * 每人完成预定核心任务，记录是否无需提示、错误、耗时、主动反馈。
 *
 * 本脚本只做**统计与判定**，不产生参与者、不模拟问答、不代替真人研究。
 * 判据（4/5、≥5 人）写死在函数里且不接受外部阈值参数 —— 防止"按实测反推阈值"
 * 把一次不达标的测试调成 PASS。素材齐备 ≠ 测试发生：无记录一律 NOT_TESTED。
 */
import { writeFileSync, readFileSync } from 'node:fs'

export const G5_MIN_PARTICIPANTS = 5
export const G5_MIN_PASS = 4

/**
 * @param {Array} records 观察记录，每条需含：
 *   participantId, understood(boolean), taskCompleted(boolean),
 *   taskSeconds(number), hintsNeeded(number), consent(boolean)
 */
export function scoreG5(records) {
  if (!Array.isArray(records)) return { verdict: 'ERROR', reasons: ['records_not_array'], stats: null }
  if (records.length === 0) return { verdict: 'NOT_TESTED', reasons: ['no_participant_records'], stats: { count: 0 } }
  if (records.length < G5_MIN_PARTICIPANTS) {
    return {
      verdict: 'NOT_TESTED',
      reasons: [`only_${records.length}_participants_need_${G5_MIN_PARTICIPANTS}`],
      stats: { count: records.length },
    }
  }
  const participants = records.slice(0, G5_MIN_PARTICIPANTS)
  for (const [i, r] of participants.entries()) {
    for (const field of ['participantId', 'understood', 'taskCompleted', 'taskSeconds', 'hintsNeeded', 'consent']) {
      if (r?.[field] === undefined || r?.[field] === null) {
        return { verdict: 'ERROR', reasons: [`record_${i}_missing_${field}`], stats: null }
      }
    }
    if (r.consent !== true) return { verdict: 'ERROR', reasons: [`record_${i}_no_informed_consent`], stats: null }
    if (typeof r.understood !== 'boolean' || typeof r.taskCompleted !== 'boolean') {
      return { verdict: 'ERROR', reasons: [`record_${i}_boolean_fields_invalid`], stats: null }
    }
  }
  const understood = participants.filter((r) => r.understood).length
  const completed = participants.filter((r) => r.taskCompleted).length
  const noHints = participants.filter((r) => r.hintsNeeded === 0).length
  const seconds = participants.map((r) => r.taskSeconds)
  const stats = {
    count: participants.length,
    understood,
    completed,
    noHints,
    medianTaskSeconds: [...seconds].sort((a, b) => a - b)[Math.floor(seconds.length / 2)],
    maxTaskSeconds: Math.max(...seconds),
    threshold: `${G5_MIN_PASS}/${G5_MIN_PARTICIPANTS}`,
  }
  const verdict = understood >= G5_MIN_PASS && completed >= G5_MIN_PASS ? 'PASS' : 'FAIL'
  return {
    verdict,
    reasons: verdict === 'PASS' ? ['both_key_criteria_met'] : [`understood_${understood}_completed_${completed}_need_${G5_MIN_PASS}_each`],
    stats,
  }
}

const arg = (name, fallback) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const input = arg('input', '')
  const out = arg('out', '')
  let records = []
  let readError = null
  if (input) {
    try { records = JSON.parse(readFileSync(input, 'utf8')) } catch (e) { readError = String(e?.message ?? e) }
  }
  const report = {
    checkedAt: new Date().toISOString(),
    source: input || 'none',
    note: '空记录 = 真人测试未发生，判 NOT_TESTED；本脚本不生成参与者、不模拟问答。',
    ...(readError ? { verdict: 'ERROR', reasons: [`cannot_read_input:${readError}`] } : scoreG5(records)),
  }
  const text = `${JSON.stringify(report, null, 2)}\n`
  process.stdout.write(text)
  if (out) writeFileSync(out, text, 'utf8')
  process.exitCode = report.verdict === 'PASS' ? 0 : report.verdict === 'NOT_TESTED' ? 2 : 1
}
