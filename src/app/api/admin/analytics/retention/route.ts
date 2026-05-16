import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/with-permission';
import { success } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

// Mock retention data (simulate real retention patterns)
function generateRetentionData() {
  const cohorts = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const cohortDate = new Date(now);
    cohortDate.setDate(cohortDate.getDate() - (i * 7));
    const cohortLabel = cohortDate.toISOString().split('T')[0];
    const initialUsers = Math.floor(Math.random() * 200) + 100;

    const retention = [100]; // Day 0: 100%
    for (let d = 1; d <= 7; d++) {
      const rate = Math.max(5, 85 - (d * 12) + (Math.random() * 10));
      retention.push(Math.round(rate));
    }

    cohorts.push({
      cohort: cohortLabel,
      initialUsers,
      retention,
    });
  }

  return cohorts;
}

export const GET = withPermission('analytics.view')(async (req: NextRequest) => {
  try {
    const cohorts = generateRetentionData();

    const avgRetention = {
      day0: 100,
      day1: Math.round(cohorts.reduce((sum, c) => sum + c.retention[1], 0) / cohorts.length),
      day3: Math.round(cohorts.reduce((sum, c) => sum + c.retention[3], 0) / cohorts.length),
      day7: Math.round(cohorts.reduce((sum, c) => sum + c.retention[7], 0) / cohorts.length),
    };

    return success({
      cohorts,
      avgRetention,
      summary: {
        totalCohorts: cohorts.length,
        bestDay1: Math.max(...cohorts.map(c => c.retention[1])),
        bestDay7: Math.max(...cohorts.map(c => c.retention[7])),
      },
    });
  } catch (error: any) {
    console.error('Retention API error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
});
