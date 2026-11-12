#!/usr/bin/env node
// Advisory fail-closed validation of manifest shape. Not a substitute for independent approval verification.
import { readFileSync } from 'node:fs';
const path = process.argv[2] || 'release-manifest.json';
const report = {file:path, verdict:'NO_GO', errors:[]};
let manifest;
try { manifest=JSON.parse(readFileSync(path,'utf8')); }
catch(e) {report.errors.push(`cannot_read_parse:${e.message}`);}
if(manifest) {
  const validSha = x=>typeof x==='string' && /^[0-9a-f]{40}$/.test(x);
  if (!validSha(manifest.rcSha)) report.errors.push('missing_or_invalid_full_rcSha');
  if (!String(manifest.productionBeforeDeployId||'').trim() || String(manifest.productionBeforeDeployId).includes('REPLACE')) report.errors.push('missing_rollback_deploy');
  for(let i=0;i<=12;i++) {
    if (manifest.gates?.[`G${i}`] !== 'PASS') report.errors.push(`G${i}_not_PASS`);
    if (!manifest.evidence?.[`G${i}`]) report.errors.push(`G${i}_missing_evidence`);
  }
  if(manifest.gates?.G13!=='N/A') report.errors.push('G13_must_be_NA_before_deploy');
  for(let i=1;i<=8;i++) if (!manifest.humanDecisions?.[`D${i}`]?.approvalEvidence) report.errors.push(`D${i}_approval_evidence_missing`);
  if(manifest.status!=='READY_FOR_APPROVAL') report.errors.push('not_READY_FOR_APPROVAL');
  if(manifest.releaseAuthorization?.approvedRcSha !== manifest.rcSha) report.errors.push('specific_rcSha_not_authorized');
  if(!manifest.releaseAuthorization?.approvalEvidence) report.errors.push('release_authorization_evidence_missing');
  if(manifest.rollback?.dryRunVerified!==true || manifest.rollback?.dataCompatibilityVerified!==true) report.errors.push('rollback_not_verified');
}
if(report.errors.length===0)report.verdict='METADATA_READY_FOR_HUMAN_REVIEW';
console.log(JSON.stringify(report,null,2));
process.exitCode=report.errors.length ? 1:0;
