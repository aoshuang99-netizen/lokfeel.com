/**
 * Power Board Lite 规则 API - 用户特定规则管理
 *
 * GET /api/rules/[userId] - 获取指定用户规则
 * PUT /api/rules/[userId] - 更新指定用户规则（仅女性用户可操作）
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api-handler';
import { getRuleEngine } from '@/lib/rules/engine';
import { validateUpdateRulesRequest } from '@/lib/rules/schema';
import { PowerBoardRules } from '@/lib/rules/types';
import { convertFullToLiteRules } from '@/lib/rules/defaults';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ============================================================================
// GET /api/rules/[userId] - 获取指定用户规则
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const { userId } = await params;

    // 安全检查：只能获取自己的规则或管理员权限
    if (userId !== user.id) {
      // TODO: 检查用户是否有管理员权限
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format'); // 'lite' | 'full'

    const ruleEngine = getRuleEngine();
    const rules = await ruleEngine.getUserRules(userId);

    // 根据格式返回
    if (format === 'lite') {
      return NextResponse.json({
        success: true,
        data: convertFullToLiteRules(rules),
      });
    }

    return NextResponse.json({
      success: true,
      data: rules,
    });
  });
}

// ============================================================================
// PUT /api/rules/[userId] - 更新规则（仅女性用户可操作）
// ============================================================================

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const { userId } = await params;

    // 安全检查：只能修改自己的规则
    if (userId !== user.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // 检查用户性别，仅女性可修改规则
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
      select: { gender: true }
    });

    if (profile?.gender !== 'FEMALE') {
      return NextResponse.json(
        { success: false, error: 'Only female users can modify rules' },
        { status: 403 }
      );
    }

    const body = await request.json();

    // 验证请求
    const validation = validateUpdateRulesRequest(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request',
          details: 'errors' in validation ? (validation.errors as any)?.errors : undefined,
        },
        { status: 400 }
      );
    }

    const ruleEngine = getRuleEngine();
    const currentRules = await ruleEngine.getUserRules(userId);

    // 构建更新
    const updates: Partial<PowerBoardRules> = {};

    if (validation.data.pace) {
      updates.pace = { ...currentRules.pace, ...validation.data.pace };
    }

    if (validation.data.media) {
      updates.media = { ...currentRules.media, ...validation.data.media };
    }

    if (validation.data.filter) {
      updates.filter = { ...currentRules.filter, ...validation.data.filter };
    }

    if (validation.data.autoReply) {
      updates.autoReply = { ...currentRules.autoReply, ...validation.data.autoReply };
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No changes provided' },
        { status: 400 }
      );
    }

    // 更新规则
    const { rules: newRules, changes } = await ruleEngine.updateUserRules(
      userId,
      updates,
      user.id
    );

    return NextResponse.json({
      success: true,
      data: {
        newVersion: newRules.version,
        appliedAt: newRules.updatedAt,
        changes,
      },
    });
  });
}
