/**
 * P1-a 端到端验证：开放重定向修复
 *
 * 走**真实凭据登录接口** /api/auth/login —— 它与三个 OAuth 回调共用同一个
 * isSafeRedirect 守卫，因此一次真实登录即可证明"恶意 callbackUrl 不再被采纳"。
 *
 * 用法: node scripts/qa/verify-open-redirect-e2e.mjs   （需本地 dev server 于 :3099）
 */
const B = process.env.QA_BASE_URL || 'http://localhost:3099'
const EMAIL = process.env.QA_MALE_EMAIL || 'qa.male@lokfeel.com'
// 凭据统一从 scripts/qa/qa-credentials.mjs 解析（public 仓库不入库）
import { QA_PASSWORD } from './qa-credentials.mjs'
const PASSWORD = QA_PASSWORD

let pass = 0
let fail = 0
const ck = (label, ok, extra = '') => {
  if (ok) {
    pass++
    console.log(`  ✅ ${label}${extra ? '  ' + extra : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${label}${extra ? '  ' + extra : ''}`)
  }
}

async function login(callbackUrl) {
  const res = await fetch(`${B}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: B },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, callbackUrl }),
  })
  const text = await res.text()
  try {
    const d = JSON.parse(text)
    return d.redirectUrl ?? `ERR(${res.status}): ${d.error}`
  } catch {
    return `NON-JSON(${res.status}): ${text.slice(0, 80)}`
  }
}

console.log('════════ 阴性对照：正常 callbackUrl 应被采纳 ════════')
const good = await login('/dashboard/chats')
console.log(`  callbackUrl=/dashboard/chats  →  redirectUrl=${good}`)
ck('正常相对路径原样放行', good === '/dashboard/chats')

console.log('\n════════ 攻击载荷：修复前会被采纳并跳到外域 ════════')
const payloads = ['/\\evil.com', '/\\\\evil.com', '/\\/evil.com', '//evil.com', 'https://evil.com/']
for (const p of payloads) {
  const got = await login(p)
  console.log(`  callbackUrl=${JSON.stringify(p)}  →  redirectUrl=${got}`)
  ck(`已拦截 ${JSON.stringify(p)}`, got === '/dashboard', got === '/dashboard' ? '' : `实际=${got}`)
}

console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 ════════`)
process.exit(fail === 0 ? 0 : 1)
