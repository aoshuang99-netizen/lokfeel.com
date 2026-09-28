/**
 * P0-5 校验：Bot 演示模块总开关（配置驱动）
 *
 * 为什么需要它：
 *   本模块有**两个默认值**（代码默认 = 旧行为启用；发行物默认 = 关闭），
 *   而这两者都只体现在文件内容或一个三元判断里 —— 任何一次"顺手改一下"
 *   都可能让线上静默失去 Bot，或者让开源发行物带着机器人体系出厂。
 *   所以这里用**矩阵断言**覆盖：默认值等价、关闭语义、不可识别取值、
 *   参数边界，再加一条**反回归守卫**（逐个入口检查开关真的接上了）。
 *
 * 无框架依赖（与 scripts/verify-region-policy.ts 同一模式），可随时运行：
 *   npx tsx scripts/verify-bot-policy.ts
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  BOT_DISABLED_HTTP_STATUS,
  BOT_ENABLE_HINT,
  BotModuleDisabledError,
  DEFAULT_BOT_TUNABLES,
  DISTRIBUTION_DEFAULT_ENABLED,
  assertBotEnabled,
  botDisabledBody,
  describeBotPolicy,
  describeDisabledReason,
  getBotEngineTunables,
  isBotEnabled,
  parseEnabledFlag,
  resolveBotPolicy,
  type BotPolicy,
} from '../src/config/bot-policy'

const REPO_ROOT = path.resolve(__dirname, '..')

let passed = 0
const failures: string[] = []

function ok(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(`${name}${detail ? ` —— ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

function section(title: string): void {
  console.log(`\n${title}`)
}

function policy(env: Record<string, string | undefined> = {}): BotPolicy {
  return resolveBotPolicy(env)
}

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8')
}

// ═══════════════════════════════════════════════════════════
section('1. 代码默认值 = 关闭（2026-09-28 翻转，独立提交）')
// ═══════════════════════════════════════════════════════════

const dflt = policy({})
ok('未设置 BOT_ENGINE_ENABLED → 关闭（翻转后默认）', dflt.enabled === false)
ok('来源标记为 default', dflt.enabledSource === 'default', String(dflt.enabledSource))
ok('isBotEnabled 与策略一致', isBotEnabled(dflt) === false)
ok(
  '运行参数 = 旧 bot-tick 路由里写死的 60s / 50 / 30s / 1x',
  dflt.tickIntervalMs === 60_000 &&
    dflt.maxActionsPerTick === 50 &&
    dflt.minActionIntervalMs === 30_000 &&
    dflt.speedMultiplier === 1,
  `${dflt.tickIntervalMs}/${dflt.maxActionsPerTick}/${dflt.minActionIntervalMs}/${dflt.speedMultiplier}`,
)
ok(
  'getBotEngineTunables 逐字段等于 DEFAULT_BOT_TUNABLES',
  JSON.stringify(getBotEngineTunables(dflt)) === JSON.stringify(DEFAULT_BOT_TUNABLES),
)
ok('默认策略下 assertBotEnabled 抛错（默认即关闭）', (() => {
  try {
    assertBotEnabled(dflt)
    return false
  } catch (e) {
    return e instanceof BotModuleDisabledError
  }
})())

const dfltDesc = describeBotPolicy(dflt)
ok(
  '默认策略给出"默认关闭 + 须显式启用"的提示',
  dfltDesc.warnings.some((w) => w.includes('按代码默认**关闭**')),
  dfltDesc.warnings.join(' | '),
)
ok('默认策略出现"已关闭"告警', dfltDesc.warnings.some((w) => w.includes('已关闭')))
ok('默认摘要 enabled=false / source=default', dfltDesc.summary.enabled === false && dfltDesc.summary.enabledSource === 'default')

// ═══════════════════════════════════════════════════════════
section('2. 关闭语义：必须可靠、可诊断')
// ═══════════════════════════════════════════════════════════

for (const token of ['false', '0', 'no', 'off', 'disable', 'disabled', 'none', 'FALSE', '  false  ']) {
  const p = policy({ BOT_ENGINE_ENABLED: token })
  ok(`"${token}" → 关闭`, p.enabled === false && p.enabledSource === 'env', `${p.enabled}/${p.enabledSource}`)
}

for (const token of ['true', '1', 'yes', 'on', 'enable', 'enabled', 'TRUE']) {
  const p = policy({ BOT_ENGINE_ENABLED: token })
  ok(`"${token}" → 启用`, p.enabled === true && p.enabledSource === 'env', `${p.enabled}/${p.enabledSource}`)
}

ok('空字符串视为未设置（= 代码默认关闭，与 region-policy 的空值约定一致）', policy({ BOT_ENGINE_ENABLED: '' }).enabledSource === 'default')

// 拼写错误必须 fail-closed —— 这是"关得掉"这条要求的底线
for (const typo of ['flase', 'foobar', 'maybe', '2']) {
  const p = policy({ BOT_ENGINE_ENABLED: typo })
  ok(`无法识别的 "${typo}" → fail-closed 关闭`, p.enabled === false && p.enabledSource === 'invalid')
  ok(`  且保留原始取值便于排障`, p.invalidRawValue === typo, String(p.invalidRawValue))
}
ok('parseEnabledFlag 三态自洽', (() => {
  const a = parseEnabledFlag(undefined)
  const b = parseEnabledFlag('yes')
  const c = parseEnabledFlag('flase')
  return a.source === 'default' && b.source === 'env' && c.source === 'invalid'
})())

const off = policy({ BOT_ENGINE_ENABLED: 'false' })
ok('关闭时 assertBotEnabled 抛 BotModuleDisabledError', (() => {
  try {
    assertBotEnabled(off)
    return false
  } catch (e) {
    return e instanceof BotModuleDisabledError && (e as BotModuleDisabledError).code === 'BOT_MODULE_DISABLED'
  }
})())
ok('关闭原因可读', describeDisabledReason(off) === 'BOT_ENGINE_ENABLED=false', describeDisabledReason(off))

const invBody = botDisabledBody(undefined, policy({ BOT_ENGINE_ENABLED: 'flase' }))
ok('不可识别取值的响应体指出原始值', String(invBody.disabledReason).includes('flase'), String(invBody.disabledReason))

const body = botDisabledBody()
ok('关闭响应体带 status=disabled', body.status === 'disabled')
ok('关闭响应体带 module=bot（区别于"服务挂了"）', body.module === 'bot')
ok('关闭响应体带可执行的启用指令', body.enableWith === 'BOT_ENGINE_ENABLED=true')
ok('关闭响应体带文档指引', String(body.hint).includes('SELF-HOSTING') && String(body.hint) === BOT_ENABLE_HINT)
ok('关闭时 HTTP 状态码为 503', BOT_DISABLED_HTTP_STATUS === 503)

const offDesc = describeBotPolicy(off)
ok('关闭时给出"这是预期行为"的告警', offDesc.warnings.some((w) => w.includes('已关闭')), offDesc.warnings.join(' | '))

// ═══════════════════════════════════════════════════════════
section('3. 运行参数解析与边界')
// ═══════════════════════════════════════════════════════════

const tun = policy({
  BOT_TICK_INTERVAL_MS: '30000',
  BOT_MAX_ACTIONS_PER_TICK: '120',
  BOT_MIN_ACTION_INTERVAL_MS: '5000',
  BOT_SPEED_MULTIPLIER: '10',
})
ok('合法取值全部生效', tun.tickIntervalMs === 30_000 && tun.maxActionsPerTick === 120 && tun.minActionIntervalMs === 5_000 && tun.speedMultiplier === 10)

const badNums = policy({
  BOT_TICK_INTERVAL_MS: '500', // < 1000 下限
  BOT_MAX_ACTIONS_PER_TICK: '5000', // > 1000 上限
  BOT_MIN_ACTION_INTERVAL_MS: 'abc',
  BOT_SPEED_MULTIPLIER: '0', // < 0.01 下限
})
ok('越界/非数字一律回落默认值（不会把集群跑飞）', 
  badNums.tickIntervalMs === 60_000 &&
    badNums.maxActionsPerTick === 50 &&
    badNums.minActionIntervalMs === 30_000 &&
    badNums.speedMultiplier === 1,
  `${badNums.tickIntervalMs}/${badNums.maxActionsPerTick}/${badNums.minActionIntervalMs}/${badNums.speedMultiplier}`)

ok('参数越界不影响总开关', policy({ BOT_ENGINE_ENABLED: 'false', BOT_TICK_INTERVAL_MS: '500' }).enabled === false)

ok(
  '加速倍率会给出告警',
  describeBotPolicy(policy({ BOT_ENGINE_ENABLED: 'true', BOT_SPEED_MULTIPLIER: '10' })).warnings.some((w) => w.includes('BOT_SPEED_MULTIPLIER')),
)
ok(
  '每 tick 动作数过高会给出告警',
  describeBotPolicy(policy({ BOT_ENGINE_ENABLED: 'true', BOT_MAX_ACTIONS_PER_TICK: '500' })).warnings.some((w) => w.includes('BOT_MAX_ACTIONS_PER_TICK')),
)
ok(
  '已关闭时不再为倍率/上限刷告警（避免噪音）',
  !describeBotPolicy(policy({ BOT_ENGINE_ENABLED: 'false', BOT_SPEED_MULTIPLIER: '10' })).warnings.some((w) =>
    w.includes('BOT_SPEED_MULTIPLIER'),
  ),
)

// ═══════════════════════════════════════════════════════════
section('4. 反回归守卫：发行物默认必须关闭')
// ═══════════════════════════════════════════════════════════

ok('常量 DISTRIBUTION_DEFAULT_ENABLED = false', DISTRIBUTION_DEFAULT_ENABLED === false)

// 2026-09-28 翻转的源码锚点：防止将来无意把代码默认改回 true
const botPolicySrc = read('src/config/bot-policy.ts')
ok('代码默认已翻转：未设分支返回 false / source=default（源码锚点）', /value: false, source: 'default'/.test(botPolicySrc))
ok('代码默认翻转彻底：不再存在 legacy-default 来源', !botPolicySrc.includes('legacy-default'))

const envExample = read('.env.example')
ok('.env.example 声明了 BOT_ENGINE_ENABLED', /^\s*BOT_ENGINE_ENABLED\s*=/m.test(envExample))
ok(
  '.env.example 的取值为 false（自托管者复制后 Bot 关闭）',
  /^\s*BOT_ENGINE_ENABLED\s*=\s*"?false"?\s*$/m.test(envExample),
  (envExample.match(/^\s*BOT_ENGINE_ENABLED.*$/m) || [''])[0],
)

const compose = read('docker-compose.yml')
ok('docker-compose.yml 显式关闭 Bot 模块', /BOT_ENGINE_ENABLED:\s*'false'/.test(compose))

// ═══════════════════════════════════════════════════════════
section('5. 反回归守卫：所有 Bot 入口都接上了总开关')
// ═══════════════════════════════════════════════════════════

/** 引号风格两种都算（本仓库 TS 文件混用单双引号，只认单引号会漏掉 bot-automation） */
const POLICY_IMPORT = /import\s*\{[\s\S]*?\}\s*from\s*['"]@\/config\/bot-policy['"]/

/** bot-policy 中会被入口引用的符号 */
const POLICY_EXPORTS = [
  'isBotEnabled',
  'botDisabledBody',
  'BOT_DISABLED_HTTP_STATUS',
  'assertBotEnabled',
  'describeBotPolicy',
  'getBotEngineTunables',
]

/**
 * 找出"被引用了但没写进 import"的符号。
 *
 * 这一条是为一次**真实事故**加的：同一轮里对同一个文件发了两处编辑，
 * 后一次把前一次覆盖掉，结果文件里出现了 `isBotEnabled()` 调用却没有对应 import。
 * 而"文件里存在 isBotEnabled() 调用"这类断言**仍然通过** —— 静态扫描的盲区。
 * 所以这里不检查"有没有调用"，而是检查"用到的符号是否都导入了"。
 */
function missingPolicyImports(rel: string): string[] {
  const src = read(rel)
  const m = src.match(POLICY_IMPORT)
  const imported = m ? m[0] : ''
  return POLICY_EXPORTS.filter((name) => src.includes(name) && !imported.includes(name))
}

const CRON_ROUTES = [
  'src/app/api/cron/bot-tick/route.ts',
  'src/app/api/cron/bot-chat/route.ts',
  'src/app/api/cron/bot-match/route.ts',
  'src/app/api/cron/bot-online/route.ts',
  'src/app/api/cron/bot-learning/route.ts',
]

const GATED_FILES = [
  ...CRON_ROUTES,
  'src/app/api/bot-automation/route.ts',
  'src/app/api/bots/status/route.ts',
  'src/app/api/bots/learning/stats/route.ts',
  'src/lib/bot-automation.ts',
  'src/lib/bot-engine/schedulers/engine.ts',
  'src/lib/bot-engine/BotBehaviorEngine.ts',
  'src/app/api/health/route.ts',
]

for (const rel of GATED_FILES) {
  ok(`${rel} 导入 bot-policy`, POLICY_IMPORT.test(read(rel)))
  const missing = missingPolicyImports(rel)
  ok(`${rel} 引用的每个 bot-policy 符号都已导入`, missing.length === 0, `缺少: ${missing.join(', ')}`)
}

for (const rel of CRON_ROUTES) {
  const src = read(rel)
  ok(`${rel} 有 isBotEnabled 短路`, /isBotEnabled\(\)/.test(src))
  ok(`${rel} 关闭时返回 503`, /BOT_DISABLED_HTTP_STATUS/.test(src))
  ok(`${rel} 关闭分支位于鉴权之后（不会泄露模块状态给匿名请求）`, (() => {
    const authAt = Math.max(src.indexOf('Unauthorized'), src.indexOf('verifyCronAuth'))
    const gateAt = src.indexOf('isBotEnabled()')
    return authAt > -1 && gateAt > -1 && gateAt > authAt
  })())
}

const automationSrc = read('src/app/api/bot-automation/route.ts')
ok(
  'bot-automation 的 GET 与 POST **各自**都有短路（少一处 = 变更类操作绕开开关）',
  (automationSrc.match(/isBotEnabled\(\)/g) || []).length >= 2,
  `实际 ${(automationSrc.match(/isBotEnabled\(\)/g) || []).length} 处`,
)
ok('bot-automation 关闭时返回 503', /BOT_DISABLED_HTTP_STATUS/.test(automationSrc))

const statusSrc = read('src/app/api/bots/status/route.ts')
ok('bots/status 关闭时返回 503', /BOT_DISABLED_HTTP_STATUS/.test(statusSrc) && /isBotEnabled\(\)/.test(statusSrc))

const learnStatsSrc = read('src/app/api/bots/learning/stats/route.ts')
ok('bots/learning/stats 关闭时返回 503', /BOT_DISABLED_HTTP_STATUS/.test(learnStatsSrc) && /isBotEnabled\(\)/.test(learnStatsSrc))

const botAutomationLibSrc = read('src/lib/bot-automation.ts')
ok('BotNeuralNetwork.start 有引擎级守卫', /assertBotEnabled\(\)/.test(botAutomationLibSrc))
ok('executeCycle 有静默跳过（避免定时器里抛未处理异常）', /if \(!isBotEnabled\(\)\)[\s\S]{0,200}return;/.test(botAutomationLibSrc))

const engineSrc = read('src/lib/bot-engine/schedulers/engine.ts')
ok('BotEngine.start 有引擎级守卫', /assertBotEnabled\(\)/.test(engineSrc))
const behaviorSrc = read('src/lib/bot-engine/BotBehaviorEngine.ts')
ok('BotBehaviorEngine.start 有引擎级守卫', /assertBotEnabled\(\)/.test(behaviorSrc))

const tickSrc = read('src/app/api/cron/bot-tick/route.ts')
ok('bot-tick 不再硬编码 tickIntervalMs=60_000', !/tickIntervalMs:\s*60_000/.test(tickSrc))
ok('bot-tick 不再硬编码 maxActionsPerTick=50', !/maxActionsPerTick:\s*50\b/.test(tickSrc))
ok('bot-tick 不再硬编码 minActionIntervalMs=30_000', !/minActionIntervalMs:\s*30_000/.test(tickSrc))
ok('bot-tick 改为从策略取运行参数', /getBotEngineTunables/.test(tickSrc))

const healthSrc = read('src/app/api/health/route.ts')
ok('health 暴露 Bot 模块状态', /botModule/.test(healthSrc))
ok('health 的 bot 状态来自 describeBotPolicy（单一配置源）', /describeBotPolicy\(\)/.test(healthSrc))

// ═══════════════════════════════════════════════════════════
section('6. 边界：bot-policy 不得进入 Edge 中间件')
// ═══════════════════════════════════════════════════════════

const proxySrc = read('proxy.ts')
ok('proxy.ts 未导入 bot-policy（该模块只服务 Node 运行时）', !/bot-policy/.test(proxySrc))
ok(
  'bot-policy 自身不引用 Node 专属模块（便于将来复用）',
  !/from 'node:/.test(read('src/config/bot-policy.ts')),
)

// ═══════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(70))
if (failures.length === 0) {
  console.log(
    `✅ 通过 ${passed} 项 —— Bot 模块已可被单一变量可靠关闭；代码默认已翻转（未设 = 关闭），发行物默认亦关闭。`,
  )
} else {
  console.log(`🔴 失败 ${failures.length} 项 / 共 ${passed + failures.length} 项：`)
  for (const f of failures) console.log(`   · ${f}`)
}
console.log('─'.repeat(70))
process.exit(failures.length === 0 ? 0 : 1)
