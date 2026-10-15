/**
 * T11 · A2A agent card 一致性测试
 *
 * agent card 是**静态文件**（`public/.well-known/agent-card.json`），
 * 而技能清单的真相来源是 `@/lib/interop/tools` —— 两者之间**必然**存在漂移风险。
 * 本文件就是把这条漂移变成**红灯**的唯一机制：
 *
 *   · 双向集合相等：agent card 里有、工具目录里没有 ⇒ 客户端会调一个 404 的技能；
 *     工具目录里有、agent card 里没有 ⇒ 外部 Agent 根本不知道它存在。
 *   · 能力名必须真实存在（不许出现"幽灵能力"）。
 *   · **无凭据**：卡片是公开可读的，出现任何密钥形态都是事故。
 *   · `capabilities.streaming=false` 必须与实现一致（我们没做 SSE）。
 */
jest.mock('@/lib/tenancy', () => ({ resolveTenant: jest.fn() }))
jest.mock('@/lib/connection', () => ({ listMissions: jest.fn() }))
jest.mock('@/lib/bridges', () => ({ listBridges: jest.fn(), listBridgeDiscoveries: jest.fn() }))
jest.mock('@/lib/outcome', () => ({ listOutcomes: jest.fn(), reportOutcome: jest.fn() }))

import fs from 'node:fs'
import path from 'node:path'
import { INTEROP_TOOLS, INTEROP_TOOL_NAMES } from '@/lib/interop/tools'
import { TENANT_CAPABILITIES } from '@/lib/tenancy/capabilities'

const CARD_PATH = path.join(process.cwd(), 'public', '.well-known', 'agent-card.json')
const raw = fs.readFileSync(CARD_PATH, 'utf8')
const card = JSON.parse(raw) as {
  protocolVersion: string
  name: string
  description: string
  url: string
  version: string
  capabilities: { streaming: boolean; pushNotifications: boolean }
  securitySchemes: Record<string, unknown>
  security: unknown[]
  skills: { id: string; name: string; description: string; tags: string[]; 'x-required-capability': string }[]
}

describe('A2A · agent card 文件本身', () => {
  it('存在且是合法 JSON', () => {
    expect(fs.existsSync(CARD_PATH)).toBe(true)
    expect(typeof card).toBe('object')
  })

  it('必填字段齐备且非空', () => {
    for (const k of ['protocolVersion', 'name', 'description', 'url', 'version'] as const) {
      expect(typeof card[k]).toBe('string')
      expect((card[k] as string).length).toBeGreaterThan(0)
    }
    expect(card.securitySchemes && Object.keys(card.securitySchemes).length).toBeGreaterThan(0)
    expect(Array.isArray(card.security)).toBe(true)
  })

  it('url 是 https（外部 Agent 必须能直接访问）', () => {
    expect(card.url).toMatch(/^https:\/\//)
  })

  it('capabilities.streaming / pushNotifications 均为 false（与实现一致：无 SSE、无推送）', () => {
    expect(card.capabilities.streaming).toBe(false)
    expect(card.capabilities.pushNotifications).toBe(false)
  })
})

describe('A2A · 与工具目录的一致性（防漂移）', () => {
  it('🔴 skills[].id 与 INTEROP_TOOLS 的 name **双向集合相等**', () => {
    const cardIds = new Set(card.skills.map((s) => s.id))
    const toolIds = new Set(INTEROP_TOOL_NAMES)
    const onlyInCard = [...cardIds].filter((id) => !toolIds.has(id))
    const onlyInTools = [...toolIds].filter((id) => !cardIds.has(id))
    expect({ onlyInCard, onlyInTools }).toEqual({ onlyInCard: [], onlyInTools: [] })
  })

  it('🔴 每个 skill 的 x-required-capability 与工具目录**逐字一致**', () => {
    for (const skill of card.skills) {
      const tool = INTEROP_TOOLS.find((t) => t.name === skill.id)
      expect(tool).toBeDefined()
      expect(skill['x-required-capability']).toBe(tool!.capability)
    }
  })

  it('每个 skill 的能力名都真实存在于 capabilities.ts（无"幽灵能力"）', () => {
    const known = new Set<string>(TENANT_CAPABILITIES)
    for (const skill of card.skills) {
      expect(known.has(skill['x-required-capability'])).toBe(true)
    }
  })

  it('每个 skill 有 name / description / tags', () => {
    for (const skill of card.skills) {
      expect(skill.name.length).toBeGreaterThan(0)
      expect(skill.description.length).toBeGreaterThan(5)
      expect(Array.isArray(skill.tags)).toBe(true)
    }
  })
})

describe('A2A · 开源合规', () => {
  it('🔴 卡片里**不含任何凭据形态**（它对外公开可读）', () => {
    for (const pattern of [/nfp_[A-Za-z0-9]{20,}/, /sk-[A-Za-z0-9_-]{20,}/, /ghp_[A-Za-z0-9]{20,}/, /eyJ[A-Za-z0-9_-]{20,}\./, /BEGIN [A-Z ]*PRIVATE KEY/]) {
      expect(raw).not.toMatch(pattern)
    }
  })

  it('卡片里不含内部实现细节（表名 / 文件路径 / env 名）', () => {
    for (const leak of ['process.env', 'CommunityBridge', 'src/lib', 'prisma']) {
      expect(raw).not.toContain(leak)
    }
  })
})
