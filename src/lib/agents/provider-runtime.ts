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
  resolveProviderConfig,
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
