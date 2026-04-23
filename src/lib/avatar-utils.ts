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
    color: parts[2] || '#6366f1',
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
      return 'linear-gradient(135deg, #f0f0ff, #e8e8f8)';
    case 'emoji': {
      const parsed = parseEmojiAvatar(avatar || '');
      if (parsed) {
        return `linear-gradient(135deg, ${parsed.color}30, ${parsed.color}15)`;
      }
      return 'linear-gradient(135deg, #f0f0ff, #e8e8f8)';
    }
    case 'photo':
      return '';
    default:
      return 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(168,85,247,0.15))';
  }
}
