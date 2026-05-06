/**
 * Debug endpoint to check authentication state.
 * 安全修复: 移除AUTH_SECRET长度泄露，仅返回必要信息
 * ⚠️ ADMIN ONLY — Protected endpoint
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/auth';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAdminAuth();

    const cookieHeader = req.headers.get('cookie') || '';
    const cookieNames = cookieHeader.split(';').map(c => c.trim().split('=')[0]).filter(Boolean);

    let authResult: Record<string, unknown> = { success: false };
    try {
      const session = await auth();
      authResult = {
        success: !!session?.user,
        hasId: !!(session?.user as any)?.id,
      };
    } catch {
      // auth check failed silently
    }

    return NextResponse.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        cookies: { count: cookieNames.length, names: cookieNames },
        authResult,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }
}
