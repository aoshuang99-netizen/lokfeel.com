/**
 * T10 · **schema 漂移守卫**（TS 内核 ↔ Prisma 枚举 / 关系）
 *
 * 为什么必须有它（与 `tests/agents/schema-drift.test.ts` 同一理由）：
 * 内核的取值域（`BRIDGE_STATUSES`）与 DB 的存储形态（`CommunityBridgeStatus` 枚举）
 * 是**两份**清单，而它们**必须**逐字一致。漂移的后果不是编译错误，
 * 而是**运行期写入才炸**：只在 TS 加一个状态、忘了改 Prisma → 那条记录写不进去。
 * 因此这里读**真实的 .prisma 文件文本**做比对 —— 而不是 import 一个镜像常量
 * （那样只是把两份清单换成三份，漂移照旧）。
 *
 * ⚠️ 只 import 内核（`@/lib/bridge`，纯、无 IO）。**不得** import `@/lib/bridges` 桶：
 *    它会连带拉进 `@/lib/db` → `next-auth`（纯 ESM），在 jest 的 CJS 运行时会
 *    "Test suite failed to run"（这个坑在 T09 已经踩过一次）。
 */

import fs from 'fs'
import path from 'path'

import {
  BRIDGE_OPT_IN_STATUSES,
  BRIDGE_STATUSES,
  BRIDGE_STATUS_VIEWS,
  BRIDGE_REFUSAL_CODES,
  BRIDGE_ACTION_REFUSALS,
  BRIDGE_NARROW_REASONS,
  BRIDGE_NARROW_OWNER,
} from '@/lib/bridge'

const ROOT = path.resolve(__dirname, '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 从 schema 文本里抽出一个 enum 的取值清单。 */
function enumValues(schema: string, name: string): string[] {
  const re = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`, 'm')
  const m = schema.match(re)
  if (!m) throw new Error(`schema 里找不到 enum ${name} —— 漂移守卫读错了文件？`)
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('///'))
    .map((l) => l.split(/\s+/)[0])
}

/** 抽出一个 `model` 的声明体（按 model 名取块 —— 全文匹配分不清是哪张表的保证）。 */
function modelBlock(schema: string, name: string): string {
  const m = schema.match(new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!m) throw new Error(`schema 里找不到 model ${name}`)
  return m[1]
}

describe('T10 · Prisma 枚举 ↔ TS 内核清单 逐字一致', () => {
  const bridgeSchema = read('prisma/schema/bridge.prisma')

  it('CommunityBridgeStatus ↔ BRIDGE_STATUSES', () => {
    expect(enumValues(bridgeSchema, 'CommunityBridgeStatus').sort()).toEqual(
      [...BRIDGE_STATUSES].sort(),
    )
  })

  it('BridgeMemberOptInStatus ↔ BRIDGE_OPT_IN_STATUSES', () => {
    expect(enumValues(bridgeSchema, 'BridgeMemberOptInStatus').sort()).toEqual(
      [...BRIDGE_OPT_IN_STATUSES].sort(),
    )
  })

  it('🔴 `EXPIRED` **不在**落库枚举里 —— 它是派生值（落列就多出第二个事实来源）', () => {
    // 反向对照：对外视图**有** EXPIRED，落库枚举**没有**。两条断言方向相反、同时成立。
    expect([...BRIDGE_STATUS_VIEWS]).toContain('EXPIRED')
    expect(enumValues(bridgeSchema, 'CommunityBridgeStatus')).not.toContain('EXPIRED')
  })

  it('🔴 `DRAFT` **不在**枚举里 —— 发起方创建即视为已批准，留一个永不出现的状态只会制造死状态', () => {
    expect(enumValues(bridgeSchema, 'CommunityBridgeStatus')).not.toContain('DRAFT')
    expect(enumValues(bridgeSchema, 'CommunityBridgeStatus')).toContain('PENDING')
  })

  it('落库枚举恰好三个值（多一个就说明有人把派生状态或死状态塞了进来）', () => {
    expect(enumValues(bridgeSchema, 'CommunityBridgeStatus').sort()).toEqual([
      'ACTIVE',
      'PENDING',
      'REVOKED',
    ])
  })
})

describe('T10 · 内核拒绝码 / 归因清单的自洽性', () => {
  it('可见性拒绝码无重复且非空', () => {
    expect(BRIDGE_REFUSAL_CODES.length).toBeGreaterThan(0)
    expect(new Set(BRIDGE_REFUSAL_CODES).size).toBe(BRIDGE_REFUSAL_CODES.length)
  })

  it('动作拒绝码与可见性拒绝码**刻意分开**，但同名项语义必须一致（BRIDGE_REVOKED / BRIDGE_EXPIRED）', () => {
    // 两张表回答不同问题（"字段能不能被看到" vs "你能不能做这个操作"），
    // 但两者都用 BRIDGE_REVOKED / BRIDGE_EXPIRED 表达同一件事实 —— 这两项必须都在。
    expect([...BRIDGE_REFUSAL_CODES]).toContain('BRIDGE_REVOKED')
    expect([...BRIDGE_REFUSAL_CODES]).toContain('BRIDGE_EXPIRED')
    expect([...BRIDGE_ACTION_REFUSALS]).toContain('BRIDGE_REVOKED')
    expect([...BRIDGE_ACTION_REFUSALS]).toContain('BRIDGE_EXPIRED')
  })

  it('每个「收窄原因」都有确定的负责人（ORGANIZER / MEMBER）—— 不给 UI 猜的机会', () => {
    for (const reason of BRIDGE_NARROW_REASONS) {
      expect(['ORGANIZER', 'MEMBER']).toContain(BRIDGE_NARROW_OWNER[reason])
    }
    expect(Object.keys(BRIDGE_NARROW_OWNER).sort()).toEqual([...BRIDGE_NARROW_REASONS].sort())
  })
})

describe('T10 · schema 的方言无关与租户一致性', () => {
  const bridgeSchema = read('prisma/schema/bridge.prisma')
  const tenancySchema = read('prisma/schema/tenancy.prisma')

  /** 去掉注释后只剩声明本体 —— 否则**注释里提到** `@db.` 也会被误判成"用了原生类型"。 */
  const declOnly = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n')

  it('不含任何原生类型标注（方言无关 —— 与 agent/outcome/billing 同口径）', () => {
    expect(declOnly(bridgeSchema)).not.toMatch(/@db\./)
  })

  it('JSON 列用 String 存储（libSQL 下 Json 落 TEXT，坏字符会打挂整行读取）', () => {
    const bridge = modelBlock(bridgeSchema, 'CommunityBridge')
    const optIn = modelBlock(bridgeSchema, 'BridgeMemberOptIn')
    for (const col of ['initiatorFieldKeys', 'recipientFieldKeys', 'shareableMissionKinds']) {
      expect(bridge).toMatch(new RegExp(`${col}\\s+String\\b`))
    }
    expect(optIn).toMatch(/disclosedFieldKeys\s+String\b/)
  })

  it('🔴 `CommunityBridge` **有** status 列（"我参与的活跃协议"必须能下推 SQL）', () => {
    const bridge = modelBlock(bridgeSchema, 'CommunityBridge')
    expect(bridge).toMatch(/status\s+CommunityBridgeStatus/)
  })

  it('🔴 软引用（组织 / 用户）**不**建 FK —— 组织注销后协议仍可查，且重建后不得继承旧协议', () => {
    const bridge = modelBlock(bridgeSchema, 'CommunityBridge')
    const optIn = modelBlock(bridgeSchema, 'BridgeMemberOptIn')

    // 每列都得是**裸的** String / String?（而不是某种关系字段）。
    for (const col of ['initiatorOrgId', 'recipientOrgId', 'createdBy', 'revokedBy']) {
      expect(bridge).toMatch(new RegExp(`${col}\\s+String\\b`))
    }
    expect(optIn).toMatch(/userId\s+String\b/)

    // ⚠️ 不写"列名 + 距离窗口 + @relation"这种断言：它依赖排版，注释一改就红，
    //    而且红得没有信息量。改为**把全部关系声明抽出来**再断言：
    //      · CommunityBridge 一条关系都没有（全部软引用）；
    //      · BridgeMemberOptIn 恰好两条，且**都不含** userId。
    const bridgeRelations = bridge.match(/@relation\([^)]*\)/g) ?? []
    expect(bridgeRelations).toEqual([])

    const optInRelations = optIn.match(/@relation\([^)]*\)/g) ?? []
    expect(optInRelations.length).toBe(2)
    expect(optInRelations.join(' ')).not.toContain('userId')
  })

  it('🔴 `bridgeId` / `organizationId` 是**真 FK** 且级联删除（孤儿 opt-in 会被投影当成有效授权）', () => {
    const optIn = modelBlock(bridgeSchema, 'BridgeMemberOptIn')
    expect(optIn).toMatch(/bridgeId\s+String\b/)
    // 直接匹配**关系声明行**本身。
    // ⚠️ 不用 `bridgeId[\s\S]{0,120}@relation` 这种"距离窗口"写法：列声明行与关系行之间
    //    隔着若干注释与其它列，窗口一旦写窄就变成一条**依赖排版**的脆弱断言
    //    （首版就是这么红的 —— 而且它红得毫无信息量）。
    expect(optIn).toMatch(/CommunityBridge\s+@relation\(fields:\s*\[bridgeId\]/)
    expect(optIn).toMatch(/Organization\s+@relation\(fields:\s*\[organizationId\]/)
    expect((optIn.match(/onDelete:\s*Cascade/g) ?? []).length).toBe(2)
  })

  it('🔴 一对组织**同时只有一份**协议（@@unique([initiatorOrgId, recipientOrgId])）', () => {
    // 没有这条约束，"同一对组织开两份协议"会静默产生**双倍授权面**。
    expect(modelBlock(bridgeSchema, 'CommunityBridge')).toMatch(
      /@@unique\(\[initiatorOrgId,\s*recipientOrgId\]\)/,
    )
  })

  it('🔴 一人对一份协议只有一行（@@unique([bridgeId, userId])）—— 重复 opt-in 是幂等更新', () => {
    expect(modelBlock(bridgeSchema, 'BridgeMemberOptIn')).toMatch(
      /@@unique\(\[bridgeId,\s*userId\]\)/,
    )
  })

  it('Organization 上有 BridgeMemberOptIn 的反向关系（Prisma 关系完整性要求）', () => {
    // ⚠️ 只有 opt-in 需要反向关系：`initiatorOrgId` / `recipientOrgId` 是**软引用**，
    //    因此 CommunityBridge 在 Organization 上**没有**对应反向字段（刻意）。
    expect(tenancySchema).toMatch(/bridgeMemberOptIns\s+BridgeMemberOptIn\[\]/)
    expect(tenancySchema).not.toMatch(/communityBridges\s+CommunityBridge\[\]/)
  })

  it('两个模型都带 organizationId 或组织侧谓词所需列（每条记录都能按租户查询）', () => {
    expect(modelBlock(bridgeSchema, 'CommunityBridge')).toMatch(/initiatorOrgId\s+String/)
    expect(modelBlock(bridgeSchema, 'CommunityBridge')).toMatch(/recipientOrgId\s+String/)
    expect(modelBlock(bridgeSchema, 'BridgeMemberOptIn')).toMatch(/organizationId\s+String/)
  })
})
