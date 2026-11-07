/**
 * QA 凭据解析（单一入口）
 *
 * ⚠️ 本仓库是 **public**：任何账号密码**绝不入库**。
 *
 * 为什么要有这个模块：2026-11-07 发现 ``<产品名>@<年份>!` 形态的管理员密码` 以字面量形式散落在 5 个
 * 源文件中，并已进入 6 个历史提交。仓库是 public ⇒ 任何人可直接登录生产 SUPER_ADMIN。
 * 当时的写法是 `process.env.X || '<字面量>'` —— 这个 `||` 是最危险的一行：它让
 * "忘了配环境变量"从**可见的失败**变成一个**静默降级到已知泄漏密码**。
 * 所以这里的原则是：**拿不到就抛，绝不返回默认值**。
 *
 * 解析顺序（同名键，先环境变量后本地文件）：
 *   1. 环境变量 `QA_PASSWORD` / `ADMIN_PASSWORD` / `<NAME>_PASSWORD`
 *   2. 本地文件 `nexus-app/.qa-credentials.local.json`（.gitignore 第 93 行）
 *      对应键：`password`（QA 账号）/ `adminPassword`（运维管理员）
 */
import fs from 'node:fs'
import path from 'node:path'

const LOCAL_FILE = path.resolve(import.meta.dirname, '../../.qa-credentials.local.json')

const REL_LOCAL = path.relative(process.cwd(), LOCAL_FILE)

/** 读取本地凭据文件；不存在或损坏返回空对象（调用方负责报错）。 */
function readLocal() {
  if (!fs.existsSync(LOCAL_FILE)) return {}
  try {
    const j = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

/**
 * 取一个凭据。找不到就抛 —— 错误信息里给出**两条**可行路径，而不是给一个能跑起来的默认值。
 *
 * @param {string} envKey   环境变量名
 * @param {string} fileKey  本地文件键名
 * @param {string} what     人类可读的用途（出现在报错里）
 */
export function requireCredential(envKey, fileKey, what) {
  const fromEnv = process.env[envKey]
  if (fromEnv) return fromEnv

  const local = readLocal()
  if (typeof local[fileKey] === 'string' && local[fileKey]) return local[fileKey]

  throw new Error(
    [
      `未找到${what}凭据（环境变量 ${envKey} / 本地键 ${fileKey}）。请任选其一：`,
      `  1) ${envKey}='...' node <script>`,
      `  2) 在 ${REL_LOCAL} 里写 {"${fileKey}":"..."}`,
      '（该文件已在 .gitignore 中；不要把它提交，也不要贴到聊天/报告里）',
    ].join('\n'),
  )
}

function resolvePassword() {
  return requireCredential('QA_PASSWORD', 'password', ' QA 测试账号')
}

export const QA_PASSWORD = resolvePassword()
export const QA_MALE_EMAIL = process.env.QA_MALE_EMAIL || 'qa.male@lokfeel.com'
export const QA_FEMALE_EMAIL = process.env.QA_FEMALE_EMAIL || 'qa.female@lokfeel.com'
export const QA_MALE_ID = process.env.QA_MALE_ID || 'dade3176-a40f-4fe4-8ea3-a5fa368e85c0'
export const QA_FEMALE_ID = process.env.QA_FEMALE_ID || '8ea3bebc-fe58-442b-b679-43fc3286d383'
export const QA_CONVERSATION_ID = process.env.QA_CONVERSATION_ID || 'cmupjcwau000109l7dcc8avag'

/** 运维管理员（SUPER_ADMIN）账号——与 QA 人格**分属不同账号**，不要混用。 */
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@lokfeel.com'
export function getAdminPassword() {
  return requireCredential('ADMIN_PASSWORD', 'adminPassword', '运维管理员')
}
