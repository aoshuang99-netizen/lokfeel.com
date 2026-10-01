import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withPermission } from '@/lib/with-permission';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/assign-lady-free
 * Assign LADY_FREE subscriptions to all existing female users
 * Admin-only endpoint - requires user.edit permission (dangerous operation)
 *
 * ⚠️ 性别词表（2026-10-01 修复）：库中同时存在两套约定
 *   · 现代（`register` 写入、UI 常量使用）：`WOMAN` / `TRANSGENDER_WOMAN`
 *   · 历史（早期导入/种子数据）：`FEMALE`
 *   旧实现只查 `gender: 'FEMALE'`，会**静默漏掉**所有走现代词表注册的女性用户
 *   （生产库实测 3625 名女性中 1451 名没有 LADY_FREE 记录，与此直接相关）。
 *   现改为与 `lib/gender-utils` 同一套判定，覆盖全部女性取值。
 */
export const POST = withPermission('user.edit', { dangerous: true })(async () => {
  try {
    // Find all female profiles (both naming conventions)
    const femaleProfiles = await db.profile.findMany({
      where: { gender: { in: ['FEMALE', 'WOMAN', 'TRANSGENDER_WOMAN'] } },
      select: { userId: true, displayName: true },
    });

    let created = 0;
    let skipped = 0;

    for (const p of femaleProfiles) {
      const existing = await db.subscription.findFirst({
        where: { userId: p.userId, plan: "LADY_FREE", status: 'ACTIVE' },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await db.subscription.create({
        data: {
          userId: p.userId,
          plan: 'LADY_FREE',
          status: 'ACTIVE',
          weeklyMatchLimit: 5,
          canInitiateChat: true,
          canViewFullProfile: true,
          startsAt: new Date(),
          endsAt: new Date('2099-12-31'),
        },
      });
      created++;
    }

    return NextResponse.json({
      success: true,
      totalFemaleProfiles: femaleProfiles.length,
      created,
      skipped,
    });
  } catch (error) {
    console.error('Assign Lady Free error:', error);
    return NextResponse.json(
      { error: 'Failed to assign Lady Free subscriptions' },
      { status: 500 }
    );
  }
});
