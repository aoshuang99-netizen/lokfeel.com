/**
 * Avatar Utility Functions
 * 
 * Unified avatar rendering logic for the entire app.
 * Supports three avatar formats:
 * 1. emoji:emoji_char:color  (emoji avatar from onboarding)
 * 2. DiceBear SVG URL       (illustration/generated avatar)
 * 3. Photo URL              (uploaded real photo)
 */

/**
 * Detect the avatar type from the avatar string
 */
export type AvatarKind = 'emoji' | 'svg' | 'photo' | 'none';

export function getAvatarKind(avatar: string | null | undefined): AvatarKind {
  if (!avatar || avatar === '') return 'none';
  if (avatar.startsWith('emoji:')) return 'emoji';
  if (avatar.includes('dicebear.com') || avatar.endsWith('.svg')) return 'svg';
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
 * - photo: object-cover (fills container, crops as needed)
 * - svg: object-contain with padding (shows full illustration)
 * - emoji: flex centered (emoji centered with colored background)
 */
export function getAvatarImgClasses(kind: AvatarKind, _avatar?: string | null): string {
  switch (kind) {
    case 'photo':
      return 'w-full h-full object-cover';
    case 'svg':
      return 'w-full h-full object-contain p-3';
    case 'emoji':
    case 'none':
    default:
      return '';
  }
}

/**
 * Get background style for avatar container based on type.
 * SVG and emoji need a colored background to look good.
 */
export function getAvatarBackground(kind: AvatarKind, avatar: string | null | undefined): string {
  switch (kind) {
    case 'svg':
      return 'linear-gradient(135deg, #1a1a2e, #111122)';
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

/**
 * Known broken avatar CDN patterns — these always 403/404 and should be 
 * replaced with fallback immediately (no broken image flash).
 */
const BROKEN_CDN_PATTERNS = [
  'i.pravatar.cc',  // Cloudflare challenge → 403 since 2026-04
];

/**
 * Check if an avatar URL is from a known-broken CDN.
 * Returns true if the URL should be treated as unavailable.
 */
export function isBrokenAvatarUrl(avatar: string | null | undefined): boolean {
  if (!avatar) return false;
  return BROKEN_CDN_PATTERNS.some(pattern => avatar.includes(pattern));
}

/**
 * Generate a fallback avatar URL — 使用默认占位符
 * 不再使用 DiceBear 卡通 SVG
 */
export function getFallbackAvatarUrl(seed: string): string {
  // 返回一个透明的 1x1 像素 GIF (data URL)
  // 调用方会显示默认背景
  return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
}

/**
 * Handle image load error — hide broken image and show fallback.
 * Usage: <img onError={handleAvatarError} />
 */
export function handleAvatarError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  img.style.display = 'none';
  // Show parent's fallback by triggering re-render
  const container = img.parentElement;
  if (container) {
    // Add a fallback initials badge
    const fallback = document.createElement('div');
    fallback.className = 'w-full h-full flex items-center justify-center bg-gradient-to-br from-primary to-secondary text-foreground font-bold';
    fallback.style.fontSize = 'clamp(0.7rem, 40%, 1.4rem)';
    fallback.textContent = '?';
    container.appendChild(fallback);
  }
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
