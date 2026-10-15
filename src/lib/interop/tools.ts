/**
 * T11 · 互操作工具目录（MCP 与 A2A 的**单一来源**）
 *
 * ── 为什么要单独一层 ─────────────────────────────────────────────
 *   MCP 与 A2A 是两套**协议信封**，但"能做什么、需要什么能力"是**同一件事**。
 *   把工具目录放进任一协议的路由文件里，另一个协议就必须复制一份 ——
 *   而两份清单的漂移是**静默**的：MCP 加了工具、A2A 没加，两边都没报错，
 *   直到某个外部 Agent 说"你的 agent card 里没有这个 skill"。
 *   因此：**协议层只做信封，能力与执行只在这里定义。**
 *
 * ── 本文件的纪律 ────────────────────────────────────────────────
 *   ① 每个工具**只**调既有服务层函数，不复制任何业务判断。
 *   ② `capability` 必须取自 `capabilities.ts`（同一张表，REST 面也是它）——
 *      写一个不存在的能力名比不写更糟：它"看起来在执法"。
 *   ③ `inputSchema` 是**对外契约**，不得出现内部实现细节（表名、env 名、文件路径）。
 *   ④ 工具的执行**不做**二次授权判断 —— 授权由调用方（MCP/A2A 路由）在
 *      解析出租户上下文后、用 `can(role, capability)` 判定。本文件只声明"需要什么"。
 *      （服务层自己还有一次复判，那是纵深防御，不是这里的职责。）
 */
import type { TenantContext } from '@/lib/tenancy'
import type { TenantCapability } from '@/lib/tenancy/capabilities'
import { listMissions } from '@/lib/connection'
import { listBridges, listBridgeDiscoveries } from '@/lib/bridges'
import { listOutcomes, reportOutcome } from '@/lib/outcome'

export type InteropTool = {
  name: string
  title: string
  description: string
  /** 调用本工具所需的租户能力 —— 与 REST 面同一张表。 */
  capability: TenantCapability
  /** 只读工具不会产生副作用（供客户端决定是否需要二次确认）。 */
  readOnly: boolean
  inputSchema: Record<string, unknown>
  run: (ctx: TenantContext, args: Record<string, unknown>) => Promise<unknown>
}

const ORG_ARG = {
  organizationId: {
    type: 'string',
    description: '组织 id。省略时使用调用者唯一的 ACTIVE 成员关系；有多条则必须显式指定。',
  },
}

export const INTEROP_TOOLS: InteropTool[] = [
  {
    name: 'list_missions',
    title: '列出任务',
    description: '列出本组织的任务（Mission）。只返回本组织可见的任务。',
    capability: 'mission.read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        ...ORG_ARG,
        status: { type: 'string', description: '按任务状态过滤（可选）' },
        pageSize: { type: 'integer', minimum: 1, maximum: 50, description: '每页条数，默认 20' },
      },
      additionalProperties: false,
    },
    run: (ctx, args) =>
      listMissions(ctx, {
        status: typeof args.status === 'string' ? (args.status as never) : undefined,
        pageSize: typeof args.pageSize === 'number' ? args.pageSize : undefined,
      }),
  },
  {
    name: 'list_bridges',
    title: '列出跨社群协议',
    description: '列出本组织参与的跨社群协议（作为发起方或被邀方）。',
    capability: 'bridge.read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { ...ORG_ARG, limit: { type: 'integer', minimum: 1, maximum: 50 } },
      additionalProperties: false,
    },
    run: (ctx, args) =>
      listBridges(ctx, { limit: typeof args.limit === 'number' ? args.limit : undefined }),
  },
  {
    name: 'bridge_discovery',
    title: '跨社群成员发现',
    description:
      '在**已生效的跨社群协议**下，发现对方组织中**自愿披露**的成员及其可见字段。' +
      '这是本项目唯一的跨群读取路径：可见字段是「群主配置 ∩ 成员 opt-in ∩ 成员意图档位」的三方交集，' +
      '逐层只能收窄。协议未生效时返回空列表与拒绝码，而不是报错。',
    capability: 'bridge.read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { ...ORG_ARG, bridgeId: { type: 'string', description: '协议 id' } },
      required: ['bridgeId'],
      additionalProperties: false,
    },
    run: (ctx, args) => listBridgeDiscoveries(ctx, args.bridgeId),
  },
  {
    name: 'list_outcomes',
    title: '列出成果',
    description: '列出本组织的连接成果及其核验档位。',
    capability: 'outcome.read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        ...ORG_ARG,
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        verifiedOnly: { type: 'boolean', description: '只返回已核验的成果' },
      },
      additionalProperties: false,
    },
    run: (ctx, args) =>
      listOutcomes(ctx, {
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        verifiedOnly: args.verifiedOnly === true,
      }),
  },
  {
    name: 'report_outcome',
    title: '上报连接成果',
    description:
      '为一条已建立的连接上报成果。**上报不等于核验** —— 成果仍需对手方确认或外部核验才会被计费归因。',
    capability: 'outcome.report',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        ...ORG_ARG,
        proposalId: { type: 'string', description: '连接提案 id' },
        summary: { type: 'string', description: '成果摘要' },
        valueAmount: { type: 'number', description: '成果金额（可选，用于成本归因）' },
        currency: { type: 'string', description: '币种（可选）' },
      },
      required: ['proposalId'],
      additionalProperties: false,
    },
    run: (ctx, args) => reportOutcome(ctx, args as never),
  },
]

/** 按名字取工具（找不到返回 undefined —— 调用方负责回一个"未知工具"错误并列出可用项）。 */
export function toolByName(name: unknown): InteropTool | undefined {
  return typeof name === 'string' ? INTEROP_TOOLS.find((t) => t.name === name) : undefined
}

export const INTEROP_TOOL_NAMES: string[] = INTEROP_TOOLS.map((t) => t.name)

/**
 * 对外的工具/技能清单 —— **只**包含"能做什么 + 需要什么能力"。
 * MCP 的 `tools/list` 与 A2A agent card 的 `skills` 都从这里派生（防漂移）。
 */
export function publicToolList() {
  return INTEROP_TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { requiredCapability: t.capability, readOnlyHint: t.readOnly },
  }))
}
