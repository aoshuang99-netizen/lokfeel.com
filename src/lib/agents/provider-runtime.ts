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
  if (mode === 'stub') {
    return {
      kind: 'ready',
      provider: createStubProvider(() =>
        JSON.stringify({ intent: 'SANDBOX_PROBE', tool: null, args: {} }),
      ),
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
