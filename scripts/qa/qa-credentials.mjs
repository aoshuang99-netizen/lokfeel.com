/**
 * QA 凭据解析（单一入口）
 *
 * ⚠️ 本仓库是 **public**：测试账号密码**绝不入库**。
 *
 * 解析顺序：
 *   1. 环境变量 `QA_PASSWORD`
 *   2. 本地文件 `nexus-app/.qa-credentials.local.json`（已在 .gitignore 中）
 *
 * 用法：
 *   QA_PASSWORD='...' node scripts/qa/verify-login.mjs
 *   或先写一次本地文件（推荐，后续无需每次带环境变量）：
 *   echo '{"password":"..."}' > .qa-credentials.local.json
 */
import fs from 'node:fs'
import path from 'node:path'

const LOCAL_FILE = path.resolve(import.meta.dirname, '../../.qa-credentials.local.json')

function resolvePassword() {
  if (process.env.QA_PASSWORD) return process.env.QA_PASSWORD
  if (fs.existsSync(LOCAL_FILE)) {
    try {
      const j = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'))
      if (j && typeof j.password === 'string' && j.password) return j.password
    } catch {
      /* 落到下面的报错 */
    }
  }
  throw new Error(
    [
      '未找到 QA 测试账号密码。请任选其一：',
      "  1) QA_PASSWORD='...' node <script>",
      `  2) echo '{"password":"..."}' > ${path.relative(process.cwd(), LOCAL_FILE)}`,
      '（该文件已在 .gitignore 中，不会被提交）',
    ].join('\n'),
  )
}

export const QA_PASSWORD = resolvePassword()
export const QA_MALE_EMAIL = process.env.QA_MALE_EMAIL || 'qa.male@lokfeel.com'
export const QA_FEMALE_EMAIL = process.env.QA_FEMALE_EMAIL || 'qa.female@lokfeel.com'
export const QA_MALE_ID = process.env.QA_MALE_ID || 'dade3176-a40f-4fe4-8ea3-a5fa368e85c0'
export const QA_FEMALE_ID = process.env.QA_FEMALE_ID || '8ea3bebc-fe58-442b-b679-43fc3286d383'
export const QA_CONVERSATION_ID = process.env.QA_CONVERSATION_ID || 'cmupjcwau000109l7dcc8avag'
