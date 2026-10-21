/**
 * POST /api/im/consent — Request or respond to consent
 * GET /api/im/consent — Get consent status
 * DELETE /api/im/consent — Revoke a consent grant you issued (V17 · SEC-07)
 *
 * Endpoints:
 * - POST (request): Request consent from another user
 * - POST (respond): Respond to a consent request
 * - GET: Check consent status between two users
 * - DELETE: Revoke (only the granter may revoke; idempotent)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api-handler';
import { db } from '@/lib/db';
import { auditLogger, pushToUser } from '@/lib/im';
import type { ConsentRequestType, MediaAccessLevel, ConsentState } from '@/lib/im';

export const dynamic = 'force-dynamic';

// GET — Check consent status
export async function GET(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const targetId = searchParams.get('targetId');
    const consentType = searchParams.get('consentType') as ConsentRequestType || 'MEDIA';

    if (!targetId) {
      return NextResponse.json({ error: 'targetId is required' }, { status: 400 });
    }

    // Check existing grant
    const grant = await db.consentGrant.findFirst({
      where: {
        granterId: targetId,
        granteeId: user.id,
        consentType,
        isRevoked: false,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { grantedAt: 'desc' },
    });

    // Check pending request
    const pendingRequest = await db.consentRequest.findFirst({
      where: {
        requesterId: user.id,
        targetId,
        consentType,
        state: 'CONSENT_PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    let state: ConsentState = 'CONSENT_NONE';
    if (grant) {
      state = 'CONSENT_GRANTED';
    } else if (pendingRequest) {
      state = 'CONSENT_PENDING';
    }

    return NextResponse.json({
      state,
      grant: grant ? {
        id: grant.id,
        grantedLevel: grant.grantedLevel,
        grantedAt: grant.grantedAt.getTime(),
        expiresAt: grant.expiresAt?.getTime(),
      } : null,
      pendingRequest: pendingRequest ? {
        id: pendingRequest.id,
        requestedLevel: pendingRequest.requestedLevel,
        expiresAt: pendingRequest.expiresAt.getTime(),
      } : null,
    });
  });
}

// POST — Request or respond to consent
export async function POST(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const body = await request.json();
    const { action } = body; // "request" or "respond"

    if (action === 'request') {
      return await handleConsentRequest(user.id, body);
    } else if (action === 'respond') {
      return await handleConsentResponse(user.id, body);
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Must be "request" or "respond"' },
        { status: 400 }
      );
    }
  });
}

async function handleConsentRequest(
  userId: string,
  body: {
    targetId: string;
    conversationId: string;
    consentType: ConsentRequestType;
    requestedLevel: MediaAccessLevel;
    reason?: string;
    contextMsgId?: string;
  }
) {
  const { targetId, conversationId, consentType, requestedLevel, reason, contextMsgId } = body;

  if (!targetId || !conversationId || !consentType) {
    return NextResponse.json(
      { error: 'targetId, conversationId, and consentType are required' },
      { status: 400 }
    );
  }

  // Verify conversation participation
  const participant = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!participant) {
    return NextResponse.json({ error: 'Not a participant' }, { status: 403 });
  }

  // Check for existing pending request
  const existing = await db.consentRequest.findFirst({
    where: {
      requesterId: userId,
      targetId,
      consentType,
      state: 'CONSENT_PENDING',
      expiresAt: { gt: new Date() },
    },
  });

  if (existing) {
    return NextResponse.json({
      success: true,
      requestId: existing.id,
      message: 'Consent request already pending',
      expiresAt: existing.expiresAt.getTime(),
    });
  }

  // Create consent request (expires in 7 days by default)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const grantToken = `grant_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const consentRequest = await db.consentRequest.create({
    data: {
      requesterId: userId,
      targetId,
      conversationId,
      consentType,
      requestedLevel,
      contextMsgId,
      reason,
      state: 'CONSENT_PENDING',
      expiresAt,
      grantToken,
    },
  });

  // Push real-time event to target user
  await pushToUser(targetId, {
    eventId: `consent_req_${consentRequest.id}`,
    eventType: 'consent_request',
    timestamp: Date.now(),
    payload: {
      requestId: consentRequest.id,
      requesterId: userId,
      targetId,
      convId: conversationId,
      consentType,
      requestedLevel,
      reason,
      state: 'CONSENT_PENDING',
      expiresAt: expiresAt.getTime(),
      createdAt: Date.now(),
    },
  });

  // Audit log
  await auditLogger.record({
    userId,
    conversationId,
    action: 'consent_requested',
    targetId,
    details: {
      requestId: consentRequest.id,
      consentType,
      requestedLevel,
    },
  });

  return NextResponse.json({
    success: true,
    requestId: consentRequest.id,
    expiresAt: expiresAt.getTime(),
  });
}

async function handleConsentResponse(
  userId: string,
  body: {
    requestId: string;
    decision: 'CONSENT_GRANTED' | 'CONSENT_DENIED';
    note?: string;
    validUntil?: number; // timestamp, 0 = permanent
  }
) {
  const { requestId, decision, note, validUntil } = body;

  if (!requestId || !decision) {
    return NextResponse.json(
      { error: 'requestId and decision are required' },
      { status: 400 }
    );
  }

  // Find the request
  const consentRequest = await db.consentRequest.findUnique({
    where: { id: requestId },
  });

  if (!consentRequest) {
    return NextResponse.json({ error: 'Consent request not found' }, { status: 404 });
  }

  // Verify this user is the target
  if (consentRequest.targetId !== userId) {
    return NextResponse.json({ error: 'You are not the target of this request' }, { status: 403 });
  }

  // Check expiration
  if (consentRequest.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Consent request has expired' }, { status: 400 });
  }

  // Update request state
  await db.consentRequest.update({
    where: { id: requestId },
    data: {
      state: decision,
      respondedAt: new Date(),
      responseNote: note,
    },
  });

  // If granted, create consent grant
  if (decision === 'CONSENT_GRANTED') {
    const expiresAt = validUntil ? new Date(validUntil) : null;

    await db.consentGrant.create({
      data: {
        granterId: userId,
        granteeId: consentRequest.requesterId,
        conversationId: consentRequest.conversationId,
        consentType: consentRequest.consentType,
        grantedLevel: consentRequest.requestedLevel,
        expiresAt,
      },
    });

    // Update conversation consent cache
    await db.conversation.update({
      where: { id: consentRequest.conversationId },
      data: { cachedConsentState: 'CONSENT_GRANTED' },
    });
  }

  // Push response to requester
  await pushToUser(consentRequest.requesterId, {
    eventId: `consent_resp_${requestId}`,
    eventType: 'consent_response',
    timestamp: Date.now(),
    payload: {
      requestId,
      responderId: userId,
      decision,
      note,
      validUntil: validUntil || 0,
      grantToken: decision === 'CONSENT_GRANTED' ? (consentRequest.grantToken || undefined) : undefined,
    },
  });

  // Audit log
  await auditLogger.record({
    userId,
    conversationId: consentRequest.conversationId,
    action: decision === 'CONSENT_GRANTED' ? 'consent_granted' : 'consent_denied',
    targetId: consentRequest.requesterId,
    details: {
      requestId,
      decision,
      consentType: consentRequest.consentType,
      grantedLevel: consentRequest.requestedLevel,
    },
  });

  return NextResponse.json({
    success: true,
    decision,
  });
}

/**
 * V17 · DELETE /api/im/consent —— **撤销**已授出的同意
 *
 * 为什么必须补：`isRevoked` 在本仓一直是**只读**字段 —— 所有读取路径都过滤
 * `isRevoked: false`（`GET` 与 `socket/delivery.ts:getConsentState`），
 * `AuditAction` 里也预留了 `consent_revoked`，但**没有任何写入者**。
 * 结果是「用户能看见自己授权过，却永远撤不掉」—— 传出去的授权成了单行道，
 * 与 AC「同意可撤回」直接冲突（SEC-07）。
 *
 * 语义：
 *   - 只有**授出方本人**能撤销（`granterId = 当前用户`），受让方无权代撤；
 *   - `targetId` = 被授权人（grantee），`consentType` 缺省 MEDIA；
 *   - 幂等：无可撤记录时返回 `revoked: 0`，不制造 404 噪音；
 *   - 撤销后立刻生效：读取路径本来就过滤 `isRevoked`，无需缓存失效逻辑，
 *     额外把会话缓存改回 `CONSENT_NONE`，避免 UI 残留"已授权"。
 */
export async function DELETE(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const targetId = searchParams.get('targetId');
    const consentType = (searchParams.get('consentType') as ConsentRequestType) || 'MEDIA';

    if (!targetId) {
      return NextResponse.json({ error: 'targetId is required' }, { status: 400 });
    }

    const grants = await db.consentGrant.findMany({
      where: {
        // 🔴 授出方必须是自己 —— 这是"只能撤回自己给出的授权"的唯一落点。
        granterId: user.id,
        granteeId: targetId,
        consentType,
        isRevoked: false,
      },
      select: { id: true, conversationId: true },
    });

    if (grants.length === 0) {
      return NextResponse.json({ success: true, revoked: 0 });
    }

    const now = new Date();
    await db.consentGrant.updateMany({
      // 双保险：即便上面的查询被改坏，写侧仍限定 granterId。
      where: { id: { in: grants.map((g) => g.id) }, granterId: user.id },
      data: { isRevoked: true, revokedAt: now },
    });

    const conversationIds = [...new Set(grants.map((g) => g.conversationId))];
    await db.conversation.updateMany({
      where: { id: { in: conversationIds } },
      data: { cachedConsentState: 'CONSENT_NONE' },
    });

    await auditLogger.record({
      userId: user.id,
      conversationId: conversationIds[0],
      action: 'consent_revoked',
      targetId,
      details: { consentType, revokedCount: grants.length },
    });

    return NextResponse.json({
      success: true,
      revoked: grants.length,
      revokedAt: now.toISOString(),
    });
  });
}
