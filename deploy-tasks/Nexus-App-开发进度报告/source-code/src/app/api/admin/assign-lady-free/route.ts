import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withPermission } from '@/lib/with-permission';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/assign-lady-free
 * Assign LADY_FREE subscriptions to all existing female users
 * Admin-only endpoint - requires user.edit permission (dangerous operation)
 */
export const POST = withPermission('user.edit', { dangerous: true })(async () => {
  try {
    // Find all female profiles
    const femaleProfiles = await db.profile.findMany({
      where: { gender: 'FEMALE' },
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
