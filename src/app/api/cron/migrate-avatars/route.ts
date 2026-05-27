/**
 * Background Avatar Migration API
 * 
 * Cron-triggered endpoint to gradually migrate bot avatars to lorelei style.
 * Processes 50 profiles per call to stay within Vercel 10s timeout.
 * 
 * Trigger: curl -X POST https://app.lokfeel.com/api/cron/migrate-avatars \
 *   -H "Authorization: Bearer CRON_SECRET"
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const maxDuration = 10; // 10s timeout (Hobby plan max)
export const preferredRegion = 'iad1';

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');

  if (token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getDb();
    const BATCH = 50;

    // Get next batch of profiles to migrate
    const profiles = await db.profile.findMany({
      where: {
        user: { isBot: true },
        NOT: { avatar: { contains: 'lorelei' } },
        // Only migrate if avatar doesn't already have base64
        avatar: { not: { startsWith: 'data:image/webp' } },
      },
      select: {
        id: true,
        displayName: true,
        gender: true,
        avatar: true,
      },
      take: BATCH,
    });

    if (profiles.length === 0) {
      return NextResponse.json({ migrated: 0, remaining: 0, done: true });
    }

    let migrated = 0;
    for (const p of profiles) {
      const g = p.gender?.toUpperCase() || '';
      const bgColor = g === 'FEMALE' || g === 'WOMAN'
        ? 'fce7f3,fbcfe8,f9a8d4'
        : g === 'MALE' || g === 'MAN'
        ? 'dbeafe,bfdbfe,93c5fd'
        : 'f3e8ff,e9d5ff,d8b4fe';
      const seed = `${p.displayName}-${p.gender}-lorelei`;
      const url = `https://api.dicebear.com/9.x/lorelei/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${bgColor}&radius=50`;

      await db.profile.update({
        where: { id: p.id },
        data: { avatar: url, avatarType: 'photo' },
      });
      migrated++;
    }

    // Count remaining
    const remaining = await db.profile.count({
      where: {
        user: { isBot: true },
        NOT: { avatar: { contains: 'lorelei' } },
        avatar: { not: { startsWith: 'data:image/webp' } },
      },
    });

    return NextResponse.json({
      migrated,
      remaining,
      done: remaining === 0,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Internal error' },
      { status: 500 }
    );
  }
}
