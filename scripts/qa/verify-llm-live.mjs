#!/usr/bin/env node
/**
 * 生产实盘验证：Agent 是否真的调到了模型（而不是规则式兜底）
 *
 * 为什么需要这个脚本：`providerHonesty` 只是**自述**，"自述为真"必须由一次真实运行来证。
 * 本脚本用真实账号打生产，走完整链路：
 *
 *   登录 → GET /api/v1/agents/usage（读诚实块）→ POST /api/v1/agents/runs（发起一次真实运行）
 *   → 断言 run 状态不是 DEGRADED、且 usage 里出现非零 token
 *
 * 判定口径（对齐 T09 的诚实条款）：
 *   · 诚实块 `provider.provider` 必须是 `workbuddy`（云端算力）而不是 `none`；
 *   · `realCallsEnabled` 必须为 true；
 *   · 运行状态必须是 `PROPOSED`（模型产出通过 zod 契约）——`DEGRADED` 就是**没调到模型**；
 *   · `usage` 的输入/输出 token 必须 > 0（记 0 = 账本少算，不算通过）。
 *
 * 用法：
 *   node scripts/qa/verify-llm-live.mjs                        # 打生产
 *   node scripts/qa/verify-llm-live.mjs --base=http://localhost:3099
 *   node scripts/qa/verify-llm-live.mjs --email=... --password=...
 */

const argv = process.argv.slice(2)
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}

const BASE = argOf('base', 'https://app.lokfeel.com').replace(/\/$/, '')
const EMAIL = argOf('email', 'admin@lokfeel.com')
const PASSWORD = argOf('password', 'LokFeel@Admin2026!')
const GOAL = argOf('goal', 'Connect our founders with 20 manufacturing partners in 30 days')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

/** 递归找键（响应的外层包装在不同端点略有差异，靠路径硬编码会脆）。 */
function findKey(node, key, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return undefined
  if (Object.prototype.hasOwnProperty.call(node, key)) return node[key]
  for (const v of Object.values(node)) {
    const hit = findKey(v, key, depth + 1)
    if (hit !== undefined) return hit
  }
  return undefined
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: BASE, Referer: `${BASE}/login` },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const body = await res.json().catch(() => ({}))
  const cookies = res.headers.getSetCookie?.() ?? []
  const jar = cookies.map((c) => c.split(';')[0]).join('; ')
  return { status: res.status, body, jar }
}

async function main() {
  console.log(`\n[1/4] 登录 ${BASE}（${EMAIL}）`)
  const { status: loginStatus, body: loginBody, jar } = await login()
  check('登录成功', loginStatus === 200 && Boolean(jar), `status=${loginStatus} cookies=${jar ? 'yes' : 'no'}`)
  if (!jar) {
    console.log('  响应：', JSON.stringify(loginBody).slice(0, 300))
  }

  console.log('\n[2/4] 读诚实块 GET /api/v1/agents/usage')
  const usageRes = await fetch(`${BASE}/api/v1/agents/usage`, {
    headers: { cookie: jar, Origin: BASE },
  })
  const usageJson = await usageRes.json().catch(() => ({}))
  const honesty = findKey(usageJson, 'provider')
  const providerKind = honesty && typeof honesty === 'object' ? honesty.provider : undefined
  const realCalls = honesty && typeof honesty === 'object' ? honesty.realCallsEnabled : undefined

  check('用量接口 200', usageRes.status === 200, `status=${usageRes.status}`)
  check('诚实块存在', Boolean(honesty && typeof honesty === 'object'), JSON.stringify(honesty || null).slice(0, 160))
  check('provider=workbuddy（云端算力）', providerKind === 'workbuddy', `provider=${providerKind}`)
  check('realCallsEnabled=true', realCalls === true, `${realCalls}`)

  console.log('\n[3/4] 发起一次真实运行 POST /api/v1/agents/runs')
  const idem = `verify-llm-${Date.now()}`
  const runRes = await fetch(`${BASE}/api/v1/agents/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: jar,
      Origin: BASE,
      'Idempotency-Key': idem,
    },
    body: JSON.stringify({ skill: 'INTENT_EXTRACTION', input: { goal: GOAL } }),
  })
  const runJson = await runRes.json().catch(() => ({}))
  const run = findKey(runJson, 'run')
  const runStatus = run && typeof run === 'object' ? run.status : undefined
  const degrade = run && typeof run === 'object' ? findKey(run, 'degradeCode') : undefined
  const reason = run && typeof run === 'object' ? findKey(run, 'reason') : undefined

  check('运行已创建（200/201）', runRes.status === 201 || runRes.status === 200, `status=${runRes.status}`)
  check(
    '状态为 PROPOSED（模型产出过契约，不是降级）',
    runStatus === 'PROPOSED',
    `status=${runStatus} degradeCode=${degrade ?? '-'} reason=${String(reason ?? '-').slice(0, 80)}`,
  )
  if (runRes.status !== 200 && runRes.status !== 201) {
    console.log('  响应：', JSON.stringify(runJson).slice(0, 400))
  }

  console.log('\n[4/4] 核对 token 归因')
  const calls = findKey(run ?? {}, 'calls') ?? []
  const total = Array.isArray(calls)
    ? calls.reduce(
        (acc, c) => ({
          input: acc.input + Number(c?.inputTokens ?? 0),
          output: acc.output + Number(c?.outputTokens ?? 0),
        }),
        { input: 0, output: 0 },
      )
    : { input: 0, output: 0 }
  const flat = calls.length === 0 ? findKey(run ?? {}, 'usage') : null
  const inputTokens = total.input || Number(flat?.inputTokens ?? 0)
  const outputTokens = total.output || Number(flat?.outputTokens ?? 0)

  check('输入 token > 0', inputTokens > 0, `${inputTokens}`)
  check('输出 token > 0', outputTokens > 0, `${outputTokens}`)

  const fails = results.filter((r) => !r.ok).length
  const passes = results.length - fails
  console.log(`\n${passes} PASS / ${fails} FAIL / ${results.length} 断言`)
  if (fails === 0) console.log('✅ 生产已真实调用云端模型（非规则式兜底）')
  process.exit(fails === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('❌', e)
  process.exit(1)
})
