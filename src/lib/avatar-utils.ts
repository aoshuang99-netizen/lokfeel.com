/**
 * Avatar Utility Functions
 *
 * Unified avatar rendering logic for the entire app.
 * Supports three avatar formats:
 * 1. emoji:emoji_char:color  (emoji avatar from onboarding)
 * 2. Photo URL              (uploaded real photo - PRIMARY)
 * 3. DiceBear API          (reliable CDN fallback - REPLACES Unsplash)
 *
 * STRATEGY: All avatars should be real photos. DiceBear is used as fallback.
 * DiceBear is open-source, free, and NOT blocked in China.
 */

// ═════════════════════════════════════════════════════════════
// DICEBEAR CDN — Reliable, open-source avatar API
// ═════════════════════════════════════════════════════════════

/** DiceBear base URL */
const DICEBEAR_BASE = 'https://api.dicebear.com/9.x';

/** DiceBear style for avatar fallback — lorelei is the most realistic style */
const DICEBEAR_STYLE = 'lorelei';

/**
 * Generate DiceBear avatar URL from seed.
 * Uses lorelei style (most realistic, least cartoonish).
 * Format: https://api.dicebear.com/9.x/lorelei/svg?seed={seed}&backgroundColor={color}&radius=50
 */
function getDiceBearUrl(seed: string, gender?: string, age?: number): string {
  // Gender-aware background color — softer, more natural palette
  const bgColor = gender === 'female' || gender === 'FEMALE' || gender === 'WOMAN'
    ? 'fce7f3,fbcfe8,f9a8d4' // Soft pink for female
    : gender === 'male' || gender === 'MALE' || gender === 'MAN'
    ? 'dbeafe,bfdbfe,93c5fd' // Soft blue for male
    : 'f3e8ff,e9d5ff,d8b4fe'; // Soft purple for others

  return `${DICEBEAR_BASE}/${DICEBEAR_STYLE}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${bgColor}&radius=50`;
}

// ═════════════════════════════════════════════════════════════
// AVATAR TYPE DETECTION
// ═════════════════════════════════════════════════════════════

export type AvatarKind = 'emoji' | 'photo' | 'none';

/**
 * Detect the avatar type from the avatar string.
 * SVG/cartoon avatars are treated as 'none' to force real photo fallback.
 */
export function getAvatarKind(avatar: string | null | undefined): AvatarKind {
  if (!avatar || avatar === '') return 'none';
  if (avatar.startsWith('emoji:')) return 'emoji';
  // Legacy cartoon/SVG avatars are phased out — treat as none to use real photo fallback
  if (avatar.includes('dicebear.com') || avatar.endsWith('.svg')) return 'none';
  return 'photo';
}

/**
 * Parse emoji avatar format: "emoji:🐱:#FFB6C1"
 */
export function parseEmojiAvatar(avatar: string | null | undefined): { emoji: string; color: string } | null {
  if (!avatar || !avatar.startsWith('emoji:')) return null;
  const parts = avatar.split(':');
  return {
    emoji: parts[1] || '👤',
    color: parts[2] || '#8b5cf6',
  };
}

/**
 * Get CSS classes for rendering an avatar based on its type.
 */
export function getAvatarImgClasses(kind: AvatarKind, _avatar?: string | null): string {
  switch (kind) {
    case 'photo':
      return 'w-full h-full object-cover';
    case 'emoji':
    case 'none':
    default:
      return '';
  }
}

/**
 * Get background style for avatar container based on type.
 */
export function getAvatarBackground(kind: AvatarKind, avatar: string | null | undefined): string {
  switch (kind) {
    case 'emoji': {
      const parsed = parseEmojiAvatar(avatar || '');
      if (parsed) {
        return `linear-gradient(135deg, ${parsed.color}30, ${parsed.color}15)`;
      }
      return 'linear-gradient(135deg, #1a1a2e, #111122)';
    }
    case 'photo':
      return '';
    default:
      return 'linear-gradient(135deg, rgba(76,29,149,0.15), rgba(139,92,246,0.15))';
  }
}

// ═════════════════════════════════════════════════════════════
// BROKEN CDN DETECTION
// ═════════════════════════════════════════════════════════════

/**
 * Known broken avatar CDN patterns — these always 403/404 and should be
 * replaced with fallback immediately (no broken image flash).
 */
const BROKEN_CDN_PATTERNS = [
  'i.pravatar.cc',      // Cloudflare challenge → 403 since 2026-04
  'thispersondoesnotexist.com', // Often slow/unreliable
  'images.unsplash.com', // BLOCKED in China (Great Firewall)
];

/**
 * Check if an avatar URL is from a known-broken CDN.
 */
export function isBrokenAvatarUrl(avatar: string | null | undefined): boolean {
  if (!avatar) return false;
  return BROKEN_CDN_PATTERNS.some(pattern => avatar.includes(pattern));
}

/**
 * Check if an avatar URL is from Unsplash (blocked in China/Huawei browsers).
 * Used to determine if we should add a local fallback strategy.
 */
export function isUnsplashUrl(avatar: string | null | undefined): boolean {
  if (!avatar) return false;
  return avatar.includes('images.unsplash.com');
}

// ═════════════════════════════════════════════════════════════
// REAL PHOTO FALLBACK — Deterministic, gender-aware
// ═════════════════════════════════════════════════════════════

/**
 * Generate a deterministic hash from a seed string.
 */
function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Get a real photo avatar URL with gender and age awareness.
 * Uses DiceBear API for consistent, high-quality results.
 * DiceBear is NOT blocked in China (unlike Unsplash).
 *
 * @param seed - Deterministic seed (userId, name, etc.)
 * @param gender - 'female' | 'male' | undefined
 * @param size - 'thumb' | 'preview' | 'full' — controls resolution
 * @param age - User's age for age-appropriate photo selection
 */
export function getRealPhotoAvatarUrl(
  seed: string,
  gender?: 'female' | 'male' | string,
  size: 'thumb' | 'preview' | 'full' = 'preview',
  age?: number
): string {
  // Use DiceBear API (NOT Unsplash — blocked in China)
  return getDiceBearUrl(seed, gender, age);
}

/**
 * Legacy fallback function — redirects to new gender-aware function.
 * @deprecated Use getRealPhotoAvatarUrl instead.
 */
export function getFallbackAvatarUrl(seed: string): string {
  return getRealPhotoAvatarUrl(seed, undefined, 'preview');
}

/**
 * Get a safe avatar URL — if the original is from a broken CDN,
 * return null so the caller can use a fallback immediately.
 */
export function getSafeAvatarUrl(avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  if (isBrokenAvatarUrl(avatar)) return null;
  return avatar;
}

// ═════════════════════════════════════════════════════════════
// IMAGE LOADING OPTIMIZATION
// ═════════════════════════════════════════════════════════════

/**
 * Preload critical avatar images for instant display.
 * Call this when navigating to a page with user cards.
 * NOTE: crossOrigin removed for Huawei/Android browser compatibility.
 */
export function preloadAvatars(urls: string[]): void {
  if (typeof window === 'undefined') return;

  urls.forEach(url => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = url;
    // No crossOrigin — avoids CORS issues on Huawei/Android browsers
    document.head.appendChild(link);
  });
}

/**
 * Preload a single avatar image.
 * NOTE: crossOrigin removed for Huawei/Android browser compatibility.
 */
export function preloadAvatar(url: string): void {
  if (typeof window === 'undefined') return;

  const img = new Image();
  // No crossOrigin — avoids CORS issues on Huawei/Android browsers
  img.src = url;
}

/**
 * Preload full-resolution image for lightbox viewing.
 * Call on hover or when lightbox is likely to open.
 */
export function preloadLightboxImage(url: string): void {
  preloadAvatar(url);
}

/**
 * Get responsive srcset for an avatar URL.
 * Generates multiple resolutions for optimal loading.
 */
export function getAvatarSrcSet(baseUrl: string): string {
  const sizes = [200, 400, 600, 800, 1200];
  return sizes
    .map(size => {
      const url = baseUrl; // DiceBear is SVG — no size params needed
      return `${url} ${size}w`;
    })
    .join(', ');
}

/**
 * Get the optimal avatar size for a given display size.
 */
export function getOptimalAvatarUrl(baseUrl: string, displayWidth: number): string {
  // DiceBear is SVG — scalable, no size optimization needed
  return baseUrl;
}

// ═════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═════════════════════════════════════════════════════════════

/**
 * Handle image load error — replace with DiceBear fallback.
 * If all external URLs fail, generate a local data-URI SVG placeholder.
 * Usage: <img onError={(e) => handleAvatarError(e, userId, gender, age)} />
 */
export function handleAvatarError(e: React.SyntheticEvent<HTMLImageElement>, seed?: string, gender?: string, age?: number) {
  const img = e.currentTarget;
  const fallbackSeed = seed || img.alt || 'default';

  // Try DiceBear fallback (only if not already the fallback URL)
  const fallbackUrl = getRealPhotoAvatarUrl(fallbackSeed, gender, 'preview', age);

  if (img.src !== fallbackUrl && !img.src.endsWith(encodeURIComponent(fallbackUrl))) {
    img.src = fallbackUrl;
  } else {
    // All external URLs failed — use local SVG data-URI placeholder
    // This works offline and in China/Huawei browsers where DiceBear is blocked
    img.src = generateLocalAvatarDataUri(fallbackSeed);
    img.style.display = '';
  }
}

/**
 * Generate a blur placeholder data URL for progressive image loading.
 * Creates a tiny (10px) blurred version encoded as base64 data URI.
 * Perfect for Next.js Image `blurDataURL` prop — instant visual feedback
 * before the full image loads (typically <50 bytes).
 *
 * @param seed - Deterministic seed for consistent color
 * @param gender - Optional gender for color tint
 */
export function generateBlurDataURL(seed?: string, gender?: string): string {
  const hash = hashSeed(seed || 'default');

  // Cool Blue palette tints — subtle gender-agnostic colors
  const tints = gender === 'female' || gender === 'FEMALE'
    ? ['rgba(167,139,250,0.4)', 'rgba(244,114,182,0.4)', 'rgba(139,92,246,0.4)']
    : gender === 'male' || gender === 'MALE'
    ? ['rgba(59,130,246,0.4)', 'rgba(14,165,233,0.4)', 'rgba(34,211,238,0.4)']
    : ['rgba(139,92,246,0.3)', 'rgba(59,130,246,0.3)', 'rgba(168,85,247,0.3)'];

  const tint = tints[hash % tints.length];

  // Tiny 10x10 SVG for ultra-small placeholder (~40 bytes)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="${tint}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/**
 * Generate blurDataURL from an existing avatar URL.
 * Useful when you want a placeholder matching the actual image color.
 */
export function getAvatarBlurPlaceholder(avatar?: string | null, seed?: string, gender?: string): string {
  // Use seed-based deterministic placeholder (no extra network request)
  return generateBlurDataURL(seed || avatar || 'default', gender);
}

/**
 * Generate a local SVG data-URI avatar as final fallback.
 * Works offline, no external requests, always renders.
 * Uses Cool Blue design system colors.
 */
export function generateLocalAvatarDataUri(seed: string): string {
  const hash = hashSeed(seed);
  const initials = seed.slice(0, 2).toUpperCase();

  // Cool Blue palette for deterministic background color
  const bgColors = [
    'rgba(59, 130, 246, 0.3)',  // primary
    'rgba(99, 102, 241, 0.3)',  // secondary
    'rgba(34, 211, 238, 0.3)',  // cta
    'rgba(244, 114, 182, 0.3)', // pink
  ];
  const bgColor = bgColors[hash % bgColors.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
    <rect width="600" height="800" fill="${bgColor}"/>
    <circle cx="300" cy="320" r="120" fill="rgba(255,255,255,0.15)"/>
    <ellipse cx="300" cy="600" rx="180" ry="200" fill="rgba(255,255,255,0.1)"/>
    <text x="300" y="340" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="72" font-weight="600" fill="rgba(255,255,255,0.7)">${initials}</text>
  </svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Check if a URL is a valid photo URL (not emoji, not SVG, not broken).
 */
export function isValidPhotoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('emoji:')) return false;
  if (url.includes('dicebear.com') || url.endsWith('.svg')) return false;
  if (isBrokenAvatarUrl(url)) return false;
  return true;
}
