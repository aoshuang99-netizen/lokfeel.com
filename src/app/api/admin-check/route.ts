/**
 * 认证诊断端点 - 仅管理员可用
 * 安全修复: 移除AUTH_SECRET长度泄露，移除无认证访问
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/auth';
import { auth } from '@/lib/auth/auth';
import { getToken } from 'next-auth/jwt';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdminAuth();

    const results: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
    };

    // 1. Check cookies (names only, no values)
    const cookies = req.cookies.getAll();
    results.cookies = {
      count: cookies.length,
      names: cookies.map(c => c.name),
    };

    // 2. Test getToken()
    try {
      const token = await getToken({ req, secret: process.env.AUTH_SECRET });
      results.getToken = {
        success: !!token,
        hasId: !!(token as any)?.id,
      };
    } catch (e: any) {
      results.getToken = { success: false, error: e.message };
    }

    // 3. Test auth()
    try {
      const sess = await auth();
      results.auth = {
        success: !!sess?.user,
      };
    } catch (e: any) {
      results.auth = { success: false, error: e.message };
    }

    return NextResponse.json(results, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }
}
