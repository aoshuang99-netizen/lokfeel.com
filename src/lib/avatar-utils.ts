/**
 * Avatar Utility Functions
 *
 * Unified avatar rendering logic for the entire app.
 * Supports three avatar formats:
 * 1. emoji:emoji_char:color  (emoji avatar from onboarding)
 * 2. Photo URL              (uploaded real photo - PRIMARY)
 * 3. Legacy SVG (phased out) — treated as 'none' to trigger fallback
 *
 * STRATEGY: All avatars should be real photos. Cartoon/SVG is no longer supported.
 */

// ═══════════════════════════════════════════════════════════════
// REAL PHOTO POOL — High-quality curated portrait URLs
// NOTE: Unsplash URLs may be blocked in China/Huawei browsers.
// We keep them as Tier-2 fallback but prioritize local fallbacks.
// ═══════════════════════════════════════════════════════════════

/** Female portrait pool — Unsplash high-quality portraits */
const FEMALE_PHOTOS = [
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1463453091185-61582044d556?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1520813792240-56fc4a3765a7?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1523264939339-c89f9dadde2e?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1484515991647-c5760fcecfc7?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1502323777036-f29e3972d82f?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1519699047748-de8e457a634e?w=600&h=800&fit=crop&crop=face',
];

/** Male portrait pool — Unsplash high-quality portraits */
const MALE_PHOTOS = [
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1463453091185-61582044d556?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1502323777036-f29e3972d82f?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1519699047748-de8e457a634e?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1484515991647-c5760fcecfc7?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1523264939339-c89f9dadde2e?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&h=800&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1520813792240-56fc4a3765a7?w=600&h=800&fit=crop&crop=face',
];

/** Generic fallback pool — when gender is unknown */
const ALL_PHOTOS = [...FEMALE_PHOTOS, ...MALE_PHOTOS];

// ═══════════════════════════════════════════════════════════════
// AVATAR TYPE DETECTION
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// BROKEN CDN DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Known broken avatar CDN patterns — these always 403/404 and should be
 * replaced with fallback immediately (no broken image flash).
 */
const BROKEN_CDN_PATTERNS = [
  'i.pravatar.cc',      // Cloudflare challenge → 403 since 2026-04
  'thispersondoesnotexist.com', // Often slow/unreliable
];

/**
 * Check if an avatar URL is from a known-broken CDN.
 */
export function isBrokenAvatarUrl(avatar: string | null | undefined): boolean {
  if (!avatar) return false;
  return BROKEN_CDN_PATTERNS.some(pattern => avatar.includes(pattern));
}

/**
 * Check if an avatar URL is from Unsplash (may be blocked in China/Huawei browsers).
 * Used to determine if we should add a local fallback strategy.
 */
export function isUnsplashUrl(avatar: string | null | undefined): boolean {
  if (!avatar) return false;
  return avatar.includes('images.unsplash.com');
}

// ═══════════════════════════════════════════════════════════════
// REAL PHOTO FALLBACK — Deterministic, gender-aware
// ═══════════════════════════════════════════════════════════════

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
 * Get a real photo avatar URL with gender awareness.
 * Uses curated Unsplash portrait pool for consistent, high-quality results.
 *
 * @param seed - Deterministic seed (userId, name, etc.)
 * @param gender - 'female' | 'male' | undefined
 * @param size - 'thumb' | 'preview' | 'full' — controls resolution
 */
export function getRealPhotoAvatarUrl(
  seed: string,
  gender?: 'female' | 'male' | string,
  size: 'thumb' | 'preview' | 'full' = 'preview'
): string {
  const hash = hashSeed(seed);

  // Select pool based on gender
  let pool: string[];
  if (gender === 'female' || gender === 'FEMALE' || gender === 'WOMAN') {
    pool = FEMALE_PHOTOS;
  } else if (gender === 'male' || gender === 'MALE' || gender === 'MAN') {
    pool = MALE_PHOTOS;
  } else {
    pool = ALL_PHOTOS;
  }

  const photoUrl = pool[hash % pool.length];

  // Adjust resolution based on size parameter
  const sizeMap = {
    thumb: 'w=200&h=200&fit=crop&crop=face',
    preview: 'w=600&h=800&fit=crop&crop=face',
    full: 'w=1200&h=1600&fit=crop&crop=face',
  };

  // Replace size params in URL
  return photoUrl.replace(/w=\d+&h=\d+&fit=crop&crop=face/, sizeMap[size]);
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

// ═══════════════════════════════════════════════════════════════
// IMAGE LOADING OPTIMIZATION
// ═══════════════════════════════════════════════════════════════

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
  const fullResUrl = url.replace(/w=\d+&h=\d+/, 'w=1200&h=1600');
  preloadAvatar(fullResUrl);
}

/**
 * Get responsive srcset for an avatar URL.
 * Generates multiple resolutions for optimal loading.
 */
export function getAvatarSrcSet(baseUrl: string): string {
  const sizes = [200, 400, 600, 800, 1200];
  return sizes
    .map(size => {
      const url = baseUrl.replace(/w=\d+/, `w=${size}`).replace(/h=\d+/, `h=${Math.round(size * 1.33)}`);
      return `${url} ${size}w`;
    })
    .join(', ');
}

/**
 * Get the optimal avatar size for a given display size.
 */
export function getOptimalAvatarUrl(baseUrl: string, displayWidth: number): string {
  const size = Math.min(1200, Math.max(200, Math.ceil(displayWidth * 2 / 100) * 100));
  return baseUrl
    .replace(/w=\d+/, `w=${size}`)
    .replace(/h=\d+/, `h=${Math.round(size * 1.33)}`);
}

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════

/**
 * Handle image load error — replace with real photo fallback.
 * If all external URLs fail, generate a local data-URI SVG placeholder.
 * Usage: <img onError={(e) => handleAvatarError(e, userId, gender)} />
 */
export function handleAvatarError(e: React.SyntheticEvent<HTMLImageElement>, seed?: string, gender?: string) {
  const img = e.currentTarget;
  const fallbackSeed = seed || img.alt || 'default';

  // Try real photo fallback (only if not already the fallback URL)
  const fallbackUrl = getRealPhotoAvatarUrl(fallbackSeed, gender, 'preview');

  if (img.src !== fallbackUrl && !img.src.endsWith(encodeURIComponent(fallbackUrl))) {
    img.src = fallbackUrl;
  } else {
    // All external URLs failed — use local SVG data-URI placeholder
    // This works offline and in China/Huawei browsers where Unsplash is blocked
    img.src = generateLocalAvatarDataUri(fallbackSeed);
    img.style.display = '';
  }
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
