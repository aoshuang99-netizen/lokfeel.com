#!/usr/bin/env node
/**
 * S-03 · 远端证据采集（GitHub Actions + Netlify），只读可复跑
 *
 * 为什么单独成脚本：
 *   "CI 绿了"这句话如果不是从 API 现取，就只是回忆。本脚本把
 *   **确切 SHA** 的每个 job 结论、失败步骤、失败注解（公开仓库可读）
 *   以及 Netlify 的 published deploy id 一并落盘，供审批包引用。
 *
 * 只读：GitHub 全是 GET；Netlify 只 GET /sites 与 /deploys。不触发构建、不改配置。
 *
 * 用法:
 *   node scripts/qa/s03-remote-evidence.mjs --sha=<40位> --branch=rc/hotfix-checkout-safety --out=<path>
 */

import { readFileSync, writeFileSync } from 'node:fs'

const arg = (name, fallback) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}

const OWNER = 'aoshuang99-netizen'
const REPO = 'lokfeel.com'
const SITE_ID = 'c46478e9-7ac8-4bcf-9052-7638b04fef83'

const GH = 'https://api.github.com'
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'lokfeel-s03-evidence' }

async function gh(path) {
  const res = await fetch(`${GH}${path}`, { headers, signal: AbortSignal.timeout(25000) })
  if (!res.ok) return { httpStatus: res.status, error: (await res.text()).slice(0, 200) }
  return { httpStatus: res.status, json: await res.json() }
}

function netlifyToken() {
  for (const f of ['.env.local', '.env']) {
    try {
      const m = readFileSync(f, 'utf8').match(/^NETLIFY_AUTH_TOKEN=(.*)$/m)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    } catch {
      /* 文件不存在就跳过 */
    }
  }
  return null
}

async function main() {
  const sha = arg('sha', '')
  const branch = arg('branch', 'main')
  const out = arg('out', '')
  const result = { checkedAt: new Date().toISOString(), readOnly: true, sha, branch }

  const runs = await gh(`/repos/${OWNER}/${REPO}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=20`)
  const run = (runs.json?.workflow_runs || []).find((r) => r.head_sha === sha && r.name === 'CI')
  if (!run) {
    result.ci = { found: false, note: '未找到该 SHA 的 CI run（可能仍在排队或分支名不符）' }
  } else {
    const jobsRes = await gh(`/repos/${OWNER}/${REPO}/actions/runs/${run.id}/jobs?per_page=100`)
    const jobs = (jobsRes.json?.jobs || []).map((j) => ({
      name: j.name,
      status: j.status,
      conclusion: j.conclusion,
      failedSteps: (j.steps || []).filter((s) => s.conclusion === 'failure').map((s) => s.name),
    }))
    const failures = jobs.filter((j) => j.conclusion === 'failure')

    // 公开仓库的 check-run 注解含断言原文，比日志更直接（日志 API 需管理员权限）
    const annotations = []
    for (const j of failures) {
      const cr = await gh(`/repos/${OWNER}/${REPO}/commits/${sha}/check-runs?per_page=50`)
      const hit = (cr.json?.check_runs || []).find((c) => c.name === j.name && c.conclusion === 'failure')
      if (!hit) continue
      const ann = await gh(`/repos/${OWNER}/${REPO}/check-runs/${hit.id}/annotations`)
      for (const a of ann.json || []) {
        annotations.push({ job: j.name, title: a.title, message: String(a.message || '').slice(0, 500) })
      }
    }

    result.ci = {
      found: true,
      runId: run.id,
      status: run.status,
      conclusion: run.conclusion,
      htmlUrl: run.html_url,
      jobCount: jobs.length,
      passed: jobs.filter((j) => j.conclusion === 'success').length,
      failed: failures.length,
      skipped: jobs.filter((j) => j.conclusion === 'skipped').length,
      failures,
      annotations,
    }
  }

  const token = netlifyToken()
  if (!token) {
    result.netlify = { available: false, note: 'NETLIFY_AUTH_TOKEN 不在 .env/.env.local' }
  } else {
    const siteRes = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(25000),
    })
    const site = await siteRes.json()
    const depRes = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys?per_page=20`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(25000),
    })
    const deploys = await depRes.json()
    result.netlify = {
      available: true,
      siteId: SITE_ID,
      allowedBranches: site.build_settings?.allowed_branches ?? null,
      productionDeploy: site.published_deploy
        ? {
            id: site.published_deploy.id,
            commitRef: site.published_deploy.commit_ref,
            state: site.published_deploy.state,
          }
        : null,
      branchDeploys: Array.isArray(deploys)
        ? deploys
            .filter((d) => d.branch === branch || d.context === 'deploy-preview')
            .slice(0, 5)
            .map((d) => ({ id: d.id, state: d.state, context: d.context, branch: d.branch, commitRef: d.commit_ref }))
        : [],
    }
  }

  const printed = JSON.stringify(result, null, 2)
  process.stdout.write(`${printed}\n`)
  if (out) writeFileSync(out, `${printed}\n`, 'utf8')
  process.exitCode = result.ci?.found ? 0 : 1
}

main()
