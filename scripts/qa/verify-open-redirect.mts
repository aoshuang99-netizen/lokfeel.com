/**
 * 用**真实** isSafeRedirect 模块验证开放重定向（非复现实现）
 * 用法: node_modules/.bin/tsx scripts/qa/verify-open-redirect.mts
 */
import { isSafeRedirect } from '../../src/lib/auth/safe-redirect'

const BASE = 'https://app.lokfeel.com'

const cases: Array<[string, string]> = [
  ['/dashboard', '正常相对路径'],
  ['//evil.com', '协议相对（应被拦）'],
  ['/\\evil.com', '★反斜杠同义变体'],
  ['/\\\\evil.com', '双反斜杠'],
  ['/\\/evil.com', '混合斜杠'],
  ['/%2F%2Fevil.com', 'URL 编码斜杠'],
  ['https://app.lokfeel.com/x', '白名单内绝对 URL'],
  ['https://evil.com/', '白名单外绝对 URL（应被拦）'],
]

console.log('输入'.padEnd(26) + 'safe?'.padEnd(8) + '实际跳转目标')
let vulnerable = 0
for (const [input, desc] of cases) {
  const safe = isSafeRedirect(input)
  let dest = ''
  try { dest = new URL(input, BASE).href } catch { dest = '(解析失败)' }
  const escaped = safe && !dest.startsWith(BASE + '/') && dest !== BASE
  if (escaped) vulnerable++
  console.log(
    JSON.stringify(input).padEnd(26) +
    String(safe).padEnd(8) +
    dest +
    (escaped ? `   ⚠️ 放行但跳出主域  「${desc}」` : `   「${desc}」`)
  )
}
console.log(`\n可绕过的输入数: ${vulnerable}`)
