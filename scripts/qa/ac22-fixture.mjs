#!/usr/bin/env node
/**
 * AC-22 · Open SDK（A2A / MCP）E2E —— **夹具常量**（纯数据，零副作用）
 * ═══════════════════════════════════════════════════════════════
 * 为什么单独一个文件（与 `ac19-fixture.mjs` 同一理由）：
 *   `.mjs` 是 `tsc` 的死角（见 `scripts/check-script-decls.mjs` 文件头）。
 *   两份 id 常量一旦漂移，症状是**运行期静默**：seed 造了 `org_ac22_a`，
 *   verify 去查 `org_ac22_b`，于是"越权必须失败"那条断言**因为 findFirst 返回 null
 *   而变绿** —— 假绿，且指向的方向恰好与真相相反。抽成单一来源后结构性免疫。
 *
 * ── 两个租户的用途 ──────────────────────────────────────────────
 *   org_ac22_a：**我们的人**所在的群。三个角色刻意选成阶梯：
 *               MEMBER（无 mission.read）< OPERATOR（有）< OWNER（全有）。
 *               「同一个工具、同一个群、只换角色」是 AC-22 最干净的对照 ——
 *               它排除了"数据不存在""路径不对""功能坏了"等一切其它解释。
 *   org_ac22_b：**我们的人都不是成员**的群。用于证明 `organizationId` 这个
 *               **入参**不能把权限范围撑大（把 org 参数当授权依据 = 经典越权）。
 */

/** 隔离库里的登录口令（与 AC-19 / t02 同一默认值，便于人工复现）。 */
export const AC22_PASSWORD = process.env.E2E_PASSWORD || 'E2E-Test-Passw0rd!'

export const AC22_ORGS = {
  /** 我们所在的群。 */
  a: { id: 'org_ac22_a', name: 'AC22 开放 SDK 示范群', slug: 'ac22-a' },
  /** 与我们**无关**的群 —— 只作为 `organizationId` 越权靶标。 */
  b: { id: 'org_ac22_b', name: 'AC22 外部群（越权靶标）', slug: 'ac22-b' },
}

/**
 * 三个账号 = 三档权限阶梯。
 *
 * 关键：`mission.read` 在 `capabilities.ts` 里属 OPERATOR_EXTRA，
 * MEMBER **没有**。因此 `list_missions`（能力 `mission.read`）天然是一条
 * 「MEMBER 必须被拒、OPERATOR 必须成功」的对照 —— 不需要任何取巧。
 */
export const AC22_USERS = {
  aOwner: { id: 'u_ac22_a_owner', email: 'ac22.owner@example.test', name: 'AC22 群主', role: 'OWNER' },
  aOperator: { id: 'u_ac22_a_operator', email: 'ac22.operator@example.test', name: 'AC22 运营', role: 'OPERATOR' },
  aMember: { id: 'u_ac22_a_member', email: 'ac22.member@example.test', name: 'AC22 成员', role: 'MEMBER' },
}

/** 一条 Mission：让「授权路径」断言的是**真实数据**，而不是"空列表也算成功"。 */
export const AC22_MISSION = { id: 'mission_ac22_a', token: 'ac22MissionTokenAaaaaaaaaaaaaaa' }

/** 档案（`list_missions` 的 DTO 会带 owner 展示名，缺档案会得到空串）。 */
export const AC22_PROFILES = {
  aOwner: {
    id: 'pf_ac22_a_owner',
    displayName: '岑叙',
    age: 34,
    gender: 'MAN',
    sexuality: 'Straight',
    bio: '经营一个跨行业协作社群，只做能落地的对接。',
    city: '上海',
    occupation: '社群主理人',
    company: '叙光社',
  },
  aOperator: {
    id: 'pf_ac22_a_operator',
    displayName: '应岚',
    age: 31,
    gender: 'WOMAN',
    sexuality: 'Straight',
    bio: '负责社群日常运营与对接流程，习惯把每件事留痕。',
    city: '杭州',
    occupation: '运营负责人',
    company: '叙光社',
  },
  aMember: {
    id: 'pf_ac22_a_member',
    displayName: '骆行',
    age: 36,
    gender: 'MAN',
    sexuality: 'Straight',
    bio: '做区域渠道，正在找能长期配合的供给方。',
    city: '成都',
    occupation: '渠道经理',
    company: '叙光社',
  },
}

/**
 * 工具的 `requiredCapability` 由 `src/lib/interop/tools.ts` 单一来源定义，
 * 这里**不复制**它 —— 只声明"本夹具用哪几条做对照"，并逐条注明期望结论。
 *
 * 若哪天有人在 `tools.ts` 里把 `list_missions` 的能力改成 `mission.read` 之外的值，
 * verify 会读到 `x-required-capability` 并据它推导期望（见 verify 脚本），
 * 于是对照关系**依然成立**（"MEMBER 是否具备该能力"仍由角色表判定）。
 * 硬编码能力名才是真正的漂移源。
 */
export const AC22_PROBE_TOOLS = {
  /** 能力 `mission.read`（OPERATOR+）：MEMBER 必拒、OPERATOR 必成。 */
  elevated: { tool: 'list_missions', capability: 'mission.read' },
  /** 能力 `bridge.read`（SELF_SERVICE）：任何成员都该成功。 */
  selfService: { tool: 'list_bridges', capability: 'bridge.read' },
}
