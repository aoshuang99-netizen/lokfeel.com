/**
 * POST /api/im/consent — Request or respond to consent
 * GET /api/im/consent — Get consent status
 * 
 * Endpoints:
 * - POST (request): Request consent from another user
 * - POST (respond): Respond to a consent request
 * - GET: Check consent status between two users
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { auditLogger, pushToUser } from '@/lib/im';
import type { ConsentRequestType, MediaAccessLevel, ConsentState } from '@/lib/im';

export const dynamic = 'force-dynamic';

// GET — Check consent status
export async function GET(request: NextRequest) {
  try {
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
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[IM Consent GET] Error:', error);
    return NextResponse.json({ error: 'Failed to check consent' }, { status: 500 });
  }
}

// POST — Request or respond to consent
export async function POST(request: NextRequest) {
  try {
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
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[IM Consent POST] Error:', error);
    return NextResponse.json({ error: 'Failed to process consent' }, { status: 500 });
  }
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
