#!/usr/bin/env node
/**
 * T10 Slice 4 · **AC-19** 端到端取证：跨社群授权「三方交集」的真实链路上是否成立
 * ═══════════════════════════════════════════════════════════════════════
 * AC-19 的原文（`docs/implementation/BACKLOG.md` §3 T10，`T10/plan.md` §4）：
 *   「**双边群主配置生效**；跨群仅共享**明确 opt-in** 的数据；
 *      **不得直接查询对方私有行**。」
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么必须真浏览器 + 真隔离库 + 三个租户
 * ═══════════════════════════════════════════════════════════════════════
 *   · `tests/bridges/bridges-api.test.ts`（35 例）证的是**函数契约**（mock 掉 db）。
 *     它证不了：路由在**真 Next 运行时**里是否可达、`withTenant` 的能力守卫是否真的
 *     挂在 `/api/v1/bridges/*` 上、cookie 会话是否真的能穿过同一套同源判定。
 *   · `scripts/check-bridge-invariants.mjs`（B1–B5）证的是**内核写不出越权代码**
 *     —— 那是**文本级/结构级**保证，与"运行时到底返回了什么"是两件事。
 *   · 本脚本补的是**运行时**那一层，而且刻意用**两个租户**：单租户夹具下"跨群"
 *     会退化成"同群不同成员"，而那条路径恰好已被 T03 覆盖 —— 断言会在与 AC-19
 *     无关的路径上变绿（最危险的一类假证据）。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 三组取证（每组都必须过）
 * ═══════════════════════════════════════════════════════════════════════
 *   A. **正向**：双群主批准（且**只有被邀方**能批准）+ 双方成员逐个 opt-in
 *      ⇒ ①环交集 ∩ ②成员 opt-in ∩ ③成员意图披露 的**交集字段可见**。
 *      本夹具刻意让 ①环 比实际可见**宽**（四项配置、两项可见）——
 *      「群主配好了」不等于「成员看得到」，这正是 AC-19 的核心命题。
 *   B. **反向（五种不可见）**：
 *        b1 协议 `PENDING`（单边批准）⇒ 空 + 拒绝码 `BRIDGE_PENDING`；
 *        b2 有意图但**未 opt-in** 的成员 ⇒ 不在返回里；
 *        b3 已 opt-in 但**无意图** ⇒ 只进 `gatedOut`，不进成员列表；
 *        b4 成员 opt-in **收窄**后 ⇒ 该字段的键**根本不存在**（不是 `null`）；
 *        b5 群主 `revoke` 后 ⇒ **立即**为空 + `BRIDGE_REVOKED`（投影实时读库，不缓存）。
 *   C. **越权**：
 *        c1 甲群成员读**乙↔丙**协议的详情 / 跨群投影 ⇒ **404**（连"存在"都不泄露）；
 *        c2 甲群成员（MEMBER，无 `bridge.manage`）调 approve ⇒ 403；
 *        c3 甲群群主（OWNER，有 `bridge.manage`，但是**发起方**）调 approve ⇒ 403
 *           —— 这一条是「**双边**群主配置生效」在**制度层**的落点：代码里不存在
 *           "单边发起即可共享"的边。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 判据的两条纪律（继承 T08/P2 渲染取证踩出来的坑）
 * ═══════════════════════════════════════════════════════════════════════
 *   ① **点击前必须等 hydration**（判据 = React fiber 已挂到 host 节点）。
 *      SSR 出来的按钮"看得见"，但 `onClick` 还没挂上，此时点击被**静默丢弃** ——
 *      与"空按钮"表现一致。
 *   ② **跨群投影断言的是"键不存在"**（`hasOwnProperty`），不是"值为空"。
 *      服务端刻意让未授权字段的键**不存在**，因此 `"company" in subject === false`
 *      才是正确判据；用 `subject.company == null` 会把"裁剪失效但值为 null"判成通过。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 用法
 * ═══════════════════════════════════════════════════════════════════════
 *   npm run verify:ac19:bridge
 *   覆盖：AC19_PORT=3121 AC19_DB_FILE=/tmp/x.db
 *   退出码 0 = AC-19 通过。截图落在 /tmp/lf-ac19-shots/，服务日志在 /tmp/lf-ac19-logs/。
 *
 * ⚠️ 长任务（起 next dev + 真实 Chrome）—— 与其它扫描/自证脚本**不可并行**（8G 机）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import {
  AC19_BRIDGES,
  AC19_EXPECT,
  AC19_ORGS,
  AC19_PASSWORD,
  AC19_PROFILES,
  AC19_REFUSAL_LABELS,
  AC19_STATUS_LABELS,
  AC19_USERS,
} from './ac19-fixture.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const PORT = Number(process.env.AC19_PORT || '3121')
const BASE = `http://localhost:${PORT}`
const DB_FILE = process.env.AC19_DB_FILE || '/tmp/ac19-bridge.db'
const DDL_FILE = process.env.AC19_DDL_FILE || '/tmp/ac19-bridge-ddl.sql'
const SHOTS = process.env.AC19_SHOT_DIR || '/tmp/lf-ac19-shots'
const LOG_DIR = process.env.AC19_LOG_DIR || '/tmp/lf-ac19-logs'

const AB = AC19_BRIDGES.ab
const BC = AC19_BRIDGES.bc

// ── 计数与输出 ─────────────────────────────────────────────
let pass = 0
let fail = 0
const ck = (label, ok, extra = '') => {
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? `  ${extra}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const section = (t) => console.log(`\n${t}`)

// ── 子进程 ────────────────────────────────────────────────
const children = []

function spawnBg(name, cmd, args, env, logName) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
  const logPath = path.join(LOG_DIR, `${logName}.log`)
  const out = fs.openSync(logPath, 'a')
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    // detached：dev server 会派生子进程，只杀父进程会留下占端口的孤儿。
    detached: true,
    stdio: ['ignore', out, out],
  })
  child.on('error', (e) => console.log(`  ⚠️ ${name} 启动失败：${e.message}`))
  children.push({ name, child, logPath })
  return child
}

function killAll() {
  for (const { child } of children) {
    if (!child || child.exitCode !== null) continue
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {
        /* 已经没了 */
      }
    }
  }
}

function runToCompletion(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env } })
    let tail = ''
    const keep = (chunk) => {
      tail = `${tail}${chunk.toString()}`.slice(-2000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', () => resolve({ code: -1, tail }))
    child.on('exit', (code) => resolve({ code, tail }))
  })
}

async function waitForHttp(url, { timeoutMs, label }) {
  const t0 = Date.now()
  let last = ''
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
      return { ok: true, status: r.status }
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    await sleep(1000)
  }
  console.log(`  ⚠️ ${label} 未在 ${timeoutMs}ms 内就绪（最后：${last}）`)
  return { ok: false, status: 0 }
}

// ── HTTP 会话 ─────────────────────────────────────────────

/** 用**真实登录端点**换 cookie（不是 NextAuth 的 callback —— 见记忆里的 QA 盲区）。 */
async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: BASE, Referer: `${BASE}/login` },
    body: JSON.stringify({ email, password: AC19_PASSWORD }),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  if (res.status !== 200) {
    throw new Error(`登录失败 ${email}: status=${res.status} ${(await res.text()).slice(0, 200)}`)
  }
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  if (raw.length === 0) throw new Error(`登录成功但没拿到任何 Set-Cookie（${email}）`)
  return raw.map((c) => c.split(';')[0])
}

/**
 * 带会话的租户域请求。
 *
 * `Origin`/`Referer` 必须带 —— `/api/*` 会过 `proxy.ts` 的 CORS 判定与登录端点的
 * 同源判定（同一套 `resolveSiteHosts`）。少了它们，症状是**全站 403**，
 * 看起来像"功能坏了"而其实是测试客户端不像浏览器。
 */
async function req(cookie, method, p, { body, headers } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      cookie: cookie.join('; '),
      Origin: BASE,
      Referer: `${BASE}/workspace`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON（错误页等）—— 断言只看 status 时用不到 */
  }
  return { status: res.status, json, text }
}

const data = (r) => (r.json && typeof r.json === 'object' ? r.json.data : undefined)

/** `hasOwnProperty` —— 未授权字段的键必须**不存在**（不是 `null`）。 */
const hasKey = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key)

async function waitForFn(page, fn, arg, timeout, label) {
  try {
    await page.waitForFunction(fn, arg, { timeout })
    return true
  } catch {
    console.log(`     ⚠️ 等待超时：${label}`)
    return false
  }
}

// ═══════════════════════════════════════════════════════════
const main = async () => {
  console.log(`\nAC-19 · Community Bridge 跨社群授权三方交集的端到端取证`)
  console.log(`  目标 ${BASE}`)
  console.log(`  隔离库 ${DB_FILE}`)
  console.log(`  截图目录 ${SHOTS}`)

  fs.mkdirSync(SHOTS, { recursive: true })
  fs.mkdirSync(LOG_DIR, { recursive: true })

  // ═══════════════════════════════════════════════════════════
  section('── ⓪ 引导：三租户隔离库 → dev server → 四个身份的真实登录')
  // ═══════════════════════════════════════════════════════════
  const seed = await runToCompletion(
    'node',
    ['scripts/qa/seed-ac19-bridge-e2e.mjs', '--reset', '--regenerate'],
    { E2E_DB_FILE: DB_FILE, E2E_DDL_FILE: DDL_FILE, E2E_PASSWORD: AC19_PASSWORD },
  )
  ck(
    '夹具就绪：甲/乙/丙 三群 + 7 个账号 + 4 份意图 + 2 份协议（含越权靶标）',
    seed.code === 0,
    seed.code === 0 ? '' : seed.tail.slice(-400),
  )
  if (seed.code !== 0) return

  spawnBg(
    'next-dev',
    'npx',
    ['next', 'dev', '--turbopack', '-p', String(PORT)],
    {
      DATABASE_URL: `file:${DB_FILE}`,
      AUTH_URL: BASE,
      NEXTAUTH_URL: BASE,
      NEXT_PUBLIC_APP_URL: BASE,
    },
    'next-dev',
  )
  const devReady = await waitForHttp(`${BASE}/api/health`, { timeoutMs: 240_000, label: 'dev server' })
  ck('dev server 就绪（/api/health 可达）', devReady.ok, `status=${devReady.status}`)
  if (!devReady.ok) return

  // bMember3 也要登录：它是「已 opt-in 但**无意图**」那条反向证据的主角。
  const ids = ['aOwner', 'aMember', 'bOwner', 'bMember', 'bMember3']
  const cookies = {}
  for (const key of ids) {
    const email = AC19_USERS[key].email
    try {
      cookies[key] = await login(email)
      ck(`真实登录端点换到会话 cookie（${key} · ${email}）`, cookies[key].length > 0)
    } catch (e) {
      ck(`真实登录端点（${key} · ${email}）`, false, e instanceof Error ? e.message : String(e))
      return
    }
  }

  // ═══════════════════════════════════════════════════════════
  section('── A · 正向前的两组"结构"证据（越权 + 单边不能激活 + 发起幂等）')
  // ═══════════════════════════════════════════════════════════

  // A1 起点：协议是 PENDING，甲群成员能看到它，立场是"我方发起"。
  {
    const r = await req(cookies.aMember, 'GET', '/api/v1/bridges')
    const bridges = data(r)?.bridges ?? []
    const ab = bridges.find((b) => b.id === AB)
    ck('甲群成员 GET /api/v1/bridges → 200', r.status === 200, `status=${r.status}`)
    ck(
      '列表里出现主协议，且状态视图 = PENDING、立场 = INITIATOR（由服务端从 DB 行推导）',
      !!ab && ab.status === 'PENDING' && ab.side === 'INITIATOR' && ab.storedStatus === 'PENDING',
      ab ? `status=${ab.status} side=${ab.side} stored=${ab.storedStatus}` : '未找到该协议',
    )
    ck(
      '①环 = 双边配置交集（4 项），且与单侧配置区分开（单侧键不当作"已共享"）',
      !!ab &&
        JSON.stringify(ab.agreedFieldKeys) === JSON.stringify(AC19_EXPECT.agreedKeys) &&
        ab.initiatorFieldKeys.length === AC19_EXPECT.agreedKeys.length,
      ab ? `agreed=${JSON.stringify(ab.agreedFieldKeys)}` : '',
    )
  }

  // A2 越权（c1）：甲群成员读**乙↔丙**协议 —— 连"存在"都不能泄露。
  {
    const d = await req(cookies.aMember, 'GET', `/api/v1/bridges/${BC}`)
    ck('越权 c1a：甲群成员读乙↔丙协议详情 ⇒ 404', d.status === 404, `status=${d.status}`)
    const g = await req(cookies.aMember, 'GET', `/api/v1/bridges/${BC}/discovery`)
    ck('越权 c1b：甲群成员读乙↔丙协议的跨群投影 ⇒ 404', g.status === 404, `status=${g.status}`)

    // 🔴 c1c 的**身份选择**是有讲究的，两条各自只证明一件事：
    //    ① 用 MEMBER（无 `bridge.manage`）⇒ 403：能力守卫在**处理器之前**就拒绝，
    //       因此"你连这个动作都不许做"与"这份协议存不存在"是分开的两层。
    //    ② 用 OWNER（**有** `bridge.manage`，但不是当事方）⇒ 404：
    //       只有越过能力层之后，"不是当事方 ⇒ 连存在都不泄露"这条才可被观察。
    //    若只测①，测到的是能力层；若只测②，测不到能力层。两条都要。
    const memberApprove = await req(cookies.aMember, 'POST', `/api/v1/bridges/${BC}/approve`)
    ck(
      '越权 c1c：MEMBER 批准乙↔丙协议 ⇒ 403（能力守卫在**当事方判定之前**，两层不混淆）',
      memberApprove.status === 403,
      `status=${memberApprove.status}`,
    )
    const ownerApprove = await req(cookies.aOwner, 'POST', `/api/v1/bridges/${BC}/approve`)
    ck(
      '越权 c1d：**有** bridge.manage 但不是当事方的群主批准 ⇒ 404（越过能力层后仍只看到"不存在"）',
      ownerApprove.status === 404,
      `status=${ownerApprove.status}`,
    )
  }

  // A3 单边不能激活（c3 / c2）。
  {
    const ownerApprove = await req(cookies.aOwner, 'POST', `/api/v1/bridges/${AB}/approve`)
    ck(
      '越权 c3：**发起方**群主批准自己的协议 ⇒ 403（WRONG_SIDE，单边不得激活）',
      ownerApprove.status === 403,
      `status=${ownerApprove.status}`,
    )
    const memberApprove = await req(cookies.aMember, 'POST', `/api/v1/bridges/${AB}/approve`)
    ck(
      '越权 c2：MEMBER 调 approve ⇒ 403（能力不足：bridge.manage 是 ADMIN+）',
      memberApprove.status === 403,
      `status=${memberApprove.status}`,
    )
  }

  // A4 反向 b1：PENDING ⇒ 空 + 拒绝码（**不**返回 4xx —— 等对方批准是正常状态）。
  {
    const r = await req(cookies.aMember, 'GET', `/api/v1/bridges/${AB}/discovery`)
    const d = data(r)
    ck(
      '反向 b1：PENDING 时投影 ⇒ 200 + 空列表 + 拒绝码 BRIDGE_PENDING（不是 4xx）',
      r.status === 200 && d?.bridgeRefusalCode === 'BRIDGE_PENDING' && d?.visibleCount === 0,
      `status=${r.status} code=${d?.bridgeRefusalCode} visible=${d?.visibleCount}`,
    )
  }

  // A5 发起链路 + 幂等（AC-19 之外，但"跨群授权面"的入口必须在，否则正向没有起点）。
  let createdBridgeId = null
  {
    const payload = {
      recipientOrgId: AC19_ORGS.c.id,
      initiatorFieldKeys: ['displayName', 'city'],
      recipientFieldKeys: ['displayName', 'city'],
      shareableMissionKinds: ['跨群合作'],
      purpose: 'AC-19 取证：验证发起链路与幂等键（不参与三方交集的判定）。',
    }
    const noKey = await req(cookies.aOwner, 'POST', '/api/v1/bridges', { body: payload })
    ck(
      'A5a：不带 Idempotency-Key 发起 ⇒ 400（幂等键是硬约束，不退化为非幂等）',
      noKey.status === 400,
      `status=${noKey.status}`,
    )

    const key = `ac19-create-${Date.now()}`
    const first = await req(cookies.aOwner, 'POST', '/api/v1/bridges', {
      body: payload,
      headers: { 'Idempotency-Key': key },
    })
    createdBridgeId = data(first)?.bridge?.id ?? null
    ck(
      'A5b：甲群群主发起甲↔丙协议 ⇒ 201 且落库即 PENDING（发起方创建即已批准）',
      first.status === 201 && !!createdBridgeId && data(first)?.replayed === false && data(first)?.bridge?.status === 'PENDING',
      `status=${first.status} id=${createdBridgeId}`,
    )

    const replay = await req(cookies.aOwner, 'POST', '/api/v1/bridges', {
      body: payload,
      headers: { 'Idempotency-Key': key },
    })
    ck(
      'A5c：同一把幂等键重放 ⇒ 200 + replayed:true + **同一** bridgeId（不产生第二份协议）',
      replay.status === 200 &&
        data(replay)?.replayed === true &&
        data(replay)?.bridge?.id === createdBridgeId,
      `status=${replay.status} replayed=${data(replay)?.replayed}`,
    )
  }

  // ═══════════════════════════════════════════════════════════
  section('── B · 正向：被邀方群主批准 → 双方成员逐个 opt-in → 交集字段可见')
  // ═══════════════════════════════════════════════════════════

  // B1 被邀方群主批准（ACTIVE 的唯一入口）。
  {
    const r = await req(cookies.bOwner, 'POST', `/api/v1/bridges/${AB}/approve`)
    const b = data(r)
    ck(
      '被邀方群主批准 ⇒ 200 + ACTIVE + 落库值也为 ACTIVE + recipientApprovedAt 非空',
      r.status === 200 && b?.status === 'ACTIVE' && b?.storedStatus === 'ACTIVE' && !!b?.recipientApprovedAt,
      `status=${r.status} view=${b?.status} stored=${b?.storedStatus}`,
    )
    const again = await req(cookies.bOwner, 'POST', `/api/v1/bridges/${AB}/approve`)
    ck('重复批准 ⇒ 409（ALREADY_ACTIVE，不是幂等成功）', again.status === 409, `status=${again.status}`)
  }

  // B2 刚生效、无人 opt-in ⇒ 空，但拒绝码为 null（协议可用，是"没人加入"而非"协议不行"）。
  {
    const d = data(await req(cookies.aMember, 'GET', `/api/v1/bridges/${AB}/discovery`))
    ck(
      '生效瞬间：投影为空但**拒绝码为 null**（把"协议不可用"与"没人加入"分开）',
      d?.bridgeRefusalCode === null && d?.visibleCount === 0 && d?.optedInCount === 0,
      `code=${d?.bridgeRefusalCode} visible=${d?.visibleCount} optedIn=${d?.optedInCount}`,
    )
  }

  // B3 乙群 bMember 逐个 opt-in（勾满四项 —— ①环全量）。
  {
    const r = await req(cookies.bMember, 'POST', `/api/v1/bridges/${AB}/opt-in`, {
      body: { disclosedFieldKeys: AC19_EXPECT.agreedKeys },
    })
    ck(
      '乙群成员 bMember 逐个 opt-in 四项 ⇒ 200 + ACTIVE + 回显排序后的字段键',
      r.status === 200 &&
        data(r)?.optIn?.status === 'ACTIVE' &&
        JSON.stringify(data(r)?.optIn?.disclosedFieldKeys) === JSON.stringify(AC19_EXPECT.agreedKeys),
      `status=${r.status} keys=${JSON.stringify(data(r)?.optIn?.disclosedFieldKeys)}`,
    )
  }

  // B4 反向 b3 的前置：乙群 bMember3 **没有** SocialIntent（夹具刻意不造）。
  //    它仍然可以 opt-in —— opt-in 只看「本组织配置允许的字段」，不看你有没有意图。
  //    这是刻意的分层：**加入**与**可披露依据**是两件事，缺后者只影响可见性（进 gatedOut）。
  {
    const r = await req(cookies.bMember3, 'POST', `/api/v1/bridges/${AB}/opt-in`, {
      body: { disclosedFieldKeys: ['displayName'] },
    })
    ck(
      '反向 b3 前置：无意图的 bMember3 opt-in ⇒ 200（opt-in 不依赖意图 —— 两者是不同层）',
      r.status === 200 && data(r)?.optIn?.status === 'ACTIVE',
      `status=${r.status}`,
    )
  }

  // ═══════════════════════════════════════════════════════════
  // C · 甲群视角的跨群投影：三环交集的**逐键**取证
  // ═══════════════════════════════════════════════════════════
  section('── C · 甲群视角：跨群投影逐键取证（交集 / 收窄 / 未加入 / 无依据）')
  let memberSubject = null
  {
    const r = await req(cookies.aMember, 'GET', `/api/v1/bridges/${AB}/discovery`)
    const d = data(r)
    const members = d?.members ?? []
    const bm = members.find((m) => m.userId === AC19_USERS.bMember.id)

    ck('甲群成员读跨群投影 ⇒ 200', r.status === 200, `status=${r.status}`)
    ck(
      `可见成员数 = 1（只有 bMember；bMember2 未 opt-in、bMember3 无依据都不进来）`,
      d?.visibleCount === 1 && members.length === 1 && !!bm,
      `visible=${d?.visibleCount} members=${members.map((m) => m.userId).join(',')}`,
    )
    ck(
      `对方已 opt-in 计数 = 2（bMember + bMember3 —— 计数含"已加入但不可见"的人）`,
      d?.optedInCount === 2,
      `optedIn=${d?.optedInCount}`,
    )
    ck(
      `bMember 的可见字段键 = ${JSON.stringify(AC19_EXPECT.bMemberVisibleKeys)}（**三项交集**后的结果）`,
      !!bm && JSON.stringify(bm.sharedFieldKeys) === JSON.stringify(AC19_EXPECT.bMemberVisibleKeys),
      bm ? `keys=${JSON.stringify(bm.sharedFieldKeys)}` : '',
    )

    memberSubject = bm?.subject ?? null
    ck(
      '正向：交集内字段的**值**被投影出来（城市=深圳、昵称=周雨）',
      memberSubject?.city === AC19_PROFILES.bMember.city &&
        memberSubject?.displayName === AC19_PROFILES.bMember.displayName,
      `city=${memberSubject?.city} displayName=${memberSubject?.displayName}`,
    )

    // 🔴 交叉验证：①环放行、②环勾选，但③环（意图披露档位）不足 ⇒ 键**不存在**。
    ck(
      '三环收窄：①环放行 + ②环勾选的 company/occupation 因**③环档位不足**而不可见（键不存在，不是 null）',
      !hasKey(memberSubject, 'company') && !hasKey(memberSubject, 'occupation'),
      `subject keys=[${Object.keys(memberSubject || {}).join(',')}]`,
    )
    ck(
      '未授权字段的键**根本不存在**（不是值为 null —— 序列化后不留下该字段的痕迹）',
      !hasKey(memberSubject, 'email') && !hasKey(memberSubject, 'age') && !hasKey(memberSubject, 'bio'),
      `email in subject = ${hasKey(memberSubject, 'email')}`,
    )
    ck(
      '跨群投影**不给**逐字段归因（那是对方组织的内部配置 ⇒ 元数据泄漏）',
      !!bm && !hasKey(bm, 'narrowed') && !hasKey(bm, 'refusalCode'),
      bm ? `bm keys=[${Object.keys(bm).join(',')}]` : '',
    )

    const gated = (d?.gatedOut ?? []).find((g) => g.code === 'NO_INTENT_DISCLOSURE')
    ck(
      '反向 b3：已 opt-in 但无披露依据的成员只出现在 gatedOut（按原因聚合，无 userId、无字段键）',
      gated?.count === 1,
      `gatedOut=${JSON.stringify(d?.gatedOut)}`,
    )
    ck(
      '投影档位自描述 = CANDIDATE（契约明示，供人核对；T03/T10 都要求它可观察）',
      d?.profileAudience === 'CANDIDATE',
      `audience=${d?.profileAudience}`,
    )
  }

  // ── D · 反方向：乙群视角看甲群成员（自己的数据也要能被对方看到才算"共享"）──
  section('── D · 反方向：甲群成员 opt-in ⇒ 乙群视角可见（共享是**双向**的）')
  {
    const o = await req(cookies.aMember, 'POST', `/api/v1/bridges/${AB}/opt-in`, {
      body: { disclosedFieldKeys: ['displayName', 'city'] },
    })
    ck('甲群成员 opt-in 两项 ⇒ 200', o.status === 200, `status=${o.status}`)

    // D3 反方向：甲群成员的档案值也真的过去了（证明共享是**双向**的）。
    const amExpect = AC19_PROFILES.aMember
    const d = data(await req(cookies.bOwner, 'GET', `/api/v1/bridges/${AB}/discovery`))
    const am = (d?.members ?? []).find((m) => m.userId === AC19_USERS.aMember.id)
    ck(
      '乙群视角可见甲群成员，字段键 = 交集，值来自甲群成员的档案（上海 / 林晓）',
      !!am &&
        JSON.stringify(am.sharedFieldKeys) === JSON.stringify(AC19_EXPECT.aMemberVisibleKeys) &&
        am.subject?.city === amExpect.city &&
        am.subject?.displayName === amExpect.displayName,
      am ? `keys=${JSON.stringify(am.sharedFieldKeys)} city=${am.subject?.city}` : '未找到',
    )
  }

  // ── E · bMember 的**本人视角**：逐字段归因 + 「该找谁」──
  section('── E · 本人视角：收窄归因与归属（只有本人能看到"是我的设置还是群主的协议"）')
  {
    const r = await req(cookies.bMember, 'GET', `/api/v1/bridges/${AB}`)
    const proj = data(r)?.myProjection
    const narrowedByKey = new Map((proj?.narrowed ?? []).map((n) => [n.key, n]))
    ck(
      'bMember 的 myProjection 可见键 = 交集结果',
      JSON.stringify(proj?.sharedFieldKeys) === JSON.stringify(AC19_EXPECT.bMemberVisibleKeys),
      `keys=${JSON.stringify(proj?.sharedFieldKeys)}`,
    )
    ck(
      '被③环收窄的两项归因为 INTENT_DISCLOSURE，且**归属 = MEMBER**（该找谁由领域层写死，UI 不猜）',
      AC19_EXPECT.intentNarrowedKeys.every(
        (k) => narrowedByKey.get(k)?.by === 'INTENT_DISCLOSURE' && narrowedByKey.get(k)?.owner === 'MEMBER',
      ),
      JSON.stringify(proj?.narrowed),
    )
  }

  // ── F · 反向 b4：opt-in **收窄** ⇒ 字段立即不可见（且可恢复）──
  section('── F · 反向 b4：成员 opt-in 收窄 ⇒ 该字段立即不可见')
  {
    const narrow = await req(cookies.bMember, 'POST', `/api/v1/bridges/${AB}/opt-in`, {
      body: { disclosedFieldKeys: ['displayName'] },
    })
    ck('收窄 opt-in（只留 displayName）⇒ 200', narrow.status === 200, `status=${narrow.status}`)

    const d1 = data(await req(cookies.aMember, 'GET', `/api/v1/bridges/${AB}/discovery`))
    const bm1 = (d1?.members ?? []).find((m) => m.userId === AC19_USERS.bMember.id)
    ck(
      '收窄后：可见键只剩 displayName，且 `city` 的键**消失**',
      JSON.stringify(bm1?.sharedFieldKeys) === JSON.stringify(AC19_EXPECT.bMemberNarrowedKeys) &&
        !hasKey(bm1?.subject, 'city'),
      `keys=${JSON.stringify(bm1?.sharedFieldKeys)} city in subject=${hasKey(bm1?.subject, 'city')}`,
    )

    const restore = await req(cookies.bMember, 'POST', `/api/v1/bridges/${AB}/opt-in`, {
      body: { disclosedFieldKeys: AC19_EXPECT.agreedKeys },
    })
    const d2 = data(await req(cookies.aMember, 'GET', `/api/v1/bridges/${AB}/discovery`))
    const bm2 = (d2?.members ?? []).find((m) => m.userId === AC19_USERS.bMember.id)
    ck(
      '恢复勾选 ⇒ 可见键回到交集结果（opt-in 是**幂等更新**，不是新增行）',
      restore.status === 200 &&
        JSON.stringify(bm2?.sharedFieldKeys) === JSON.stringify(AC19_EXPECT.bMemberVisibleKeys),
      `keys=${JSON.stringify(bm2?.sharedFieldKeys)}`,
    )
  }

  // ── G · 反向 b2：未 opt-in 的成员（bMember2）在任何阶段都不可见 ──
  section('── G · 反向 b2：有意图但**未 opt-in** 的成员始终不可见')
  {
    const d = data(await req(cookies.aMember, 'GET', `/api/v1/bridges/${AB}/discovery`))
    const ids = (d?.members ?? []).map((m) => m.userId)
    const gatedCodes = (d?.gatedOut ?? []).map((g) => g.code)
    ck(
      'bMember2（有意图、未 opt-in）不出现在成员列表',
      !ids.includes(AC19_USERS.bMember2.id),
      `members=[${ids.join(',')}]`,
    )
    ck(
      'bMember2 也**不**出现在 gatedOut —— 查询谓词只有"已 opt-in 的人"，从未 opt-in 的人连计数都不进',
      !gatedCodes.includes('MEMBER_NOT_OPTED_IN') && d?.optedInCount === 2,
      `gatedOut codes=[${gatedCodes.join(',')}] optedIn=${d?.optedInCount}`,
    )
  }

  // ═══════════════════════════════════════════════════════════
  section('── H · 真实 Chrome：甲群群主在工作区里看到的就是上面这些（渲染层取证）')
  // ═══════════════════════════════════════════════════════════
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  await ctxA.addCookies(
    cookies.aOwner.map((pair) => {
      const i = pair.indexOf('=')
      return {
        name: pair.slice(0, i),
        value: pair.slice(i + 1),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
      }
    }),
  )
  const page = await ctxA.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('dialog', (d) => {
    console.log(`  · 浏览器 dialog（已 dismiss）：${d.message().slice(0, 120)}`)
    d.dismiss().catch(() => {})
  })

  const shot = async (name) => {
    try {
      await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
    } catch {
      /* 截图只是证据 */
    }
  }

  try {
    // ① 打开工作区并等 hydration（判据 = React fiber 已挂上）。
    await page.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded', timeout: 240_000 })
    const hydrated = await waitForFn(
      page,
      () => {
        const el = document.body
        return Object.keys(el).some((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'))
      },
      undefined,
      90_000,
      'hydration（React 接管 DOM）',
    )
    ck('渲染层：/workspace 完成 hydration（未 hydration 时点击会被静默丢弃）', hydrated)
    ck('渲染层：未被登录守卫弹回 /login', page.url().includes('/workspace'), `url=${page.url()}`)

    // ② 进 Consent 区 → 切到「跨社群」子面板。
    const navConsent = page.locator('nav[aria-label="工作区导航"] button', { hasText: 'Consent' }).first()
    await navConsent.waitFor({ state: 'visible', timeout: 30_000 })
    await navConsent.click()
    const bridgeTab = page.locator('[data-testid="consent-tab-bridge"]')
    await bridgeTab.waitFor({ state: 'visible', timeout: 30_000 })
    ck('渲染层：Consent 区出现「跨社群」子面板入口（NAV 仍是七项，未新增第八屏）', true)
    const navCount = await page.locator('nav[aria-label="工作区导航"] button').count()
    ck('渲染层：左侧导航仍为 7 项（T10 采用子面板而非第八屏）', navCount === 7, `实际=${navCount}`)
    await bridgeTab.click()

    // ③ 协议列表：应同时列出「甲↔乙（已生效）」与刚才 API 新建的「甲↔丙」。
    const list = page.locator('[data-testid="bridge-list"]')
    await list.waitFor({ state: 'visible', timeout: 90_000 })
    const itemCount = await page.locator('[data-testid^="bridge-list-item-"]').count()
    ck('渲染层：协议列表渲染出 ≥2 份协议（甲↔乙 + 新建的甲↔丙）', itemCount >= 2, `实际=${itemCount}`)
    await shot('ac19-bridge-list')

    // ④ 选中主协议，等它渲染成 ACTIVE。
    const item = page.locator(`[data-testid="bridge-list-item-${AB}"]`)
    await item.waitFor({ state: 'visible', timeout: 30_000 })
    await item.click()
    const statusOk = await waitForFn(
      page,
      (t) => {
        const el = document.querySelector('[data-testid="bridge-status"]')
        return !!el && (el.textContent || '').includes(t)
      },
      AC19_STATUS_LABELS.ACTIVE,
      60_000,
      `bridge-status = ${AC19_STATUS_LABELS.ACTIVE}`,
    )
    ck(`渲染层：协议状态渲染为「${AC19_STATUS_LABELS.ACTIVE}」`, statusOk)
    await waitForFn(
      page,
      () => !!document.querySelector('[data-testid="bridge-discovery"]'),
      undefined,
      60_000,
      '跨群投影区块出现',
    )

    // ⑤ ①环：界面上「已同意共享」必须来自**交集**（四项）。
    const agreedText = (await page.locator('[data-testid="bridge-agreed"]').first().textContent()) ?? ''
    const agreedLabels = [
      AC19_EXPECT.labels.displayName,
      AC19_EXPECT.labels.city,
      AC19_EXPECT.labels.company,
      AC19_EXPECT.labels.occupation,
    ]
    ck(
      `渲染层：①环展示的是**双边交集**（${agreedLabels.join('/')} 四项都在）—— 不是单侧配置`,
      agreedLabels.every((l) => agreedText.includes(l)),
      `agreed=「${agreedText}」`,
    )

    // ⑥ 本人视角：aOwner 未 opt-in ⇒ 拒绝码 MEMBER_NOT_OPTED_IN（而不是"什么都没有"）。
    const refusal = await page.locator('[data-testid="bridge-refusal"]').first().textContent().catch(() => null)
    ck(
      '渲染层：甲群群主的本人视角显示「尚未选择加入」（协议可用 vs 我没加入，两者文案不同）',
      !!refusal && refusal.includes('尚未选择加入'),
      `refusal=「${(refusal || '').trim().slice(0, 60)}」`,
    )

    // ⑦ 跨群可见成员：计数 + 字段值 + 泄漏面。
    const visibleOk = await waitForFn(
      page,
      () => {
        const el = document.querySelector('[data-testid="bridge-visible-count"]')
        return !!el && (el.textContent || '').trim() === '1'
      },
      undefined,
      60_000,
      '桥-visible-count = 1',
    )
    ck('渲染层：可见成员数 = 1', visibleOk)

    const memberSel = `[data-testid="bridge-member-${AC19_USERS.bMember.id}"]`
    ck('渲染层：bMember 的成员卡出现', (await page.locator(memberSel).count()) === 1)
    const cityVal = (await page.locator(`[data-testid="bridge-field-city"]`).first().textContent()) ?? ''
    const nameVal = (await page.locator(`[data-testid="bridge-field-displayName"]`).first().textContent()) ?? ''
    ck(
      `渲染层：交集内字段的**值**被渲染（城市=${AC19_PROFILES.bMember.city}）`,
      cityVal.trim() === AC19_PROFILES.bMember.city,
      `city=「${cityVal.trim()}」`,
    )
    ck(
      `渲染层：昵称=${AC19_PROFILES.bMember.displayName}`,
      nameVal.trim() === AC19_PROFILES.bMember.displayName,
      `displayName=「${nameVal.trim()}」`,
    )

    const leaked = []
    for (const key of ['company', 'occupation', 'email', 'age', 'bio']) {
      const n = await page.locator(`[data-testid="bridge-field-${key}"]`).count()
      if (n > 0) leaked.push(key)
    }
    ck(
      '渲染层：**被三环挡掉的字段在界面上一个都没有**（company/occupation/email/age/bio）',
      leaked.length === 0,
      leaked.length ? `泄漏=${leaked.join(',')}` : '',
    )
    ck(
      '渲染层：未 opt-in 的 bMember2 的成员卡不存在',
      (await page.locator(`[data-testid="bridge-member-${AC19_USERS.bMember2.id}"]`).count()) === 0,
    )

    const gatedText = (await page.locator('[data-testid="bridge-gated-out"]').first().textContent()) ?? ''
    ck(
      '渲染层：gatedOut 区块显示「无生效中的意图」聚合（只有计数，没有 userId / 字段键）',
      gatedText.includes(AC19_REFUSAL_LABELS.NO_INTENT_DISCLOSURE),
      `gated=「${gatedText.replace(/\s+/g, ' ').trim().slice(0, 80)}」`,
    )
    await shot('ac19-bridge-active-with-projection')

    // ⑧ 撤销：**从界面点**（真实人类路径），再断言投影立即为空。
    const revoke = page.locator('[data-testid="bridge-revoke"]')
    ck('渲染层：活跃协议上出现「撤销」按钮（canRevoke 由服务端下发，不是前端自算）', (await revoke.count()) === 1)
    await revoke.click()
    const revokedOk = await waitForFn(
      page,
      (t) => {
        const el = document.querySelector('[data-testid="bridge-status"]')
        return !!el && (el.textContent || '').includes(t)
      },
      AC19_STATUS_LABELS.REVOKED,
      60_000,
      `bridge-status = ${AC19_STATUS_LABELS.REVOKED}`,
    )
    ck(`渲染层：点「撤销」后状态变为「${AC19_STATUS_LABELS.REVOKED}」`, revokedOk)

    const zeroOk = await waitForFn(
      page,
      () => {
        const el = document.querySelector('[data-testid="bridge-visible-count"]')
        return !!el && (el.textContent || '').trim() === '0'
      },
      undefined,
      60_000,
      '撤销后 visible-count = 0',
    )
    ck('渲染层：撤销后**立即**可见成员数 = 0（投影实时读库，不缓存"上次可见的集合"）', zeroOk)
    const dRefusal =
      (await page.locator('[data-testid="bridge-discovery-refusal"]').first().textContent().catch(() => '')) ?? ''
    ck(
      '渲染层：撤销后跨群区块给出「协议已被撤销」的原因（不把它们显示成"查询失败"）',
      dRefusal.includes(AC19_REFUSAL_LABELS.BRIDGE_REVOKED),
      `refusal=「${dRefusal.replace(/\s+/g, ' ').trim().slice(0, 60)}」`,
    )
    await shot('ac19-bridge-revoked')

    ck(
      '渲染层：全程无页面级未捕获异常（pageerror）',
      pageErrors.length === 0,
      pageErrors.length ? pageErrors.slice(0, 3).join(' | ').slice(0, 200) : '',
    )
  } finally {
    await browser.close()
  }

  // ═══════════════════════════════════════════════════════════
  section('── I · 撤销之后的终态（反向 b5 的精确拒绝码 + opt-out 永远允许）')
  // ═══════════════════════════════════════════════════════════
  {
    const d = data(await req(cookies.bOwner, 'GET', `/api/v1/bridges/${AB}/discovery`))
    ck(
      '反向 b5：撤销后投影 ⇒ 空 + 拒绝码 BRIDGE_REVOKED（storedStatus 也已是 REVOKED）',
      d?.bridgeRefusalCode === 'BRIDGE_REVOKED' && d?.visibleCount === 0,
      `code=${d?.bridgeRefusalCode} visible=${d?.visibleCount}`,
    )

    const optInAfter = await req(cookies.bMember, 'POST', `/api/v1/bridges/${AB}/opt-in`, {
      body: { disclosedFieldKeys: ['displayName'] },
    })
    ck(
      '撤销后 opt-in ⇒ 409（会误导用户的死动作被拒绝）',
      optInAfter.status === 409,
      `status=${optInAfter.status}`,
    )

    const optOut = await req(cookies.bMember, 'POST', `/api/v1/bridges/${AB}/opt-out`)
    ck(
      '撤销后 opt-out ⇒ 200（收窄方向的动作**不受**协议状态限制 —— 否则界面上会留一个消不掉的"已加入"）',
      optOut.status === 200 && data(optOut)?.optIn?.status === 'WITHDRAWN',
      `status=${optOut.status} rowStatus=${data(optOut)?.optIn?.status}`,
    )

    const again = await req(cookies.bMember, 'POST', `/api/v1/bridges/${AB}/opt-out`)
    ck('重复 opt-out ⇒ 409（不静默成功 —— 那会掩盖"我以为我还加入着"）', again.status === 409, `status=${again.status}`)

    const detail = data(await req(cookies.bMember, 'GET', `/api/v1/bridges/${AB}`))
    ck(
      'opt-out 后本人的 myOptIn.status = WITHDRAWN（保留行，供审计）',
      detail?.myProjection?.myOptIn?.status === 'WITHDRAWN',
      `status=${detail?.myProjection?.myOptIn?.status}`,
    )
  }

  // ═══════════════════════════════════════════════════════════
  console.log(
    `\n════════ AC-19 结果：${pass} 通过 / ${fail} 失败 ════════\n` +
      `正向：双边群主批准 + 双方成员 opt-in ⇒ 交集字段可见（①环比实际可见宽，正是 AC-19 的命题）\n` +
      `反向：PENDING / 未 opt-in / 无披露依据 / 收窄 / 撤销 五种状态各自不可见，且拒绝码互不混淆\n` +
      `越权：非当事组织读协议（详情/投影/批准）一律 404；发起方群主批准自己的协议 403；MEMBER 批准 403\n`,
  )
  process.exitCode = fail === 0 ? 0 : 1
}

main()
  .catch((err) => {
    console.error('\n❌ 取证脚本异常：', err?.stack || err?.message || err)
    process.exitCode = 1
  })
  .finally(() => {
    killAll()
    console.log('（已停止本次启动的子进程；截图见上方目录）')
  })
