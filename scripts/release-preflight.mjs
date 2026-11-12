#!/usr/bin/env node
// LokFeel read-only production risk probe. No POST/PATCH/DELETE, no credentials.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

export function classifyPlans(plans, remoteSha) {
  if (!plans || typeof plans !== 'object' || Array.isArray(plans)) return { verdict: 'ERROR', reason: 'plans_json_invalid' };
  if (typeof plans.checkoutReady !== 'boolean') return { verdict: 'ERROR', reason: 'checkoutReady_missing' };
  for (const key of ['environment', 'catalogVersion']) {
    if (typeof plans[key] !== 'string' || !plans[key].trim()) return { verdict: 'ERROR', reason: `${key}_missing` };
  }
  if (!Object.hasOwn(plans, 'approvedAt')) return { verdict: 'ERROR', reason: 'approvedAt_missing' };
  if (!/^[a-f\d]{40}$/.test(remoteSha)) return { verdict: 'ERROR', reason: 'remote_sha_missing' };
  if (plans.checkoutReady && plans.environment === 'live_mode') {
    return { verdict: 'RISK_OPEN', reason: 'live_checkout_enabled_verify_human_approval_and_R15_production_fix' };
  }
  return { verdict: 'CLOSED', reason: 'no_live_checkout_enabled' };
}

function arg(name, fallback) {
  const v = process.argv.slice(2).find(x => x.startsWith(`--${name}=`));
  return v ? v.slice(name.length + 3) : fallback;
}

async function getJSON(base, pathname) {
  const u = new URL(pathname, base);
  if (u.protocol !== 'https:') throw new Error(`HTTPS required: ${u.origin}`);
  const resp = await fetch(u, { method:'GET', redirect:'error', signal:AbortSignal.timeout(12000), cache:'no-store' });
  if (!resp.ok) throw new Error(`${pathname}: HTTP ${resp.status}`);
  const data = await resp.json();
  return { data, httpStatus:resp.status, url:u.toString() };
}

async function main() {
  const base = arg('base', 'https://app.lokfeel.com');
  const outfile = arg('out', '');
  const result = { checkedAt:new Date().toISOString(), base, readOnly:true, verdict:'ERROR', checks:{}, reasons:[] };
  try {
    const [health, plans] = await Promise.all([getJSON(base,'/api/health'), getJSON(base,'/api/payments/dodo/plans')]);
    const raw = execFileSync('git', ['ls-remote','origin','refs/heads/main'], {encoding:'utf8', timeout:15000}).trim();
    const remoteSha = raw.split(/\s+/)[0];
    const productionCommit = health.data?.commit;
    result.checks = {
      health: {httpStatus:health.httpStatus, status:health.data?.status, commit:productionCommit},
      plans: {httpStatus:plans.httpStatus, environment:plans.data?.environment, checkoutReady:plans.data?.checkoutReady,
        approvedAt:plans.data?.approvedAt ?? null, catalogVersion:plans.data?.catalogVersion},
      git: {remoteMainSha:remoteSha}
    };
    if (health.data?.status !== 'healthy' || typeof productionCommit !== 'string' || !productionCommit.trim()) {
      result.verdict = 'ERROR'; result.reasons.push('health_status_or_commit_invalid');
    } else {
      const c = classifyPlans(plans.data, remoteSha);
      result.verdict = c.verdict; result.reasons.push(c.reason);
    }
  } catch (e) {
    result.verdict = 'ERROR'; result.reasons.push(String(e?.message ?? e));
  }
  if (outfile) await writeFile(outfile, JSON.stringify(result,null,2)+'\n', {encoding:'utf8'});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  process.exitCode = result.verdict === 'CLOSED' ? 0 : result.verdict === 'RISK_OPEN' ? 2 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
