/**
 * POST /api/analytics/collect
 * 
 * Batch event collection endpoint for the frontend tracking SDK.
 * Receives an array of events, validates, deduplicates, and writes to database.
 * 
 * RBAC: Public (but validated for spam/abuse)
 */

export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { success, badRequest, serverError } from '@/lib/api-response';

// Maximum events per batch
const MAX_BATCH_SIZE = 50;

// Maximum properties JSON size
const MAX_PROPERTIES_SIZE = 4096;

// Rate limit: max requests per IP per minute (basic)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 120; // 120 requests per minute
const RATE_LIMIT_WINDOW = 60_000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT_MAX) return false;
  
  entry.count++;
  return true;
}

// Simple GeoIP lookup (offline — just for country)
// In production, use Vercel's `x-vercel-ip-country` header
function getCountry(request: NextRequest): string | null {
  return request.headers.get('x-vercel-ip-country') || null;
}

function getCity(request: NextRequest): string | null {
  return request.headers.get('x-vercel-ip-city') || null;
}

export const POST = async (request: NextRequest) => {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!checkRateLimit(ip)) {
      return badRequest('Rate limit exceeded');
    }

    // Parse body
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.events)) {
      return badRequest('Invalid request format. Expected { events: [...] }');
    }

    const { events } = body;

    if (events.length === 0) {
      return success({ received: 0, processed: 0 });
    }

    if (events.length > MAX_BATCH_SIZE) {
      return badRequest(`Batch size exceeds maximum of ${MAX_BATCH_SIZE}`);
    }

    // Validate and sanitize events
    const validEvents = events.filter((e: Record<string, unknown>) => {
      if (!e.event || typeof e.event !== 'string') return false;
      if (e.event.length > 128) return false;
      
      // Validate properties size
      if (e.properties) {
        const propsStr = typeof e.properties === 'string' 
          ? e.properties 
          : JSON.stringify(e.properties);
        if (propsStr.length > MAX_PROPERTIES_SIZE) return false;
      }
      
      return true;
    });

    if (validEvents.length === 0) {
      return success({ received: events.length, processed: 0, reason: 'all events invalid' });
    }

    // Deduplicate by event_id
    const seen = new Set<string>();
    const uniqueEvents = validEvents.filter((e: Record<string, unknown>) => {
      const id = String(e.event_id || '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // GeoIP
    const country = getCountry(request);
    const city = getCity(request);

    // Batch insert
    const inserts = uniqueEvents.map((e: Record<string, unknown>) => {
      const props = e.properties 
        ? (typeof e.properties === 'string' ? e.properties : JSON.stringify(e.properties))
        : '{}';

      return db.analyticsEvent.create({
        data: {
          event: String(e.event || '').slice(0, 128),
          eventCategory: String(e.event_category || 'other').slice(0, 32),
          userId: e.user_id ? String(e.user_id).slice(0, 128) : null,
          sessionId: String(e.session_id || '').slice(0, 64),
          deviceId: String(e.device_id || '').slice(0, 64),
          properties: props.slice(0, MAX_PROPERTIES_SIZE),
          pagePath: String(e.page_path || '').slice(0, 256),
          platform: String(e.platform || 'web').slice(0, 16),
          appVersion: String(e.app_version || '').slice(0, 32),
          ipAddress: ip.slice(0, 64),
          country,
          city,
          utmSource: e.utm_source ? String(e.utm_source).slice(0, 128) : null,
          utmMedium: e.utm_medium ? String(e.utm_medium).slice(0, 128) : null,
          utmCampaign: e.utm_campaign ? String(e.utm_campaign).slice(0, 128) : null,
          utmContent: e.utm_content ? String(e.utm_content).slice(0, 128) : null,
          utmTerm: e.utm_term ? String(e.utm_term).slice(0, 128) : null,
        },
      });
    });

    try {
      await Promise.all(inserts);
    } catch (dbError) {
      console.error('Analytics batch insert error:', dbError);
      return serverError('Failed to store events');
    }

    // Clean old rate limit entries (every 100 requests)
    if (Math.random() < 0.01) {
      const now = Date.now();
      for (const [key, entry] of rateLimitMap) {
        if (now > entry.resetAt) rateLimitMap.delete(key);
      }
    }

    return success({
      received: events.length,
      valid: validEvents.length,
      processed: uniqueEvents.length,
    });
  } catch (error: unknown) {
    console.error('Analytics collect error:', error);
    return serverError('Internal error processing events');
  }
};

// Limit body size
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '100kb',
    },
  },
};
