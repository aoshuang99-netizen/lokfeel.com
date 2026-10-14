#!/usr/bin/env node
/**
 * 本地「假 OpenAI 兼容端点」—— **只服务于 `verify:p2:e2e` 的确定性前置**。
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么需要它（而不是"就用真 key 跑")
 * ═══════════════════════════════════════════════════════════════
 * P2 的验收原文是「全链路真实 API、**审批与状态更新**」。
 * 要走通**成功的**批准（`AWAITING_APPROVAL → APPROVED → 200`），
 * 就必须有一条运行真的落在 `AWAITING_APPROVAL`。
 *
 * 而运行落到 `AWAITING_APPROVAL` 的**唯一**路径是"高风险技能产出了可用的提案"：
 *   - 没有 `OPENAI_API_KEY` → `unavailable` → `INTRO_DRAFT` **没有降级路径** → `FAILED`
 *     → 批准必然 409（这条路测出的永远是"状态不允许"，测不到成功批准）；
 *   - 用真实 key → 模型输出**是否**过 `IntroDraftOutputSchema` 不保证，
 *     而且每次跑都在花钱、都在联网 —— 一条不该由"外部模型的心情"决定的断言。
 *
 * 因此：给服务端一个 `OPENAI_BASE_URL` 指向本进程，应答体由我们**逐字**决定。
 * 这样"审批能成功"与"审批后刷新仍成立"才是**可复跑**的。
 *
 * 🔴 它**不是** stub provider，也不是把 T09 的"无凭据即不可用"放宽：
 *    服务端仍然走**完整**的真实调用链（`createOpenAIProvider` → fetch → usage 归因
 *    → zod 校验 → 越界检查 → 状态机），只是把"模型"换成了一个**说话内容固定**的端点。
 *    生产环境不会有任何代码读这个变量（`resolveProviderConfig` 只认 env，且默认指向官方端点）。
 *
 * ═══════════════════════════════════════════════════════════════
 * 技能 → 应答体：按 `max_tokens` 路由（不靠猜 prompt 文本）
 * ═══════════════════════════════════════════════════════════════
 * `createOpenAIProvider` 把 `skill.costProfile.estimatedOutputTokens` 原样放进
 * `max_tokens`，而三个技能的估值**互不相同** ⇒ 这是一个稳定且不依赖文案的判别键：
 *
 *   max_tokens 1200 → INTRO_DRAFT        （`estimatedOutputTokens: 1200`）
 *   max_tokens  900 → COORDINATION_ADVICE（`estimatedOutputTokens:  900`）
 *   max_tokens  800 → INTENT_EXTRACTION  （`estimatedOutputTokens:  800`）
 *
 * ⚠️ 未知 `max_tokens` 一律 **400**（而不是"返回个默认体"）：若哪天有人改了
 *    `costProfile`，这个假端点会**立刻**报错，而不是安静地喂一个错误形状的应答，
 *    让 e2e 变成一条"过了但没测到"的假绿。
 *    （代价：这条 e2e 与 `costProfile` 之间存在耦合 —— 这是刻意的，耦合点只有一处且会自曝。）
 *
 * 用法：
 *   node scripts/qa/fake-openai-provider.mjs            # 监听 127.0.0.1:3199
 *   起服务端时带上：
 *     OPENAI_API_KEY=fake-for-e2e \
 *     OPENAI_BASE_URL=http://127.0.0.1:3199/v1 \
 *     DATABASE_URL=file:/tmp/t02-e2e.db npx next dev -p 3099
 */

import http from 'node:http'

const PORT = Number(process.env.FAKE_OPENAI_PORT || '3199')
const HOST = '127.0.0.1'

/** 供 `usage` 归因用的 token 数（AC-20 要求每次调用可归因，缺 usage 会被服务端拒绝）。 */
const USAGE = { prompt_tokens: 120, completion_tokens: 60 }

const INTRO_DRAFT = {
  counterpartLabel: '对方成员',
  draftMessage: '你好，看到你们都在做东南亚渠道，想介绍你们认识一下。',
  // 🔴 必须是输入 `allowedFieldKeys` 的**子集** —— 越界会被 checkConstrained 拒绝（这是被测行为）。
  usedFieldKeys: ['displayName'],
}

const COORDINATION_ADVICE = {
  rationale: '双方都在对接东南亚渠道，互补性强。',
  suggestions: ['先把两人拉到一个群里', '同步各自的渠道清单'],
  // 🔴 必须是输入 `allowedCandidateIds` 的子集。
  candidateIds: [],
}

/** `max_tokens` → 应答体。见文件头的路由说明。 */
const ROUTES = [
  { maxTokens: 1200, skill: 'INTRO_DRAFT', payload: INTRO_DRAFT },
  { maxTokens: 900, skill: 'COORDINATION_ADVICE', payload: COORDINATION_ADVICE },
]

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function fail(res, status, message) {
  json(res, status, { error: { type: 'fake_provider_error', message } })
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !String(req.url).endsWith('/chat/completions')) {
    fail(res, 404, `fake-provider 只服务 POST /v1/chat/completions，收到 ${req.method} ${req.url}`)
    return
  }

  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (err) {
      fail(res, 400, `请求体不是合法 JSON：${err.message}`)
      return
    }

    const maxTokens = body && body.max_tokens
    const route = ROUTES.find((r) => r.maxTokens === maxTokens)
    if (!route) {
      fail(
        res,
        400,
        `未知 max_tokens=${JSON.stringify(maxTokens)} —— 已知：` +
          ROUTES.map((r) => `${r.maxTokens}(${r.skill})`).join(' / ') +
          '。多半是某个技能的 costProfile.estimatedOutputTokens 被改过，请同步本文件的路由表。',
      )
      return
    }

    console.log(`[fake-provider] model=${body.model} max_tokens=${maxTokens} → ${route.skill}`)

    json(res, 200, {
      id: 'chatcmpl-fake-p2e2e',
      object: 'chat.completion',
      model: String(body.model || 'fake'),
      choices: [
        {
          index: 0,
          // finish_reason 必须不是 'length'：那会被服务端判成"半截产出"而拒绝。
          finish_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify(route.payload) },
        },
      ],
      usage: USAGE,
    })
  })
})

server.listen(PORT, HOST, () => {
  console.log(`[fake-provider] 就绪 http://${HOST}:${PORT}/v1/chat/completions`)
  console.log(
    `[fake-provider] 路由：${ROUTES.map((r) => `max_tokens=${r.maxTokens} → ${r.skill}`).join(' · ')}`,
  )
})

// Ctrl-C / SIGTERM 立刻放端口（e2e 反复跑时不会卡在 TIME_WAIT 上）。
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  })
}
