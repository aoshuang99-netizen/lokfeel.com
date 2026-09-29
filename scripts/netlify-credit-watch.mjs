#!/usr/bin/env node
/**
 * Netlify 额度看门狗 —— D1 的等效兜底
 *
 * 为什么需要它：
 *   Netlify 的 `auto_topup_enabled` 与 `credit_alert_percentage` **无法通过 API 写入**
 *   （2026-09-29 实测：PATCH/PUT 均返回 200 但值不变；布尔/字符串/数字三种取值都被静默忽略；
 *   完整对象 PUT 返回 422；/billing、/credits、/auto_topup 等候选端点全 404）。
 *   即：官方额度告警只能在控制台 UI 开，而**额度耗尽会导致整站 503**（2026-09-29 真实事故）。
 *
 *   既然官方告警开关写不进去，就自己轮询账号额度，在耗尽前把风险暴露出来。
 *   这个脚本只读、不改动任何东西，可安全地反复运行。
 *
 * 用法：
 *   NETLIFY_AUTH_TOKEN=nfp_xxx npm run netlify:credits
 *
 * 退出码（便于接进 CI / 定时任务）：
 *   0 = 正常    1 = 告警（用量 ≥ 阈值）    2 = 危急 / 已停机
 *
 * ⚠️ 本仓库是 public：**绝不**把 token 写进代码或提交。只从环境变量读取。
 */

const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
const ACCOUNT = process.env.NETLIFY_ACCOUNT_SLUG || 'aoshuang99';

// 阈值可调：告警线 80%，危急线 95%
const WARN_PCT = Number(process.env.CREDIT_WARN_PCT || 80);
const CRIT_PCT = Number(process.env.CREDIT_CRIT_PCT || 95);

const API = 'https://api.netlify.com/api/v1';

if (!TOKEN) {
  console.error('缺少 NETLIFY_AUTH_TOKEN 环境变量。');
  console.error('用法：NETLIFY_AUTH_TOKEN=nfp_xxx npm run netlify:credits');
  process.exit(2);
}

const line = (n = 62) => console.log('─'.repeat(n));

async function main() {
  const res = await fetch(`${API}/accounts/${ACCOUNT}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    console.error(`查询账户失败：HTTP ${res.status} ${res.statusText}`);
    process.exit(2);
  }
  const acc = await res.json();

  const credits = (acc.capabilities && acc.capabilities.credits) || {};
  const included = Number(credits.included ?? acc.plan_credits ?? 0);
  const used = Number(credits.used ?? 0);
  const pct = included > 0 ? (used / included) * 100 : 0;

  const autoTopup = acc.auto_topup_enabled === true;
  const alertPct = acc.credit_alert_percentage;
  const lifecycle = acc.lifecycle_state;
  const exceeded = Array.isArray(acc.usages_exceeded) ? acc.usages_exceeded : [];
  const sitesExceeded = Array.isArray(acc.sites_with_usage_exceeded) ? acc.sites_with_usage_exceeded : [];

  console.log('');
  line();
  console.log('Netlify 额度看门狗  ·  账户 ' + ACCOUNT);
  line();
  console.log('  周期          ' + (acc.current_billing_period_start || '?') + '  →  ' + (acc.next_billing_period_start || '?'));
  console.log('  额度          ' + used + ' / ' + included + ' credits  （已用 ' + pct.toFixed(1) + '%）');
  console.log('  周期结束前剩余 ' + Math.max(0, included - used) + ' credits');
  console.log('  账号状态      ' + lifecycle);
  console.log('  自动充值      ' + (autoTopup ? '已开启 ✅' : '**未开启 ❌**'));
  console.log('  额度告警阈值  ' + (alertPct == null ? '未设置（非必需）' : alertPct + '%'));
  console.log('  已绑支付方式  ' + (acc.has_stripe_payment_method ? '是 ✅' : '否（自动充值无法生效）'));
  if (acc.plan_auto_topup_amount) {
    const amt = Number(acc.plan_auto_topup_amount);
    const unit = Number(acc.plan_auto_topup_per_unit_cost || 0);
    console.log('  充值配置      每次 ' + amt + ' credits @ $' + unit + ' = $' + (amt * unit).toFixed(2));
  }
  line();

  const problems = [];
  const warn = [];

  // 1) 是否已经停机（优先级最高）
  if (lifecycle && lifecycle !== 'active') {
    problems.push(`账号状态为 "${lifecycle}"，非 active —— 站点可能已受影响`);
  }
  if (exceeded.length > 0) {
    problems.push(`usages_exceeded 非空：${JSON.stringify(exceeded)}`);
  }
  if (sitesExceeded.length > 0) {
    problems.push(`有站点超限：${sitesExceeded.join(', ')}`);
  }

  // 2) 用量阈值
  if (pct >= CRIT_PCT) {
    problems.push(`额度已用 ${pct.toFixed(1)}%（≥ ${CRIT_PCT}% 危急线），即将耗尽`);
  } else if (pct >= WARN_PCT) {
    warn.push(`额度已用 ${pct.toFixed(1)}%（≥ ${WARN_PCT}% 告警线）`);
  }

  // 3) D1 根因本身
  if (!autoTopup) {
    warn.push('auto_topup_enabled = false —— 额度一旦耗尽会**整站 503**（2026-09-29 已发生过）');
  }
  // credit_alert_percentage 只是"自定义阈值"字段：Netlify 在 50/75/100% 本就自动通知，
  // 且本脚本每日巡检就是告警机制 —— 未设置只提示，不作为告警（2026-09-29 D1 完成后调整）。
  if (alertPct == null) {
    console.log('  （提示：credit_alert_percentage 未设置自定义阈值 —— 非必需，官方 50/75/100% 自动通知 + 本脚本巡检已覆盖）');
  }
  // 当前凭证对应角色：非 Owner 则无法自行开启 auto recharge
  if (String(acc.role).toLowerCase() !== 'owner') {
    warn.push(`当前凭证角色为 "${acc.role}"，非 Owner —— 无法自行开启 auto recharge，需 Owner 操作`);
  }

  if (problems.length) {
    console.log('');
    console.log('🔴 危急');
    problems.forEach((p) => console.log('   · ' + p));
  }
  if (warn.length) {
    console.log('');
    console.log('🟡 告警');
    warn.forEach((w) => console.log('   · ' + w));
  }
  if (!problems.length && !warn.length) {
    console.log('');
    console.log('🟢 正常：额度充裕且自动充值/告警均已就绪。');
  }

  if (warn.length && !problems.length) {
    console.log('');
    line();
    console.log('修复路径（**只能在控制台 UI 完成**，API 写不进）：');
    console.log('');
    console.log('  Netlify 官方把这个功能叫作 "credit auto recharge"。');
    console.log('  1. 打开 Team dashboard（Team: ' + (acc.name || ACCOUNT) + '）');
    console.log('  2. 进入 「Usage & billing」');
    console.log('  3. 在 「Current services」/「Credit balance」区块里选 「Configure auto recharge」');
    console.log('  4. 选 「Enabled」并确认');
    console.log('');
    console.log('  仅 Team Owner 可操作 —— 当前角色: ' + (acc.role || '未知') +
                (String(acc.role).toLowerCase() === 'owner' ? ' ✅' : ' ❌（需 Owner 操作）'));
    console.log('  本账户已绑卡: ' + (acc.has_stripe_payment_method ? '是 ✅' : '否 ❌（必须先绑卡）'));
    console.log('  官方文档: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/configure-auto-recharge/');
    console.log('');
    console.log('  补充（官方行为，勿误判）:');
    console.log('   · Personal 档费率固定 500 credits / $5 —— 与本账户 plan_auto_topup_* 一致');
    console.log('   · **免费档不支持 auto recharge**；Personal/Pro 才可开');
    console.log('   · 额度耗尽时**该 team 下所有项目一起被暂停**（不只是占满额度的那个），');
    console.log('     访客会看到 "Site not available"，且所有部署（含 Deploy Preview / 分支部署）停摆');
    console.log('   · Netlify 在用量 50% / 75% / 100% 时会自动发邮件+站内通知；');
    console.log('     但 credit_alert_percentage 是**另一个**可自定义阈值的字段（当前未设）');
    line();
  }

  const code = problems.length ? 2 : warn.length ? 1 : 0;
  console.log('');
  console.log(`退出码 ${code}（0=正常 1=告警 2=危急）`);
  process.exit(code);
}

main().catch((e) => {
  console.error('看门狗异常：', e.message);
  process.exit(2);
});
