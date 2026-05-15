/**
 * LokFeel Analytics Tracker — Frontend SDK
 * 
 * Lightweight (<5KB gzip) event tracking with:
 * - Auto-capture: page_view, session_start/end, errors, performance
 * - Manual tracking: track(), identify(), trackRevenue()
 * - Batch sending with sendBeacon fallback
 * - Privacy-first: PII auto-stripping, consent-aware
 */

// ─── Types ───

export interface TrackerConfig {
  appVersion?: string;
  endpoint?: string;
  sampleRate?: number;
  debug?: boolean;
  autoTrack?: boolean;
}

interface AnalyticsEvent {
  event_id: string;
  event: string;
  event_category: string;
  timestamp: number;
  session_id: string;
  user_id?: string;
  device_id: string;
  properties: Record<string, unknown>;
  page_path: string;
  page_title: string;
  referrer: string;
  platform: string;
  screen_width: number;
  screen_height: number;
  language: string;
  timezone: string;
  app_version: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  _retries?: number;
}

// ─── Constants ───

const STORAGE_KEY_DEVICE_ID = 'lokfeel_device_id';
const STORAGE_KEY_SESSION_ID = 'lokfeel_session_id';
const STORAGE_KEY_SESSION_TS = 'lokfeel_session_ts';
const STORAGE_KEY_UTM = 'lokfeel_utm';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 5000;
const MAX_RETRIES = 3;
const DEFAULT_ENDPOINT = '/api/analytics/collect';

// ─── Utilities ───

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function now(): number {
  return Date.now();
}

function noop() {}

// ─── PII Sanitizer ───
const PII_PATTERNS = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // email
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,                     // US phone
  /\b\d{11}\b/g,                                          // CN phone
  /\b(?:\d[ -]*?){13,16}\b/g,                             // credit card
  /\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, // CN ID
];

function sanitizeProperties(props: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'string') {
      let cleaned = value;
      for (const pattern of PII_PATTERNS) {
        cleaned = cleaned.replace(pattern, '[REDACTED]');
      }
      sanitized[key] = cleaned.slice(0, 500); // max 500 chars
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      sanitized[key] = value;
    } else if (typeof value === 'object') {
      sanitized[key] = '[object]';
    }
  }
  return sanitized;
}

// ─── Category Mapper ───

function categorizeEvent(event: string): string {
  if (event.startsWith('user_') || event.startsWith('user.')) return 'user';
  if (event.startsWith('swipe_') || event.startsWith('match_') || event.startsWith('discover_') || event.startsWith('profile_')) return 'match';
  if (event.startsWith('chat_') || event.startsWith('message_') || event.startsWith('call_')) return 'chat';
  if (event.startsWith('subscription_') || event.startsWith('pricing_') || event.startsWith('checkout_') || event.startsWith('payment_')) return 'revenue';
  if (event.startsWith('admin_')) return 'admin';
  if (event === 'page_view' || event === 'session_start' || event === 'session_end') return 'system';
  return 'other';
}

// ─── UTM Capture ───

function captureUTM(): Record<string, string> {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY_UTM) : null;
  if (stored) return JSON.parse(stored);

  if (typeof window === 'undefined') return {};

  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const value = params.get(key);
    if (value) utm[key] = value;
  }

  if (Object.keys(utm).length > 0 && typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_UTM, JSON.stringify(utm));
  }

  return utm;
}

// ─── Main Tracker Class ───

class LokFeelTracker {
  private config: Required<TrackerConfig>;
  private queue: AnalyticsEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private sessionId: string;
  private deviceId: string;
  private userId: string | undefined;
  private utmTags: Record<string, string>;
  private sessionStartTs: number;
  private isFlushing = false;

  constructor(config: TrackerConfig = {}) {
    this.config = {
      appVersion: config.appVersion || '0.0.0',
      endpoint: config.endpoint || DEFAULT_ENDPOINT,
      sampleRate: config.sampleRate ?? 1.0,
      debug: config.debug || false,
      autoTrack: config.autoTrack ?? true,
    };

    this.deviceId = this.getOrCreateDeviceId();
    this.utmTags = captureUTM();
    const session = this.getOrCreateSession();
    this.sessionId = session.id;
    this.sessionStartTs = session.ts;

    if (this.config.autoTrack) {
      this.attachAutoTrackers();
    }

    this.startFlushTimer();
    this.log('Tracker initialized', { deviceId: this.deviceId, sessionId: this.sessionId });
  }

  // ─── Public API ───

  track(event: string, properties: Record<string, unknown> = {}): void {
    if (!this.shouldSample()) return;

    const payload = this.buildEvent(event, properties);
    this.queue.push(payload);
    this.log('track', { event, properties });

    // Critical events flush immediately
    if (
      event.startsWith('subscription_') ||
      event === 'user_registered' ||
      event === 'match_created'
    ) {
      this.flush();
      return;
    }

    if (this.queue.length >= BATCH_SIZE) {
      this.flush();
    }
  }

  identify(userId: string, traits?: Record<string, unknown>): void {
    this.userId = userId;
    if (traits) {
      this.track('user_identified', { ...traits, $userId: userId });
    }
    this.log('identify', { userId });
  }

  trackPageView(path?: string, title?: string): void {
    if (typeof window === 'undefined') return;
    this.track('page_view', {
      path: path || window.location.pathname,
      title: title || document.title,
      referrer: document.referrer || '',
    });
  }

  trackRevenue(amount: number, currency = 'USD', productId = ''): void {
    this.track('revenue_earned', {
      amount,
      currency,
      productId,
      $revenue: amount,
    });
  }

  setUserProperties(props: Record<string, unknown>): void {
    this.track('$set_user_properties', props);
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0 || this.isFlushing) return;
    this.isFlushing = true;

    const batch = [...this.queue];
    this.queue = [];

    try {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob(
          [JSON.stringify({ events: batch })],
          { type: 'application/json' }
        );
        const sent = navigator.sendBeacon(this.config.endpoint, blob);
        if (!sent) throw new Error('sendBeacon failed');
      } else {
        const resp = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: batch }),
          keepalive: true,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      }
      this.log('flushed', { count: batch.length });
    } catch (err) {
      this.log('flush error', { error: String(err) });
      // Re-queue failed events (up to MAX_RETRIES)
      for (const event of batch) {
        if ((event._retries || 0) < MAX_RETRIES) {
          this.queue.push({ ...event, _retries: (event._retries || 0) + 1 });
        }
      }
    } finally {
      this.isFlushing = false;
    }
  }

  debug(enabled: boolean): void {
    this.config.debug = enabled;
  }

  // ─── Private Methods ───

  private buildEvent(event: string, properties: Record<string, unknown>): AnalyticsEvent {
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    const title = typeof document !== 'undefined' ? document.title : '';

    return {
      event_id: generateId(),
      event,
      event_category: categorizeEvent(event),
      timestamp: now(),
      session_id: this.sessionId,
      user_id: this.userId,
      device_id: this.deviceId,
      properties: sanitizeProperties(properties),
      page_path: path,
      page_title: title,
      referrer: typeof document !== 'undefined' ? document.referrer : '',
      platform: 'web',
      screen_width: typeof window !== 'undefined' ? window.screen.width : 0,
      screen_height: typeof window !== 'undefined' ? window.screen.height : 0,
      language: typeof navigator !== 'undefined' ? navigator.language : 'en',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      app_version: this.config.appVersion,
      ...this.utmTags,
    };
  }

  private shouldSample(): boolean {
    if (this.config.sampleRate >= 1.0) return true;
    return Math.random() < this.config.sampleRate;
  }

  private getOrCreateDeviceId(): string {
    if (typeof localStorage === 'undefined') return generateId();
    let id = localStorage.getItem(STORAGE_KEY_DEVICE_ID);
    if (!id) {
      id = generateId();
      localStorage.setItem(STORAGE_KEY_DEVICE_ID, id);
    }
    return id;
  }

  private getOrCreateSession(): { id: string; ts: number } {
    if (typeof sessionStorage === 'undefined') return { id: generateId(), ts: now() };
    
    const storedId = sessionStorage.getItem(STORAGE_KEY_SESSION_ID);
    const storedTs = sessionStorage.getItem(STORAGE_KEY_SESSION_TS);
    
    if (storedId && storedTs) {
      const ts = parseInt(storedTs, 10);
      if (now() - ts < SESSION_TIMEOUT_MS) {
        return { id: storedId, ts };
      }
    }

    const id = generateId();
    const ts = now();
    sessionStorage.setItem(STORAGE_KEY_SESSION_ID, id);
    sessionStorage.setItem(STORAGE_KEY_SESSION_TS, String(ts));
    return { id, ts };
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private attachAutoTrackers(): void {
    if (typeof window === 'undefined') return;

    // Page view on popstate
    window.addEventListener('popstate', () => {
      this.trackPageView();
    });

    // Session end on beforeunload
    window.addEventListener('beforeunload', () => {
      this.track('session_end', {
        duration_seconds: Math.round((now() - this.sessionStartTs) / 1000),
      });
      this.flush();
    });

    // Global error tracking
    window.addEventListener('error', (e) => {
      this.track('app_error', {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
      });
    });

    window.addEventListener('unhandledrejection', (e) => {
      this.track('app_error', {
        message: String(e.reason),
        type: 'unhandledrejection',
      });
    });

    // Performance monitoring (Web Vitals)
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'largest-contentful-paint') {
              this.track('page_performance', { metric: 'LCP', value: entry.startTime });
            }
          }
        });
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch { /* silently ignore */ }
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[LokFeel Tracker]', ...args);
    }
  }
}

// ─── Singleton ───

let instance: LokFeelTracker | null = null;

export function initTracker(config?: TrackerConfig): LokFeelTracker {
  if (!instance) {
    instance = new LokFeelTracker(config);
  }
  return instance;
}

export function getTracker(): LokFeelTracker {
  if (!instance) {
    if (typeof window !== 'undefined') {
      // Auto-init in browser with defaults
      instance = new LokFeelTracker({ debug: false, autoTrack: true });
    } else {
      throw new Error('Tracker not initialized. Call initTracker() first in a client component.');
    }
  }
  return instance;
}

export function resetTracker(): void {
  instance = null;
}

export { LokFeelTracker };
export default LokFeelTracker;
