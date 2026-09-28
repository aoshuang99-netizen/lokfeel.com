/**
 * Bot 演示模块策略 —— **单一配置源**（P0-5）
 *
 * 为什么要有这个文件：
 *   Bot 体系（6 张表 + `api/cron/bot-*` + `api/bot-automation`）在开源版里
 *   被定性为「**默认关闭的可选模块**」（见 docs/OPEN-CORE-POSITIONING.md §4）。
 *   但改造前它**没有任何总开关** —— 唯一的门槛是 `CRON_SECRET`（认证，不是开关）
 *   和 `requireAdminAuth()`（权限，不是开关）。也就是说：
 *     · 想关掉它，只能去各个部署平台逐条删除 cron 定时任务；
 *     · 删漏一条，Bot 就继续在跑、继续写库、继续产生"假用户"数据。
 *   这与"内容中立、部署方自治"的定位直接冲突 —— 一个自托管者拿到镜像后
 *   应该**默认不会**跑起一套机器人系统。
 *
 * ⚠️ 关于**默认值**（这是本模块最容易读错的一点，2026-09-28 已翻转）：
 *
 *   1. **代码默认**（`BOT_ENGINE_ENABLED` 未设置）→ **关闭**。
 *      2026-09-28 决议翻转（独立提交）。此前代码默认 = 改造前行为（启用），
 *      是为了保护"本仓库同时是 C 端线上部署源码"的存量部署；
 *      翻转时**受影响的既有部署必须显式设置 `BOT_ENGINE_ENABLED=true`**，
 *      否则 Bot 会静默停止 —— 详见 docs/RUNBOOK-P1-6.md 的部署清单。
 *
 *   2. **发行物默认**（`.env.example` 与 `docker-compose.yml`）→ **关闭**（未变）。
 *      自托管者 `cp .env.example .env` 得到的就是关闭状态。
 *
 *   两者由 `scripts/verify-bot-policy.ts` 的反回归守卫钉死。
 */

// ─────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────

export interface BotEngineTunables {
  /** Tick 间隔（毫秒）。旧 `bot-tick` 路由硬编码 60_000 */
  tickIntervalMs: number
  /** 单次 tick 最多处理多少动作。旧 `bot-tick` 路由硬编码 50 */
  maxActionsPerTick: number
  /** 同一 Bot 两次动作之间的最小间隔（毫秒）。旧 `bot-tick` 路由硬编码 30_000 */
  minActionIntervalMs: number
  /** 时间倍率（1 = 实时）。用于演示/压测加速 */
  speedMultiplier: number
}

export interface BotPolicy extends BotEngineTunables {
  /** Bot 模块总开关 */
  enabled: boolean
  /**
   * `enabled` 的判定来源：
   *   · `env`     —— 部署方显式设置了 BOT_ENGINE_ENABLED（可识别）
   *   · `default` —— 未设置/留空，代码默认 = **关闭**（2026-09-28 翻转）
   *   · `invalid` —— 设置了但取值无法识别，已按 **fail-closed** 处理（关闭）
   */
  enabledSource: 'env' | 'default' | 'invalid'
  /** `enabledSource === 'invalid'` 时保留原始取值，便于排障 */
  invalidRawValue?: string
}

// ─────────────────────────────────────────────────────────────
// 默认值（= 改造前的线上行为）
// ─────────────────────────────────────────────────────────────

/** 旧 `src/app/api/cron/bot-tick/route.ts` 里写死的运行参数 */
export const DEFAULT_BOT_TUNABLES: BotEngineTunables = {
  tickIntervalMs: 60_000,
  maxActionsPerTick: 50,
  minActionIntervalMs: 30_000,
  speedMultiplier: 1,
}

/**
 * 发行物（`.env.example` / `docker-compose.yml`）中**必须**出现的取值。
 * 由 verify 脚本断言 —— 这是"默认关闭的可选模块"这条定位在代码里的锚点。
 */
export const DISTRIBUTION_DEFAULT_ENABLED = false

/** 关闭时所有 Bot 入口统一返回的状态码 */
export const BOT_DISABLED_HTTP_STATUS = 503

/** 给运维看的启用指引（出现在关闭响应体与告警里，避免"关掉了不知道怎么开"） */
export const BOT_ENABLE_HINT =
  '设置环境变量 BOT_ENGINE_ENABLED=true 后重新部署即可启用；' +
  '说明见 docs/SELF-HOSTING.md「Bot 演示模块」一节与 .env.example。'

/** 引擎被禁用时抛出的显式错误（带类型，便于上层分别处理） */
export class BotModuleDisabledError extends Error {
  readonly code = 'BOT_MODULE_DISABLED'
  constructor(message = 'Bot 模块已被禁用（BOT_ENGINE_ENABLED=false）') {
    super(message)
    this.name = 'BotModuleDisabledError'
  }
}

// ─────────────────────────────────────────────────────────────
// env 解析
// ─────────────────────────────────────────────────────────────

export type EnvLike = Record<string, string | undefined>

/** 可识别的"启用"取值 */
const TRUE_TOKENS = /^(1|true|yes|on|enable|enabled)$/i
/** 可识别的"关闭"取值。刻意放宽到 disable/disabled/none —— 写错一个词就关不掉，比多认几个词危险得多 */
const FALSE_TOKENS = /^(0|false|no|off|disable|disabled|none)$/i

function parseIntInRange(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw.trim())
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback
  if (n < min || n > max) return fallback
  return n
}

function parseFloatInRange(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw.trim())
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return n
}

/**
 * 解析总开关。返回三元组语义（启用 / 关闭 / 不可识别）。
 *
 * ⚠️ 不可识别时**按关闭处理（fail-closed）**：
 *   本开关的存在意义就是"能可靠地关掉一套会写库的机器人系统"。
 *   如果 `BOT_ENGINE_ENABLED=flase` 这类拼写错误被当成"启用"，
 *   运维就会以为已经关掉了 —— 这正是 P0-5 要消灭的情形。
 *   代价是取值写错时模块会停止，但 `describeBotPolicy` 会输出 error 级告警，
 *   且 `/api/health` 会带出原始取值，不会静默。
 *
 * 注意与 `resolveRegionPolicy` 的差别：region-policy 那边"空值 = 用内置默认"，
 * 这里同样如此（未设置/留空 = 代码默认，2026-09-28 起为**关闭**）。
 * 区别只在于**写了但不认识**的取值。
 */
export function parseEnabledFlag(raw: string | undefined): {
  value: boolean
  source: 'env' | 'default' | 'invalid'
  rawValue?: string
} {
  if (raw === undefined || raw.trim() === '') {
    // 未设置 / 留空 → 代码默认 = **关闭**（2026-09-28 翻转；
    // 既有部署若依赖 Bot，必须显式设 BOT_ENGINE_ENABLED=true）
    return { value: false, source: 'default' }
  }
  const token = raw.trim()
  if (TRUE_TOKENS.test(token)) return { value: true, source: 'env' }
  if (FALSE_TOKENS.test(token)) return { value: false, source: 'env' }
  return { value: false, source: 'invalid', rawValue: token }
}

/**
 * 把环境变量解析成策略对象。**不读全局**，`env` 由调用方传入 —— 便于测试。
 */
export function resolveBotPolicy(env: EnvLike): BotPolicy {
  const flag = parseEnabledFlag(env.BOT_ENGINE_ENABLED)

  return {
    enabled: flag.value,
    enabledSource: flag.source,
    ...(flag.rawValue !== undefined ? { invalidRawValue: flag.rawValue } : {}),

    tickIntervalMs: parseIntInRange(env.BOT_TICK_INTERVAL_MS, DEFAULT_BOT_TUNABLES.tickIntervalMs, 1_000, 86_400_000),
    maxActionsPerTick: parseIntInRange(env.BOT_MAX_ACTIONS_PER_TICK, DEFAULT_BOT_TUNABLES.maxActionsPerTick, 1, 1_000),
    minActionIntervalMs: parseIntInRange(env.BOT_MIN_ACTION_INTERVAL_MS, DEFAULT_BOT_TUNABLES.minActionIntervalMs, 0, 86_400_000),
    speedMultiplier: parseFloatInRange(env.BOT_SPEED_MULTIPLIER, DEFAULT_BOT_TUNABLES.speedMultiplier, 0.01, 1_000),
  }
}

/**
 * 模块级默认策略。所有 Bot 入口用这一个。
 * Node 运行时按模块加载求值 —— 路由处理器默认不是 edge runtime，因此安全。
 */
export const BOT_POLICY: BotPolicy = resolveBotPolicy(process.env)

// ─────────────────────────────────────────────────────────────
// 判定与响应（纯函数）
// ─────────────────────────────────────────────────────────────

export function isBotEnabled(policy: BotPolicy = BOT_POLICY): boolean {
  return policy.enabled
}

/** 关闭原因的人话描述（纯函数，便于断言） */
export function describeDisabledReason(policy: BotPolicy = BOT_POLICY): string {
  if (policy.enabledSource === 'invalid') {
    return `BOT_ENGINE_ENABLED 取值无法识别（"${policy.invalidRawValue ?? ''}"），已按 fail-closed 关闭`
  }
  if (policy.enabledSource === 'default') {
    return 'BOT_ENGINE_ENABLED 未设置（代码默认关闭，2026-09-28 起）'
  }
  return 'BOT_ENGINE_ENABLED=false'
}

/**
 * 禁用时统一的响应体。
 * 刻意包含 `module` / `hint` / `enableWith`：运维看到 503 时应能立刻知道
 * "是被我关的"而不是"服务挂了"。
 */
export function botDisabledBody(
  extra?: Record<string, unknown>,
  policy: BotPolicy = BOT_POLICY,
): Record<string, unknown> {
  return {
    status: 'disabled',
    module: 'bot',
    error: 'Bot module disabled',
    disabledReason: describeDisabledReason(policy),
    enableWith: 'BOT_ENGINE_ENABLED=true',
    hint: BOT_ENABLE_HINT,
    timestamp: new Date().toISOString(),
    ...extra,
  }
}

/** 策略关闭时抛错，供引擎启动路径使用（纵深防御） */
export function assertBotEnabled(policy: BotPolicy = BOT_POLICY): void {
  if (!policy.enabled) throw new BotModuleDisabledError()
}

/** 取出可传给引擎构造函数的运行参数 */
export function getBotEngineTunables(policy: BotPolicy = BOT_POLICY): BotEngineTunables {
  return {
    tickIntervalMs: policy.tickIntervalMs,
    maxActionsPerTick: policy.maxActionsPerTick,
    minActionIntervalMs: policy.minActionIntervalMs,
    speedMultiplier: policy.speedMultiplier,
  }
}

// ─────────────────────────────────────────────────────────────
// 可观测性
// ─────────────────────────────────────────────────────────────

/**
 * 人类可读的策略摘要 + 配置告警。
 * 由 `scripts/verify-bot-policy.ts` 与 `/api/health` 使用。
 */
export function describeBotPolicy(policy: BotPolicy = BOT_POLICY): {
  summary: Record<string, unknown>
  warnings: string[]
} {
  const warnings: string[] = []

  if (policy.enabledSource === 'default') {
    warnings.push(
      '未设置 BOT_ENGINE_ENABLED：按代码默认**关闭** Bot 模块（2026-09-28 翻转）。' +
        '需要 Bot 的既有部署必须显式设置 BOT_ENGINE_ENABLED=true。',
    )
  }
  if (policy.enabledSource === 'invalid') {
    warnings.push(
      `BOT_ENGINE_ENABLED 取值无法识别："${policy.invalidRawValue ?? ''}"。` +
        '已按 fail-closed **关闭** Bot 模块。合法取值：true/false、1/0、yes/no、on/off、enable/disable。',
    )
  }
  if (policy.enabled && policy.speedMultiplier !== 1) {
    warnings.push(
      `BOT_SPEED_MULTIPLIER=${policy.speedMultiplier}（非实时）。` +
        '加速模拟会成倍放大写库量，仅建议在演示/压测环境使用。',
    )
  }
  if (policy.enabled && policy.maxActionsPerTick > 200) {
    warnings.push(
      `BOT_MAX_ACTIONS_PER_TICK=${policy.maxActionsPerTick} 偏高：` +
        'Serverless 环境（Vercel/Netlify Hobby 10s 上限）极易超时。建议 ≤ 100。',
    )
  }
  if (!policy.enabled) {
    warnings.push(
      'Bot 模块已关闭：所有 /api/cron/bot-*、/api/bots/status 与 /api/bot-automation ' +
        '均返回 503（含 body.disabledReason）。这是预期行为。',
    )
  }

  return {
    summary: {
      enabled: policy.enabled,
      enabledSource: policy.enabledSource,
      ...(policy.invalidRawValue !== undefined ? { invalidRawValue: policy.invalidRawValue } : {}),
      tickIntervalMs: policy.tickIntervalMs,
      maxActionsPerTick: policy.maxActionsPerTick,
      minActionIntervalMs: policy.minActionIntervalMs,
      speedMultiplier: policy.speedMultiplier,
    },
    warnings,
  }
}
