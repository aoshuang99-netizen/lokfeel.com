/**
 * GET /api/admin/analytics/events
 * Admin: Query analytics events with filters and pagination
 * 
 * POST /api/admin/analytics/events
 * Admin: Create event definition
 */

export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withPermission } from '@/lib/with-permission';
import { success, badRequest } from '@/lib/api-response';

// ─── GET: Query events ───

export const GET = withPermission('analytics.view')(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));
  const eventName = searchParams.get('event');
  const category = searchParams.get('category');
  const userId = searchParams.get('userId');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const search = searchParams.get('search');

  const where: Record<string, unknown> = {};
  if (eventName) where.event = eventName;
  if (category) where.eventCategory = category;
  if (userId) where.userId = userId;
  
  if (startDate || endDate) {
    const createdAt: Record<string, Date> = {};
    if (startDate) createdAt.gte = new Date(startDate);
    if (endDate) createdAt.lte = new Date(endDate);
    where.createdAt = createdAt;
  }

  const [events, total] = await Promise.all([
    db.analyticsEvent.findMany({
      where: where as Record<string, unknown>,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        event: true,
        eventCategory: true,
        userId: true,
        sessionId: true,
        pagePath: true,
        platform: true,
        country: true,
        ipAddress: true,
        createdAt: true,
      },
    }),
    db.analyticsEvent.count({ where: where as Record<string, unknown> }),
  ]);

  return success(events, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
});

// ─── POST: Create event definition ───

export const POST = withPermission('admin.settings')(async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  if (!body?.name || !body?.category) {
    return badRequest('name and category are required');
  }

  const def = await db.analyticsEventDef.create({
    data: {
      name: body.name,
      category: body.category,
      description: body.description || '',
      properties: body.properties ? JSON.stringify(body.properties) : '{}',
      isActive: body.isActive !== false,
      sampleRate: body.sampleRate ?? 1.0,
    },
  });

  return success(def);
});
