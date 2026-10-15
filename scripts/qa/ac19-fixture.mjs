#!/usr/bin/env node
/**
 * AC-19 · Community Bridge E2E —— **夹具常量**（纯数据，零副作用）
 * ═══════════════════════════════════════════════════════════════
 * 为什么单独一个文件而不是在 seed / verify 里各写一份：
 *   `.mjs` 是 `tsc` 的死角（见 `scripts/check-script-decls.mjs` 的文件头）。
 *   两份 id 常量一旦漂移，症状是**运行期静默**：seed 造了 `br_ac19_ab`，
 *   verify 去查 `br_ac19_a_b` → 404 → 断言写成"必须 404"的那条反而变绿，
 *   而正向断言失败给出的是"看不见成员"这种指向功能缺陷的假信号。
 *   抽成单一来源后，漂移在**结构上**不可能发生。
 *
 * 本文件只导出字面量，不 import 任何东西，不读写文件、不起进程。
 *
 * ── 三个租户的用途 ───────────────────────────────────────────────
 *   甲群 A：主协议 A↔B 的**发起方**。
 *   乙群 B：主协议 A↔B 的**被邀方**；同时是越权靶标 B↔C 的发起方。
 *   丙群 C：只用于两条「不是当事方就看不见」的证据 ——
 *           ① A 的成员读 B↔C 协议 → 必须 404；
 *           ② A 通过真实 POST 新建 A↔C 协议，证明发起链路与幂等。
 */

/** 隔离库里的**登录口令**（与 seed-t02-e2e.mjs 同一默认值，便于人工复现）。 */
export const AC19_PASSWORD = process.env.E2E_PASSWORD || 'E2E-Test-Passw0rd!'

/** 三个租户。 */
export const AC19_ORGS = {
  a: { id: 'org_ac19_a', name: 'AC19 甲群', slug: 'ac19-a' },
  b: { id: 'org_ac19_b', name: 'AC19 乙群', slug: 'ac19-b' },
  c: { id: 'org_ac19_c', name: 'AC19 丙群', slug: 'ac19-c' },
}

/**
 * 七个账号。
 *
 * 角色与**要证明的事**一一对应，不是随手配的：
 *   · aOwner  OWNER  → 有 `bridge.manage`，但是**发起方** ⇒ 点批准必须 403（WRONG_SIDE）。
 *   · aMember MEMBER → 只有 `bridge.read`/`bridge.optin` ⇒ 点批准必须 403（能力不足）。
 *   · bOwner  OWNER  → **唯一**能把协议从 PENDING 推到 ACTIVE 的人。
 *   · bMember MEMBER → 主角：opt-in + 意图三环收窄都被它取证。
 *   · bMember2       → 有意图、**未 opt-in** ⇒ 跨群投影里必须不出现。
 *   · bMember3       → 已 opt-in、**无意图** ⇒ 只进 `gatedOut`（NO_INTENT_DISCLOSURE），不进成员列表。
 *   · cOwner  OWNER  → 丙群群主，用于 A↔C 的发起链路。
 */
export const AC19_USERS = {
  aOwner: { id: 'u_ac19_a_owner', email: 'a.owner@example.test', name: 'AC19 甲群主', org: 'a', role: 'OWNER' },
  aMember: { id: 'u_ac19_a_member', email: 'a.member@example.test', name: 'AC19 甲成员', org: 'a', role: 'MEMBER' },
  bOwner: { id: 'u_ac19_b_owner', email: 'b.owner@example.test', name: 'AC19 乙群主', org: 'b', role: 'OWNER' },
  bMember: { id: 'u_ac19_b_member', email: 'b.member@example.test', name: 'AC19 乙成员', org: 'b', role: 'MEMBER' },
  bMember2: { id: 'u_ac19_b_member2', email: 'b.member2@example.test', name: 'AC19 乙成员二', org: 'b', role: 'MEMBER' },
  bMember3: { id: 'u_ac19_b_member3', email: 'b.member3@example.test', name: 'AC19 乙成员三', org: 'b', role: 'MEMBER' },
  cOwner: { id: 'u_ac19_c_owner', email: 'c.owner@example.test', name: 'AC19 丙群主', org: 'c', role: 'OWNER' },
}

/** 每个组织一条 Mission（`SocialIntent.missionId` 是必填 FK 锚点，删任务会级联删意图）。 */
export const AC19_MISSIONS = {
  a: { id: 'mission_ac19_a', token: 'ac19MissionTokenAaaaaaaaaaaaaaa' },
  b: { id: 'mission_ac19_b', token: 'ac19MissionTokenBbbbbbbbbbbbbbb' },
  c: { id: 'mission_ac19_c', token: 'ac19MissionTokenCcccccccccccccc' },
}

/** 两份 seed 出来的协议。A↔C 那份由 verify 走**真实 POST** 现场创建，故不在此列。 */
export const AC19_BRIDGES = {
  /** 主协议：甲发起、乙被邀，初始 `PENDING`。 */
  ab: 'br_ac19_ab',
  /** 越权靶标：乙发起、丙被邀 —— 甲**不是当事方**。 */
  bc: 'br_ac19_bc',
}

/**
 * 双边群主配置的字段键（甲乙两侧完全相同 ⇒ ①环交集 = 这四项）。
 *
 * 🔴 刻意让 ①环 比「实际可见」**宽**：四项都在双边配置里，但只有两项能出去。
 *    这正是 AC-19 要证的东西 —— 群主配好了不等于成员看得到。
 */
export const AC19_BRIDGE_FIELD_KEYS = ['displayName', 'city', 'company', 'occupation']

/**
 * 档案（披露投影的**值**全部来自这里）。
 *
 * 乙群三名成员的差异是**刻意设计**的三组对照：
 *   · bMember  有档案 + 有意图 + 会 opt-in  ⇒ 正向主角
 *   · bMember2 有档案 + 有意图 + **不 opt-in** ⇒ 反向「未 opt-in 不可见」
 *   · bMember3 有档案 + **无意图** + 会 opt-in ⇒ 反向「无披露依据」只进 gatedOut
 */
export const AC19_PROFILES = {
  aMember: {
    id: 'pf_ac19_a_member',
    displayName: '林晓',
    age: 32,
    gender: 'WOMAN',
    sexuality: 'Straight',
    bio: '八年跨境供应链经验，做过印尼与越南市场的落地。',
    city: '上海',
    occupation: '供应链负责人',
    company: '启航贸易',
  },
  bMember: {
    id: 'pf_ac19_b_member',
    displayName: '周雨',
    age: 35,
    gender: 'WOMAN',
    sexuality: 'Straight',
    bio: '在深圳做渠道管理，擅长把新品类铺进线下连锁。',
    city: '深圳',
    occupation: '渠道总监',
    company: '云图科技',
  },
  bMember2: {
    id: 'pf_ac19_b_member2',
    displayName: '陈岸',
    age: 38,
    gender: 'MAN',
    sexuality: 'Straight',
    bio: '采购侧出身，负责华南区的供应商准入。',
    city: '广州',
    occupation: '采购经理',
    company: '广发实业',
  },
  bMember3: {
    id: 'pf_ac19_b_member3',
    displayName: '吴桐',
    age: 29,
    gender: 'MAN',
    sexuality: 'Straight',
    bio: '产品经理，正在做跨境履约链路的产品化。',
    city: '杭州',
    occupation: '产品经理',
    company: '灵犀科技',
  },
}

/**
 * 意图披露表（**第三环**）。键 → 档位。
 *
 * 🔴 `bMember` 的四项覆盖了「三环收窄」的全部形态，这是本夹具最关键的一处设计：
 *   displayName CANDIDATE    → 三环都放行 ⇒ **可见**
 *   city        CANDIDATE    → 三环都放行 ⇒ **可见**
 *   company     ORGANIZER    → ①环放行、②环勾了、③环不够 ⇒ 归因 `INTENT_DISCLOSURE`
 *   occupation  COUNTERPARTY → 同上 ⇒ 归因 `INTENT_DISCLOSURE`
 *   两档都 < CANDIDATE（档位序 SELF<ORGANIZER<COUNTERPARTY<CANDIDATE），
 *   因此 `audienceCanSee(granted,'CANDIDATE')` 为 false。若哪天有人把第三环放宽成
 *   `COUNTERPARTY` 档，本夹具会立刻把 `company`/`occupation` 判成可见 ⇒ 断言报红。
 */
export const AC19_INTENT_DISCLOSURE = {
  aMember: { displayName: 'CANDIDATE', city: 'CANDIDATE' },
  bMember: {
    displayName: 'CANDIDATE',
    city: 'CANDIDATE',
    company: 'ORGANIZER',
    occupation: 'COUNTERPARTY',
  },
  bMember2: { displayName: 'CANDIDATE' },
  // bMember3：**故意不给意图**（见 AC19_PROFILES 的对照设计）。
}

/** seed 与 verify 都要用到的派生期望值（单一来源，避免两处各写一份）。 */
export const AC19_EXPECT = {
  /** ①环交集（双边配置相同）。 */
  agreedKeys: ['city', 'company', 'displayName', 'occupation'],
  /** 乙群 bMember 在甲群视角里**真正可见**的字段键（内核稳定排序 = 字母序）。 */
  bMemberVisibleKeys: ['city', 'displayName'],
  /** 甲群 aMember 在乙群视角里真正可见的字段键。 */
  aMemberVisibleKeys: ['city', 'displayName'],
  /** bMember 收窄后的可见键（只勾 displayName 时）。 */
  bMemberNarrowedKeys: ['displayName'],
  /** 被第三环挡住的两项（归因 INTENT_DISCLOSURE / 归属 MEMBER）。 */
  intentNarrowedKeys: ['company', 'occupation'],
  /** 字段标签（UI 断言用；取自字段目录，不是硬编码中文串的猜测）。 */
  labels: { displayName: '昵称', city: '城市', company: '公司', occupation: '职业' },
}

/** 协议状态文案（与 `BRIDGE_STATUS_LABELS` 一致 —— UI 断言用）。 */
export const AC19_STATUS_LABELS = {
  PENDING: '等待对方群主批准',
  ACTIVE: '已生效',
  REVOKED: '已撤销',
}

/** 拒绝码文案（与 `BRIDGE_REFUSAL_LABELS` 一致）。 */
export const AC19_REFUSAL_LABELS = {
  BRIDGE_PENDING: '等待对方群主批准，暂不能共享',
  BRIDGE_REVOKED: '协议已被撤销',
  NO_INTENT_DISCLOSURE: '该成员没有生效中的意图，无披露依据',
}
