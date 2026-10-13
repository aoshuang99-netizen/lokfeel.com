/**
 * T09 · **schema 漂移守卫**（TS 内核 ↔ Prisma 枚举）
 *
 * 为什么必须有它：本仓把小写 TS 联合（`'openai' | 'stub' | 'rules'`）与
 * Prisma 大写枚举（`OPENAI | STUB | RULES`）**同时**保留 —— 前者给纯内核用
 * （零依赖、可离线单测），后者是 DB 的存储形态。两处清单**必然**会漂移，
 * 除非有测试把"逐字一致"钉死。
 *
 * 漂移的后果不是编译错误，而是**运行期写入才炸**：
 * 新增一个状态只在 TS 加、忘了改 Prisma → 那条记录写不进去（或写成脏值）。
 * 因此这里读**真实的 .prisma 文件文本**做比对 —— 而不是 import 一个镜像常量
 * （那样只是把两份清单换成三份，漂移照旧）。
 */

import fs from 'fs'
import path from 'path'

import {
  AGENT_RUN_STATUSES,
  PROVIDER_KINDS,
  RISK_LEVELS,
} from '@/lib/agent'
import { PROVIDER_KIND_TO_DB } from '@/lib/agents'

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

describe('T09 · Prisma 枚举 ↔ TS 清单 逐字一致', () => {
  const agentSchema = read('prisma/schema/agent.prisma')

  it('AgentRunStatus ↔ AGENT_RUN_STATUSES', () => {
    expect(enumValues(agentSchema, 'AgentRunStatus').sort()).toEqual([...AGENT_RUN_STATUSES].sort())
  })

  it('AgentRiskLevel ↔ RISK_LEVELS', () => {
    expect(enumValues(agentSchema, 'AgentRiskLevel').sort()).toEqual([...RISK_LEVELS].sort())
  })

  it('AgentProviderKind ↔ PROVIDER_KIND_TO_DB 的取值', () => {
    expect(enumValues(agentSchema, 'AgentProviderKind').sort()).toEqual(
      Object.values(PROVIDER_KIND_TO_DB).sort(),
    )
    // 反向：内核的每个 kind 都有映射（防止新增 kind 只改 TS）
    for (const k of PROVIDER_KINDS) {
      expect(PROVIDER_KIND_TO_DB[k]).toBeDefined()
    }
  })

  it('AgentApprovalDecision 只有「批准/驳回」两种终局（没有 EXECUTED）', () => {
    expect(enumValues(agentSchema, 'AgentApprovalDecision').sort()).toEqual(['APPROVED', 'REJECTED'])
  })

  it('🔴 `EXECUTED` 在 AgentRunStatus 里存在（内核状态机需要），但**不在** AgentApprovalDecision 里', () => {
    // 裁决与执行是两件事 —— 若有人把 EXECUTED 塞进决策枚举，就说明概念被合并了。
    expect(enumValues(agentSchema, 'AgentRunStatus')).toContain('EXECUTED')
    expect(enumValues(agentSchema, 'AgentApprovalDecision')).not.toContain('EXECUTED')
  })
})

describe('T09 · schema 的方言无关与租户一致性', () => {
  const agentSchema = read('prisma/schema/agent.prisma')
  const tenancySchema = read('prisma/schema/tenancy.prisma')

  /** 去掉注释后只剩声明本体 —— 否则**注释里提到** `@db.` 也会被误判成"用了原生类型"。 */
  const declOnly = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n')

  it('不含任何原生类型标注（方言无关 —— 与 outcome/billing 同口径）', () => {
    expect(declOnly(agentSchema)).not.toMatch(/@db\./)
  })

  it('三个模型都带 organizationId（每条账都能独立按租户查询）', () => {
    for (const model of ['AgentRun', 'AgentCall', 'AgentApproval']) {
      const block = agentSchema.match(new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`))
      if (!block) throw new Error(`schema 里找不到 model ${model}`)
      expect(block[1]).toMatch(/organizationId\s+String/)
    }
  })

  it('Organization 上有三条反向关系（Prisma 关系完整性要求）', () => {
    expect(tenancySchema).toMatch(/agentRuns\s+AgentRun\[\]/)
    expect(tenancySchema).toMatch(/agentCalls\s+AgentCall\[\]/)
    expect(tenancySchema).toMatch(/agentApprovals\s+AgentApproval\[\]/)
  })

  it('软引用（requestedBy / actorId）**不**建 FK —— 用户注销后裁决仍可查', () => {
    // 这两个字段只应是裸 String / String?，绝不能出现 @relation。
    const runBlock = agentSchema.match(/model\s+AgentRun\s*\{([\s\S]*?)\n\}/)![1]
    const approvalBlock = agentSchema.match(/model\s+AgentApproval\s*\{([\s\S]*?)\n\}/)![1]
    expect(runBlock).toMatch(/requestedBy\s+String\b/)
    expect(runBlock).not.toMatch(/requestedBy[\s\S]{0,40}@relation/)
    expect(approvalBlock).toMatch(/actorId\s+String\?/)
    expect(approvalBlock).not.toMatch(/actorId[\s\S]{0,40}@relation/)
  })

  it('🔴 AgentError 一致性关键：`AgentApproval.runId` 是唯一索引（不可改判的库级保证）', () => {
    expect(agentSchema).toMatch(/@@unique\(\[runId\]\)/)
  })

  it('幂等键唯一约束存在：@@unique([organizationId, dedupeKey])', () => {
    expect(agentSchema).toMatch(/@@unique\(\[organizationId,\s*dedupeKey\]\)/)
  })
})
