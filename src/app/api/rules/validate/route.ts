/**
 * Power Board Lite 规则验证 API
 * 
 * POST /api/rules/validate - 预检消息是否符合规则
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getRuleEngine } from '@/lib/rules/engine';
import { validateValidateMessageRequest } from '@/lib/rules/schema';
import {
  RuleEvaluationContext,
  ValidateMessageResponse,
  SenderHistory,
  MessageType,
  MediaAccessLevel,
} from '@/lib/rules/types';

export const dynamic = 'force-dynamic';

// ============================================================================
// POST /api/rules/validate - 预检消息
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const body = await request.json();

    // 验证请求
    const validation = validateValidateMessageRequest(body);
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

    const { senderId, receiverId, messageType, mediaLevel, content, conversationId } = validation.data;

    // 安全检查：发送者必须是当前用户
    if (senderId !== user.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized sender' },
        { status: 403 }
      );
    }

    const ruleEngine = getRuleEngine();

    // 获取频率状态
    const paceResult = await ruleEngine.checkRateLimit(senderId, receiverId);
    
    // 构建发送者历史
    const senderHistory: SenderHistory = {
      messageCount: paceResult.hourlyCount,
      lastMessageAt: paceResult.hourlyCount > 0 ? new Date() : null,
      violations: 0,
      firstMessageAt: new Date(),
    };

    // 获取接收者的规则
    const rules = await ruleEngine.getUserRules(receiverId);

    // 构建评估上下文
    const context: RuleEvaluationContext = {
      senderId,
      receiverId,
      messageType: messageType as MessageType,
      mediaLevel: (mediaLevel ?? MediaAccessLevel.L0_TEXT) as MediaAccessLevel,
      content,
      conversationId,
      senderHistory,
      rules,
    };

    // 执行规则评估
    const result = await ruleEngine.evaluateMessage(context);

    const response: ValidateMessageResponse = result;

    // 根据结果返回不同状态码
    let statusCode = 200;
    if (result.result === 'PACE_LIMIT') {
      statusCode = 429; // Too Many Requests
    } else if (result.result === 'HARD_BLOCK') {
      statusCode = 403; // Forbidden
    } else if (result.result === 'SOFT_BLOCK') {
      statusCode = 403; // Forbidden (but can appeal)
    }

    return NextResponse.json(
      {
        success: result.result === 'PASS',
        data: response,
      },
      { status: statusCode }
    );
  } catch (error) {
    console.error('Failed to validate message:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to validate message',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
