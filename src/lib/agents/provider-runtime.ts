/**
 * T09 · Agent Runtime —— Provider 选择（**生产路径的唯一入口**）
 *
 * 优先级：WorkBuddy 云端算力（免密钥）→ OpenAI（自带 key）。
 *
 * 为什么是这个顺序：云端算力是**产品自带的真实调用能力**，不依赖客户自己买 key；
 * 而 OpenAI 只在有人显式配置时才用。两者都不可用时返回 `unavailable`，
 * 由编排层走**明示的规则式降级** —— 不存在"换个假模型装作调过了"这条路径。
 */

import {
  createStubProvider,
  resolveProviderConfig,
  resolveProviderMode,
  resolveWorkBuddyConfig,
  type ProviderResolution,
} from '@/lib/agent'
import { createOpenAIProvider } from './provider-openai'
import { createWorkBuddyProvider } from './provider-workbuddy'
import { WORKSPACE_SPEC_VERSION } from '@/lib/workspace-spec'

/**
 * 沙箱专用假产出：**契约合法的最小 WorkspaceSpec**（#1086）。
 *
 * 为什么必须契约合法：编排层在 Provider 返回后立刻做 `outputSchema.safeParse`，
 * 不合法就走 `degrade()` ⇒ 状态永远停在 DEGRADED ⇒ 审批/审计链路永远没机会被走到。
 * 沙箱的价值就是"把链路走通"，因此这里给的是**结构正确、内容标识为沙箱**的产出。
 *
 * ⚠️ 边界：这不是"模拟模型质量"，只是让 `providerKind='stub'` 的运行能进入待批态。
 * 版本号从 `WORKSPACE_SPEC_VERSION` 取，避免契约升级后这里悄悄失效。
 */
const SANDBOX_WORKSPACE_SPEC = {
  version: WORKSPACE_SPEC_VERSION,
  title: 'SANDBOX_PROBE 沙箱草稿',
  nodes: [
    {
      id: 'intent-1',
      type: 'intent',
      title: '目标与成功判据',
      data: { goal: 'SANDBOX_PROBE：沙箱探测目标（非真实模型产出）', constraints: [], successCriteria: [] },
    },
    { id: 'candidate-1', type: 'candidate', title: '候选池', data: { candidates: [] } },
    { id: 'consent-1', type: 'consent', title: '披露与同意', data: { fields: [], status: 'CONSENT_PENDING' } },
  ],
  availableActions: [],
  notes: ['SANDBOX_PROBE：由 stub provider 生成，providerKind=stub，不冒充真实模型输出'],
} as const

/**
 * 按环境解析出可用的 Provider。判据全部来自内核纯函数，本文件只做"用判据构造实例"。
 */
export function resolveRuntimeProvider(
  env: Record<string, string | undefined>,
): ProviderResolution {
  // 🔴 S1 沙箱守卫（V20.0 · R-04）：显式 `stub` 仅允许在「非生产 + 隔离」环境；
  //    否则 **抛错**，生产路径绝不会加载 stub 冒充真实调用成功。
  //    无凭据时不抛错 —— 下面两条路都缺凭据才返回 `unavailable`，由编排层走规则式降级。
  const mode = resolveProviderMode(env)

  // S1 沙箱装配：能走到这里，说明 `resolveProviderMode` 已确认「非生产 + 隔离」。
  // 生产环境在上一步就抛错了，故本分支**不可能**在生产被加载。
  // `ModelProvider.kind='stub'` 会如实写入 providerKind，不冒充真实调用。
  //
  // 🔴 #1086 修正：原载荷是 `{"intent":"SANDBOX_PROBE","tool":null,"args":{}}`，
  //    对**任何**技能契约都不合法（INTENT_EXTRACTION 要 WorkspaceSpec v${WORKSPACE_SPEC_VERSION}），
  //    实测必走 OUTPUT_SCHEMA_INVALID → DEGRADED，`providerKind` 落成 `rules`
  //    ⇒ 沙箱**永远到不了** AWAITING_APPROVAL，等于沙箱不可用于端到端取证。
  //    现在返回一个**契约合法**的最小 WorkspaceSpec，使编排/审批/审计链路能在沙箱内被真实走完。
  //    仍带 `SANDBOX_PROBE` 标记：任何下游都能一眼看出「这不是真实模型产出」。
  if (mode === 'stub') {
    return {
      kind: 'ready',
      provider: createStubProvider(() => JSON.stringify(SANDBOX_WORKSPACE_SPEC)),
    }
  }

  const workbuddy = resolveWorkBuddyConfig(env)
  if (workbuddy.ok) {
    return { kind: 'ready', provider: createWorkBuddyProvider(workbuddy.config) }
  }

  const openai = resolveProviderConfig(env)
  if (openai.ok) {
    return { kind: 'ready', provider: createOpenAIProvider({ ...openai.config }) }
  }

  // 两条路都缺凭据：把**两条**原因都带上，运维才知道该补哪个。
  return { kind: 'unavailable', reason: `${workbuddy.reason}；${openai.reason}` }
}

/** 供用量响应使用的**诚实块**：真实调用到底开没开。 */
export interface ProviderHonesty {
  /** `none` = 两条路都不可用，当前只能是规则式兜底。 */
  provider: 'workbuddy' | 'openai' | 'none'
  /** 当前环境**是否**具备发起真实调用的条件。 */
  realCallsEnabled: boolean
  reason: string
}

export function providerHonesty(env: Record<string, string | undefined>): ProviderHonesty {
  const workbuddy = resolveWorkBuddyConfig(env)
  if (workbuddy.ok) {
    return {
      provider: 'workbuddy',
      realCallsEnabled: true,
      reason: `已接入 WorkBuddy 云端算力：模型=${workbuddy.config.model}（免密钥，凭据不下发）。`,
    }
  }

  const openai = resolveProviderConfig(env)
  if (openai.ok) {
    return {
      provider: 'openai',
      realCallsEnabled: true,
      reason: `已配置凭据：模型=${openai.config.model}，端点=${openai.config.baseUrl}（未在下发里暴露凭据）。`,
    }
  }

  return {
    provider: 'none',
    realCallsEnabled: false,
    reason: `${workbuddy.reason}；${openai.reason}`,
  }
}
