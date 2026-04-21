/**
 * Power Board Lite 规则 API
 * GET /api/rules - 获取当前用户规则
 * POST /api/rules - 更新规则
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getRuleEngine } from '@/lib/rules/engine';
import { validateUpdateRulesRequest } from '@/lib/rules/schema';
import { PowerBoardRules, UpdateRulesResponse, RuleChange } from '@/lib/rules/types';
import { convertFullToLiteRules } from '@/lib/rules/defaults';

export const dynamic = 'force-dynamic';

// ============================================================================
// GET /api/rules - 获取当前用户规则
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format'); // 'lite' | 'full'

    const ruleEngine = getRuleEngine();
    const rules = await ruleEngine.getUserRules(user.id);

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
  } catch (error) {
    console.error('Failed to get rules:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get rules',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/rules - 更新规则（仅女性用户）
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();

    // TODO: 检查用户性别，仅女性可修改规则
    // const profile = await db.profile.findUnique({ where: { userId: user.id } });
    // if (profile?.gender !== 'female') {
    //   return NextResponse.json(
    //     { success: false, error: 'Only female users can modify rules' },
    //     { status: 403 }
    //   );
    // }

    const body = await request.json();

    // 验证请求
    const validation = validateUpdateRulesRequest(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request',
          details: (validation as any).errors?.errors,
        },
        { status: 400 }
      );
    }

    const ruleEngine = getRuleEngine();
    const currentRules = await ruleEngine.getUserRules(user.id);

    // 构建更新
    const updates: Partial<PowerBoardRules> = {};
    const changes: RuleChange[] = [];
    const now = new Date();

    if (validation.data.pace) {
      updates.pace = { ...currentRules.pace, ...validation.data.pace };
      changes.push({
        field: 'pace',
        oldValue: currentRules.pace,
        newValue: updates.pace,
        changedAt: now,
      });
    }

    if (validation.data.media) {
      updates.media = { ...currentRules.media, ...validation.data.media };
      changes.push({
        field: 'media',
        oldValue: currentRules.media,
        newValue: updates.media,
        changedAt: now,
      });
    }

    if (validation.data.filter) {
      updates.filter = { ...currentRules.filter, ...validation.data.filter };
      changes.push({
        field: 'filter',
        oldValue: currentRules.filter,
        newValue: updates.filter,
        changedAt: now,
      });
    }

    if (validation.data.autoReply) {
      updates.autoReply = { ...currentRules.autoReply, ...validation.data.autoReply };
      changes.push({
        field: 'autoReply',
        oldValue: currentRules.autoReply,
        newValue: updates.autoReply,
        changedAt: now,
      });
    }

    if (changes.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No changes provided' },
        { status: 400 }
      );
    }

    // 更新规则
    const { rules: newRules } = await ruleEngine.updateUserRules(user.id, updates, user.id);

    const response: UpdateRulesResponse = {
      success: true,
      newVersion: newRules.version,
      appliedAt: newRules.updatedAt,
      changes,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to update rules:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update rules',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
