type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

export function rateLimit(options: {
  windowMs: number;
  max: number;
  key?: (request: Request) => string;
}) {
  return async (request: Request): Promise<{ success: boolean; remaining: number; resetAt: number }> => {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 
               request.headers.get('x-real-ip') || 
               'anonymous';
    const key = options.key ? options.key(request) : ip;
    
    const now = Date.now();
    const entry = rateLimitStore.get(key);
    
    if (entry && entry.resetAt > now) {
      if (entry.count >= options.max) {
        return { success: false, remaining: 0, resetAt: entry.resetAt };
      }
      entry.count++;
      return { success: true, remaining: options.max - entry.count, resetAt: entry.resetAt };
    }
    
    rateLimitStore.set(key, { count: 1, resetAt: now + options.windowMs });
    return { success: true, remaining: options.max - 1, resetAt: now + options.windowMs };
  };
}
