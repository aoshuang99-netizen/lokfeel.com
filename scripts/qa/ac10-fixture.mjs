#!/usr/bin/env node
/**
 * AC-10 · 数据生命周期 E2E —— **夹具常量**（纯数据，零副作用）
 * ═══════════════════════════════════════════════════════════════
 * 为什么单独一个文件（与 `ac19-fixture.mjs` / `ac22-fixture.mjs` 同一理由）：
 *   `.mjs` 是 `tsc` 的死角。两份 id 一旦漂移，症状是**运行期静默**：
 *   seed 造了 `u_ac10_subject`，verify 去查 `u_ac10_other`，
 *   于是"删干净了"那条断言**因为在错的账号上查而变绿** —— 假绿。
 *
 * ⚠️ 本文件**不得**有任何顶层副作用：verify 脚本要 import 它，
 *    而 seed 脚本在顶层调用 `main()`。把常量与副作用混在一个文件里，
 *    import 常量会顺带执行一次播种。
 */

/** 隔离库里的登录口令。 */
export const AC10_PASSWORD = process.env.E2E_PASSWORD || 'E2E-Test-Passw0rd!'

/** 夹具 id（seed 与 verify 共用同一来源）。 */
export const AC10_IDS = {
  org: 'org_ac10',
  orgPeer: 'org_ac10_peer',
  user: 'u_ac10_subject',
  other: 'u_ac10_other',
  profile: 'pf_ac10_subject',
  profileOther: 'pf_ac10_other',
  membership: 'ms_ac10_subject',
  mission: 'mission_ac10',
  intent: 'intent_ac10',
  participation: 'mp_ac10',
  bridge: 'bridge_ac10',
  optIn: 'boi_ac10',
  agentRun: 'ar_ac10',
  notification: 'ntf_ac10',
}

/**
 * 待销号账号里**真实存在**的 PII。
 *
 * verify 用这些字符串做**值级**断言：
 *   · 导出物里**必须**出现（证明导出真的读到了数据，而不是"空也绿"）；
 *   · 销号后**必须**消失（证明擦除真的发生）。
 * 同一条字符串承担两个方向 —— 这正是"先证前置非空、再断言消失"的做法。
 */
export const AC10_PII = {
  email: 'ac10.subject@example.test',
  name: 'AC10 待销号用户',
  displayName: '岑十',
  bio: '这是待销号用户的自我介绍 —— 销号后必须不可读。',
  city: '上海',
  occupation: '渠道经理',
  company: '叙光社',
  adminNotes: '内部运营备注 —— 不该出现在导出物里。',
  intentNeed: '需要长期的供给方配合。',
  intentOffer: '可提供华东区渠道资源。',
  agentGoal: '帮我把这段意图整理成可读的提案。',
  agentRawText: '模型原始输出 —— 销号后必须清空。',
  notificationBody: '你有一条新消息 —— 销号后应被删除。',
}

/** 对照组账号（删除他**不该**被波及）。 */
export const AC10_OTHER = {
  email: 'ac10.other@example.test',
  name: 'AC10 对照用户',
  displayName: '对照用户',
}

/** 销号后的期望值（与 `src/lib/lifecycle/account.ts` 的常量**逐字一致**）。 */
export const AC10_EXPECT = {
  emailDomain: 'erased.invalid',
  displayName: '已注销用户',
  textPlaceholder: '[erased]',
}
