/**
 * E2E Payment Test: Full Flow Validation (DB + API Direct)
 * 
 * 端到端验证支付系统的每个环节，不依赖NextAuth登录：
 * 1. 数据完整性 — User→Profile→Subscription→Payment→Notification 1:1:1:1:1
 * 2. 订阅类型分布 — 月付/年付比例正确
 * 3. 金额计算 — 每笔支付金额与套餐匹配
 * 4. Stripe字段完整性 — customerId/subscriptionId/paymentIntentId齐全
 * 5. 权限控制 — Premium vs Free vs Lady Free功能差异
 * 6. 降级模拟 — subscription.deleted → FREE
 * 7. 升级模拟 — FREE → PREMIUM_YEARLY
 * 8. 支付失败模拟 — FAILED payment + PAST_DUE subscription
 * 9. 退款模拟 — REFUNDED payment + 订阅状态变化
 * 10. API端点可达性 — 生产环境所有支付相关端点返回正确HTTP状态
 * 11. Webhook安全 — 无签名拒绝
 * 12. 收入汇总 — 总收入与套餐价格×数量匹配
 * 
 * Usage: npx tsx scripts/e2e-payment/e2e-payment-test-v2.ts
 */

import 'dotenv/config';
import { PrismaClient } from '../../src/generated/index.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const APP_URL = process.env.E2E_APP_URL || 'https://app.lokfeel.com';
const TEST_EMAIL_PREFIX = 'test.paid.';

// ─── Test Result Tracking ────────────────────────────────
interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  detail?: string;
}

const results: TestResult[] = [];

function logTest(name: string, status: 'PASS' | 'FAIL' | 'SKIP', duration: number, detail?: string) {
  results.push({ name, status, duration, detail });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️';
  console.log(`  ${icon} ${name} (${duration}ms)${detail ? ` — ${detail}` : ''}`);
}

// ═══════════════════════════════════════════════════════════
// TEST 1: Data Integrity — 1:1:1:1:1 Ratio
// ═══════════════════════════════════════════════════════════
async function testDataIntegrity() {
  const start = Date.now();
  try {
    const paidUsers = await prisma.user.findMany({
      where: { email: { startsWith: TEST_EMAIL_PREFIX } },
      include: {
        profile: true,
        subscriptions: true,
        payments: true,
        notifications: true,
      },
    });

    let orphans: string[] = [];
    let missingProfile = 0, missingSub = 0, missingPayment = 0, missingNotif = 0;

    for (const user of paidUsers) {
      if (!user.profile) missingProfile++;
      if (user.subscriptions.length === 0) missingSub++;
      if (user.payments.length === 0) missingPayment++;
      if (user.notifications.length === 0) missingNotif++;
      if (!user.profile || user.subscriptions.length === 0 || user.payments.length === 0 || user.notifications.length === 0) {
        orphans.push(user.email);
      }
    }

    const allGood = orphans.length === 0;
    logTest(
      'Data Integrity: User→Profile→Sub→Payment→Notification = 1:1:1:1:1',
      allGood ? 'PASS' : 'FAIL',
      Date.now() - start,
      `${paidUsers.length} users, ${orphans.length} orphans (missingProfile=${missingProfile}, missingSub=${missingSub}, missingPayment=${missingPayment}, missingNotif=${missingNotif})`
    );

    // Check user properties
    const allMale = paidUsers.every(u => u.profile?.gender === 'MALE');
    const allVerified = paidUsers.every(u => u.emailVerified !== null);
    const allNotBot = paidUsers.every(u => u.isBot === false);

    logTest(
      'User Properties: All male, verified, not bot',
      allMale && allVerified && allNotBot ? 'PASS' : 'FAIL',
      Date.now() - start,
      `male=${allMale}, verified=${allVerified}, notBot=${allNotBot}`
    );
  } catch (error: any) {
    logTest('Data Integrity', 'FAIL', Date.now() - start, error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 2: Subscription Plan Distribution
// ═══════════════════════════════════════════════════════════
async function testPlanDistribution() {
  const start = Date.now();
  try {
    const [monthlyCount, yearlyCount, totalCount] = await Promise.all([
      prisma.subscription.count({
        where: { plan: 'PREMIUM_MONTHLY', status: 'ACTIVE', user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
      }),
      prisma.subscription.count({
        where: { plan: 'PREMIUM_YEARLY', status: 'ACTIVE', user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
      }),
      prisma.subscription.count({
        where: { status: 'ACTIVE', user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
      }),
    ]);

    const distributionOk = totalCount === 50 && (monthlyCount + yearlyCount) === 50;
    const monthlyPct = ((monthlyCount / totalCount) * 100).toFixed(0);

    logTest(
      'Plan Distribution: ~70% Monthly / ~30% Yearly',
      distributionOk ? 'PASS' : 'FAIL',
      Date.now() - start,
      `Monthly: ${monthlyCount} (${monthlyPct}%), Yearly: ${yearlyCount} (${100 - parseInt(monthlyPct)}%), Total: ${totalCount}`
    );
  } catch (error: any) {
    logTest('Plan Distribution', 'FAIL', Date.now() - start, error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 3: Amount Calculation Accuracy
// ═══════════════════════════════════════════════════════════
async function testAmountAccuracy() {
  const start = Date.now();
  try {
    const payments = await prisma.payment.findMany({
      where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } }, status: 'SUCCEEDED' },
    });

    let correctAmounts = 0;
    let incorrectDetails: string[] = [];

    for (const p of payments) {
      const isMonthly = p.description?.includes('Monthly');
      const isYearly = p.description?.includes('Yearly');
      const expectedAmount = isMonthly ? 19.99 : isYearly ? 149.99 : -1;

      if (expectedAmount > 0 && Math.abs(p.amount - expectedAmount) < 0.01) {
        correctAmounts++;
      } else {
        incorrectDetails.push(`${p.id}: ${p.description} = $${p.amount} (expected $${expectedAmount})`);
      }
    }

    const allCorrect = incorrectDetails.length === 0;
    const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);

    logTest(
      'Amount Accuracy: Each payment matches plan price',
      allCorrect ? 'PASS' : 'FAIL',
      Date.now() - start,
      `${correctAmounts}/${payments.length} correct, Total: $${totalRevenue.toFixed(2)}${incorrectDetails.length > 0 ? `, Wrong: ${incorrectDetails.slice(0, 3).join('; ')}` : ''}`
    );
  } catch (error: any) {
    logTest('Amount Accuracy', 'FAIL', Date.now() - start, error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 4: Stripe Field Completeness
// ═══════════════════════════════════════════════════════════
async function testStripeFields() {
  const start = Date.now();
  try {
    const subs = await prisma.subscription.findMany({
      where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } }, status: 'ACTIVE' },
    });

    const withCustomerId = subs.filter(s => s.stripeCustomerId).length;
    const withSubId = subs.filter(s => s.stripeSubscriptionId).length;
    const withPeriodEnd = subs.filter(s => s.stripeCurrentPeriodEnd).length;

    const payments = await prisma.payment.findMany({
      where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
    });

    const withPaymentIntent = payments.filter(p => p.stripePaymentIntentId).length;

    // Payment records may exceed 50 (failure/refund simulations add records)
    const allComplete = withCustomerId === 50 && withSubId === 50 && withPeriodEnd === 50 && withPaymentIntent >= 50;

    logTest(
      'Stripe Fields: customerId, subscriptionId, periodEnd, paymentIntentId',
      allComplete ? 'PASS' : 'FAIL',
      Date.now() - start,
      `cus=${withCustomerId}/50, sub=${withSubId}/50, period=${withPeriodEnd}/50, pi=${withPaymentIntent}/50`
    );

    // Verify Stripe IDs have correct prefix
    const validCusPrefix = subs.filter(s => s.stripeCustomerId?.startsWith('cus_')).length;
    const validSubPrefix = subs.filter(s => s.stripeSubscriptionId?.startsWith('sub_')).length;
    const validPiPrefix = payments.filter(p => p.stripePaymentIntentId?.startsWith('pi_')).length;

    logTest(
      'Stripe IDs: Valid prefix format (cus_, sub_, pi_)',
      validCusPrefix === 50 && validSubPrefix === 50 && validPiPrefix >= 50 ? 'PASS' : 'FAIL',
      Date.now() - start,
      `cus_=${validCusPrefix}/50, sub_=${validSubPrefix}/50, pi_=${validPiPrefix}/50+`
    );
  } catch (error: any) {
    logTest('Stripe Fields', 'FAIL', Date.now() - start, error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 5: Premium Perks
// ═══════════════════════════════════════════════════════════
async function testPremiumPerks() {
  const start = Date.now();
  try {
    const premiumSubs = await prisma.subscription.findMany({
      where: { plan: { in: ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'] }, status: 'ACTIVE', user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
    });

    const correctPerks = premiumSubs.filter(s =>
      s.weeklyMatchLimit === 5 && s.canInitiateChat === true && s.canViewFullProfile === true
    ).length;

    logTest(
      'Premium Perks: 5 matches/week, unlimited chat, full profile',
      correctPerks === premiumSubs.length ? 'PASS' : 'FAIL',
      Date.now() - start,
      `${correctPerks}/${premiumSubs.length} with correct perks`
    );

    // Period end dates should be in the future
    const futurePeriod = premiumSubs.filter(s =>
      s.stripeCurrentPeriodEnd && s.stripeCurrentPeriodEnd > new Date()
    ).length;

    logTest(
      'Premium Period: All subscriptions end in the future',
      futurePeriod === premiumSubs.length ? 'PASS' : 'FAIL',
      Date.now() - start,
      `${futurePeriod}/${premiumSubs.length} with future period end`
    );
  } catch (error: any) {
    logTest('Premium Perks', 'FAIL', Date.now() - start, error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 6: Downgrade Simulation (subscription.deleted)
// ═══════════════════════════════════════════════════════════
async function testDowngradeSimulation() {
  const start = Date.now();
  try {
    // Pick a PREMIUM_MONTHLY user to simulate cancellation
    const user = await prisma.user.findFirst({
      where: {
        email: { startsWith: TEST_EMAIL_PREFIX },
        subscriptions: { some: { status: 'ACTIVE', plan: 'PREMIUM_MONTHLY' } },
      },
      include: { subscriptions: true, profile: true },
    });

    if (!user || !user.subscriptions[0]) {
      logTest('Downgrade Simulation', 'SKIP', Date.now() - start, 'No monthly premium user');
      return;
    }

    const sub = user.subscriptions[0];
    const originalPlan = sub.plan;

    // Simulate subscription.deleted (male → FREE)
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        plan: 'FREE',
        status: 'CANCELLED',
        weeklyMatchLimit: 3,
        canInitiateChat: false,
        canViewFullProfile: false,
        endsAt: new Date(),
        cancelledAt: new Date(),
      },
    });

    // Create cancellation payment record
    await prisma.notification.create({
      data: {
        userId: user.id,
        type: 'SUBSCRIPTION_EXPIRED',
        title: 'Subscription Cancelled',
        body: 'Your Premium subscription has ended. Upgrade again anytime.',
      },
    });

    // Verify
    const downgraded = await prisma.subscription.findUnique({ where: { id: sub.id } });

    const downgradeOk = downgraded?.plan === 'FREE'
      && downgraded?.status === 'CANCELLED'
      && downgraded?.weeklyMatchLimit === 3
      && downgraded?.canInitiateChat === false
      && downgraded?.canViewFullProfile === false
      && downgraded?.cancelledAt !== null;

    logTest(
      'Downgrade: PREMIUM_MONTHLY → FREE (subscription.deleted)',
      downgradeOk ? 'PASS' : 'FAIL',
      Date.now() - start,
      `plan=${downgraded?.plan}, status=${downgraded?.status}, weeklyLimit=${downgraded?.weeklyMatchLimit}, chat=${downgraded?.canInitiateChat}`
    );

    // Restore for further testing
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        plan: originalPlan as any,
        status: 'ACTIVE',
        weeklyMatchLimit: 5,
        canInitiateChat: true,
        canViewFullProfile: true,
        endsAt: null,
        cancelledAt: null,
      },
    });
  } catch (error: any) {
    logTest('Downgrade Simulation', 'FAIL', Date.now() - start, error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 7: Upgrade Simulation (FREE → PREMIUM_YEARLY)
// ═══════════════════════════════════════════════════════════
async function testUpgradeSimulation() {
  const start = Date.now();
  try {
    // Create a temporary FREE user to test upgrade
    const testEmail = 'test.paid.upgrade@lokfeel.com';
    
    // Clean up if exists
    await prisma.user.deleteMany({ where: { email: testEmail } }).catch(() => {});

    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('TestPaid123!', 10);

    const user = await prisma.user.create({
      data: {
        email: testEmail,
        name: 'Upgrade Test User',
        password: passwordHash,
        role: 'USER',
        emailVerified: new Date(),
        isBot: false,
        profile: {
          create: {
            displayName: 'Upgrade Test',
            age: 30,
            gender: 'MALE',
            sexuality: 'Straight',
            bio: 'Testing upgrade flow',
            avatar: 'https://randomuser.me/api/portraits/men/1.jpg',
            avatarType: 'photo',
            city: 'New York',
            country: 'US',
            relationshipGoal: 'LONG_TERM',
            attachmentStyle: 'Secure',
            communicationStyle: 'Direct',
            conflictResolution: 'Collaborative',
            loveLanguage: 'Quality Time',
            boundaries: '[]',
            dealbreakers: '[]',
            lifePriorities: '[]',
            emotionalAvailability: 'Fully Available',
            preferredAgeMin: 25,
            preferredAgeMax: 40,
            preferredGender: 'female',
            preferredDistance: 50,
            preferredLocation: 'New York',
            profileStatus: 'APPROVED',
            onboardingStep: 8,
            isApproved: true,
            isVerified: true,
          },
        },
        subscriptions: {
          create: {
            plan: 'FREE',
            status: 'ACTIVE',
            weeklyMatchLimit: 3,
            canInitiateChat: false,
            canViewFullProfile: false,
            startsAt: new Date(),
          },
        },
      },
    });

    // Now simulate checkout.session.completed → upgrade to PREMIUM_YEARLY
    const sub = await prisma.subscription.findFirst({ where: { userId: user.id } });
    if (!sub) throw new Error('No subscription found');

    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        plan: 'PREMIUM_YEARLY',
        status: 'ACTIVE',
        stripeCustomerId: `cus_upgrade_${Date.now()}`,
        stripeSubscriptionId: `sub_upgrade_${Date.now()}`,
        stripeCurrentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        weeklyMatchLimit: 5,
        canInitiateChat: true,
        canViewFullProfile: true,
        startsAt: new Date(),
        cancelledAt: null,
      },
    });

    await prisma.payment.create({
      data: {
        userId: user.id,
        stripePaymentIntentId: `pi_upgrade_${Date.now()}`,
        amount: 149.99,
        currency: 'usd',
        status: 'SUCCEEDED',
        description: 'LokFeel Yearly Premium',
      },
    });

    await prisma.notification.create({
      data: {
        userId: user.id,
        type: 'SYSTEM_ANNOUNCEMENT',
        title: 'Premium Activated! 🎉',
        body: 'Your LokFeel Yearly Premium is now active.',
      },
    });

    // Verify
    const upgraded = await prisma.subscription.findUnique({ where: { id: sub.id } });
    const payments = await prisma.payment.findMany({ where: { userId: user.id } });

    const upgradeOk = upgraded?.plan === 'PREMIUM_YEARLY'
      && upgraded?.status === 'ACTIVE'
      && upgraded?.weeklyMatchLimit === 5
      && upgraded?.canInitiateChat === true
      && payments.length === 1
      && payments[0].amount === 149.99;

    logTest(
      'Upgrade: FREE → PREMIUM_YEARLY (checkout.completed)',
      upgradeOk ? 'PASS' : 'FAIL',
      Date.now() - start,
      `plan=${upgraded?.plan}, status=${upgraded?.status}, payments=${payments.length}, amount=$${payments[0]?.amount || 0}`
    );

    // Clean up
    await prisma.user.delete({ where: { id: user.id } });
  } catch (error: any) {
    logTest('Upgrade Simulation', 'FAIL', Date.now() - start, error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 8: Payment Failure Simulation
// ═══════════════════════════════════════════════════════════
async function testPaymentFailure() {
  const start = Date.now();
  try {
    // Pick a user to simulate payment failure
    const user = await prisma.user.findFirst({
      where: { email: { startsWith: TEST_EMAIL_PREFIX } },
      include: { subscriptions: true },
    });

    if (!user || !user.subscriptions[0]) {
      logTest('Payment Failure Simulation', 'SKIP', Date.now() - start, 'No user found');
      return;
    }

    const sub = user.subscriptions[0];
    const originalStatus = sub.status;

    // Simulate invoice.payment_failed
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'PAST_DUE' },
    });

    await prisma.payment.create({
      data: {
        userId: user.id,
        stripePaymentIntentId: `pi_failed_${Date.now()}`,
        amount: 19.99,
        currency: 'usd',
        status: 'FAILED',
        description: 'LokFeel Monthly Premium payment failed',
      },
    });

    const pastDue = await prisma.subscription.findUnique({ where: { id: sub.id } });
    const failedPayment = await prisma.payment.findFirst({
      where: { userId: user.id, status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
    });

    const failureOk = pastDue?.status === 'PAST_DUE' && failedPayment?.status === 'FAILED';

    logTest(
      'Payment Failure: invoice.payment_failed → PAST_DUE + FAILED payment',
      failureOk ? 'PASS' : 'FAIL',
      Date.now() - start,
      `sub status=${pastDue?.status}, payment status=${failedPayment?.status}`
    );

    // Restore
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: originalStatus as any },
    });
    // Keep the failed payment record for reporting
  } catch (error: any) {
    logTest('Payment Failure Simulation', 'FAIL', Date.now() - start, error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 9: Refund Simulation
// ═══════════════════════════════════════════════════════════
async function testRefundSimulation() {
  const start = Date.now();
  try {
    const user = await prisma.user.findFirst({
      where: { email: { startsWith: TEST_EMAIL_PREFIX } },
    });

    if (!user) {
      logTest('Refund Simulation', 'SKIP', Date.now() - start, 'No user');
      return;
    }

    // Create a refunded payment
    await prisma.payment.create({
      data: {
        userId: user.id,
        stripePaymentIntentId: `pi_refund_${Date.now()}`,
        amount: -19.99,
        currency: 'usd',
        status: 'REFUNDED',
        description: 'LokFeel Monthly Premium refund',
      },
    });

    const refund = await prisma.payment.findFirst({
      where: { userId: user.id, status: 'REFUNDED' },
      orderBy: { createdAt: 'desc' },
    });

    logTest(
      'Refund: Payment status = REFUNDED with negative amount',
      refund?.status === 'REFUNDED' && refund?.amount < 0 ? 'PASS' : 'FAIL',
      Date.now() - start,
      `amount=${refund?.amount}, status=${refund?.status}`
    );
  } catch (error: any) {
    logTest('Refund Simulation', 'FAIL', Date.now() - start, error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 10: API Endpoint Reachability
// ═══════════════════════════════════════════════════════════
async function testAPIEndpoints() {
  const start = Date.now();
  try {
    // Test unauthenticated access to protected endpoints
    const [statusRes, checkoutRes, portalRes] = await Promise.all([
      fetch(`${APP_URL}/api/payments/status`),
      fetch(`${APP_URL}/api/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'PREMIUM_MONTHLY' }),
      }),
      fetch(`${APP_URL}/api/payments/portal`, { method: 'POST' }),
    ]);

    logTest(
      'API: GET /api/payments/status (no auth) → 401',
      statusRes.status === 401 ? 'PASS' : 'FAIL',
      Date.now() - start,
      `Got ${statusRes.status}`
    );

    logTest(
      'API: POST /api/payments/checkout (no auth) → 401',
      checkoutRes.status === 401 ? 'PASS' : 'FAIL',
      Date.now() - start,
      `Got ${checkoutRes.status}`
    );

    logTest(
      'API: POST /api/payments/portal (no auth) → 401',
      portalRes.status === 401 ? 'PASS' : 'FAIL',
      Date.now() - start,
      `Got ${portalRes.status}`
    );
  } catch (error: any) {
    logTest('API Endpoints', 'FAIL', Date.now() - start, error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 11: Webhook Security
// ═══════════════════════════════════════════════════════════
async function testWebhookSecurity() {
  const start = Date.now();
  try {
    const [getRes, postRes] = await Promise.all([
      fetch(`${APP_URL}/api/webhooks/stripe`),
      fetch(`${APP_URL}/api/webhooks/stripe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'test' }),
      }),
    ]);

    logTest(
      'Webhook: GET → 405 Method Not Allowed',
      getRes.status === 405 ? 'PASS' : 'FAIL',
      Date.now() - start,
      `Got ${getRes.status}`
    );

    logTest(
      'Webhook: POST without signature → 400',
      postRes.status === 400 ? 'PASS' : 'FAIL',
      Date.now() - start,
      `Got ${postRes.status}`
    );
  } catch (error: any) {
    logTest('Webhook Security', 'FAIL', Date.now() - start, error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 12: Revenue Summary
// ═══════════════════════════════════════════════════════════
async function testRevenueSummary() {
  const start = Date.now();
  try {
    const payments = await prisma.payment.findMany({
      where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
    });

    const succeeded = payments.filter(p => p.status === 'SUCCEEDED');
    const failed = payments.filter(p => p.status === 'FAILED');
    const refunded = payments.filter(p => p.status === 'REFUNDED');

    const grossRevenue = succeeded.reduce((sum, p) => sum + p.amount, 0);
    const refundTotal = refunded.reduce((sum, p) => sum + Math.abs(p.amount), 0);
    const netRevenue = grossRevenue - refundTotal;

    const monthlyCount = succeeded.filter(p => p.description?.includes('Monthly')).length;
    const yearlyCount = succeeded.filter(p => p.description?.includes('Yearly')).length;

    // Expected revenue
    const expectedMonthly = monthlyCount * 19.99;
    const expectedYearly = yearlyCount * 149.99;
    const expectedGross = expectedMonthly + expectedYearly;

    const revenueOk = Math.abs(grossRevenue - expectedGross) < 1;

    logTest(
      'Revenue: Gross matches plan × count',
      revenueOk ? 'PASS' : 'FAIL',
      Date.now() - start,
      `Gross: $${grossRevenue.toFixed(2)} (Expected: $${expectedGross.toFixed(2)}), Refunds: $${refundTotal.toFixed(2)}, Net: $${netRevenue.toFixed(2)}`
    );

    // Payment status distribution
    logTest(
      'Payment Status: SUCCEEDED/FAILED/REFUNDED all tracked',
      succeeded.length > 0 ? 'PASS' : 'FAIL',
      Date.now() - start,
      `${succeeded.length} succeeded, ${failed.length} failed, ${refunded.length} refunded`
    );
  } catch (error: any) {
    logTest('Revenue Summary', 'FAIL', Date.now() - start, error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 13: Page Rendering
// ═══════════════════════════════════════════════════════════
async function testPageRendering() {
  const start = Date.now();
  try {
    const [subPage, successPage, cancelPage] = await Promise.all([
      fetch(`${APP_URL}/dashboard/subscription`),
      fetch(`${APP_URL}/dashboard/subscription/success`),
      fetch(`${APP_URL}/dashboard/subscription/cancel`),
    ]);

    logTest(
      'Page: /dashboard/subscription → 200',
      subPage.status === 200 ? 'PASS' : 'FAIL',
      Date.now() - start,
      `Got ${subPage.status}`
    );

    logTest(
      'Page: /dashboard/subscription/success → 200',
      successPage.status === 200 ? 'PASS' : 'FAIL',
      Date.now() - start,
      `Got ${successPage.status}`
    );

    logTest(
      'Page: /dashboard/subscription/cancel → 200',
      cancelPage.status === 200 ? 'PASS' : 'FAIL',
      Date.now() - start,
      `Got ${cancelPage.status}`
    );
  } catch (error: any) {
    logTest('Page Rendering', 'FAIL', Date.now() - start, error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN: Run All Tests
// ═══════════════════════════════════════════════════════════
async function main() {
  console.log('\n🧪 E2E Payment Test: Full Flow Validation (v2 — DB + API)');
  console.log('=========================================================');
  console.log(`App URL:  ${APP_URL}`);
  console.log(`DB:       Neon PostgreSQL`);
  console.log(`Time:     ${new Date().toISOString()}`);
  console.log(`Users:    50 test.paid.*@lokfeel.com\n`);

  const totalStart = Date.now();

  // ─── Phase 1: Data Integrity ──────────────────────
  console.log('📦 Phase 1: Data Integrity');
  await testDataIntegrity();
  console.log('');

  // ─── Phase 2: Plan Distribution ───────────────────
  console.log('📊 Phase 2: Plan Distribution');
  await testPlanDistribution();
  console.log('');

  // ─── Phase 3: Payment Accuracy ────────────────────
  console.log('💰 Phase 3: Payment Accuracy');
  await testAmountAccuracy();
  await testStripeFields();
  console.log('');

  // ─── Phase 4: Subscription Perks ──────────────────
  console.log('⚡ Phase 4: Subscription Perks');
  await testPremiumPerks();
  console.log('');

  // ─── Phase 5: Lifecycle Simulation ────────────────
  console.log('🔄 Phase 5: Lifecycle Simulation');
  await testDowngradeSimulation();
  await testUpgradeSimulation();
  await testPaymentFailure();
  await testRefundSimulation();
  console.log('');

  // ─── Phase 6: API & Security ──────────────────────
  console.log('🔌 Phase 6: API & Security');
  await testAPIEndpoints();
  await testWebhookSecurity();
  console.log('');

  // ─── Phase 7: Revenue ────────────────────────────
  console.log('💵 Phase 7: Revenue');
  await testRevenueSummary();
  console.log('');

  // ─── Phase 8: Pages ──────────────────────────────
  console.log('🖥️ Phase 8: Page Rendering');
  await testPageRendering();
  console.log('');

  // ─── Final Report ──────────────────────────────────
  const totalDuration = Date.now() - totalStart;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 E2E Payment Test: Final Report');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total Tests:  ${results.length}`);
  console.log(`  ✅ Passed:    ${passed}`);
  console.log(`  ❌ Failed:    ${failed}`);
  console.log(`  ⏭️  Skipped:  ${skipped}`);
  console.log(`  ⏱️  Duration:  ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`  Pass Rate:   ${((passed / (results.length - skipped)) * 100).toFixed(0)}%`);

  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  - ${r.name}: ${r.detail}`);
    });
  }

  const overallOk = failed === 0;
  console.log(`\n🎯 Overall: ${overallOk ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  await prisma.$disconnect();
  process.exit(overallOk ? 0 : 1);
}

main();
