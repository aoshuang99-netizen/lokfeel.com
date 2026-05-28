import * as React from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'

/**
 * Avatar Component — Optimized with next/image
 * 
 * Performance improvements over native <img>:
 * 1. Automatic AVIF/WebP format negotiation
 * 2. Responsive srcset for different viewport sizes
 * 3. Lazy loading by default (above-fold can opt out)
 * 4. Blur placeholder while loading
 * 5. Prevents layout shift with explicit dimensions
 */

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null
  alt?: string
  fallback?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  /** Set to true for above-fold avatars that should load eagerly */
  priority?: boolean
}

const sizeConfig = {
  sm: { px: 32, cls: 'h-8 w-8 text-xs' },
  md: { px: 40, cls: 'h-10 w-10 text-sm' },
  lg: { px: 48, cls: 'h-12 w-12 text-base' },
  xl: { px: 64, cls: 'h-16 w-16 text-lg' },
  '2xl': { px: 96, cls: 'h-24 w-24 text-xl' },
}

/**
 * Detect if a URL is compatible with next/image optimization.
 * - External URLs need to be in next.config.ts remotePatterns
 * - Data URLs and emoji strings need native <img> fallback
 * - SVG URLs should use native <img> for animation support
 */
function useNextImage(src: string | null | undefined): boolean {
  if (!src) return false
  
  // Data URLs: base64 encoded images — too large for Image optimization, use native
  if (src.startsWith('data:')) return false
  
  // Emoji format: emoji:👩:#FF6B6B — not a real image URL
  if (src.startsWith('emoji:')) return false
  
  // SVG: use native img to preserve animation
  if (src.endsWith('.svg')) return false
  
  // DiceBear API returns SVG (Content-Type: image/svg+xml)
  // next/image with dangerouslyAllowSVG:false silently rejects SVGs
  // → bypass next/image and use native <img> for all DiceBear URLs
  if (src.includes('api.dicebear.com')) return false
  
  // Blob URLs: local object URLs
  if (src.startsWith('blob:')) return false
  
  // HTTP(S) URLs: eligible for next/image optimization
  return src.startsWith('http://') || src.startsWith('https://')
}

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, src, alt, fallback, size = 'md', priority = false, ...props }, ref) => {
    const [error, setError] = React.useState(false)
    const config = sizeConfig[size]

    const initials = fallback
      ?.split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '??'

    const canOptimize = useNextImage(src)

    // Real photo fallback when image fails to load
    // Use DiceBear lorelei API (most realistic style)
    const diceBearSeed = alt || fallback || 'default'
    const realPhotoFallback = `https://api.dicebear.com/9.x/lorelei/svg?seed=${encodeURIComponent(diceBearSeed)}&backgroundColor=dbeafe,bfdbfe,93c5fd,f3e8ff,e9d5ff,d8b4fe&radius=50`

    return (
      <div
        ref={ref}
        className={cn(
          'relative inline-flex items-center justify-center rounded-full overflow-hidden bg-muted',
          config.cls,
          className
        )}
        {...props}
      >
        {src && !error ? (
          canOptimize ? (
            <Image
              src={src}
              alt={alt || 'Avatar'}
              width={config.px}
              height={config.px}
              className="h-full w-full object-cover"
              onError={() => setError(true)}
              priority={priority}
              loading={priority ? 'eager' : 'lazy'}
              sizes={`${config.px}px`}
            />
          ) : (
            <img
              src={src}
              alt={alt || 'Avatar'}
              className="h-full w-full object-cover"
              onError={(e) => {
                const img = e.currentTarget
                if (img.src !== realPhotoFallback) {
                  img.src = realPhotoFallback
                } else {
                  setError(true)
                }
              }}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
            />
          )
        ) : (
          <span className="font-medium text-muted-foreground">{initials}</span>
        )}
      </div>
    )
  }
)
Avatar.displayName = 'Avatar'

interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  max?: number
}

const AvatarGroup = React.forwardRef<HTMLDivElement, AvatarGroupProps>(
  ({ className, children, max, ...props }, ref) => {
    const childrenArray = React.Children.toArray(children)
    const displayChildren = max ? childrenArray.slice(0, max) : childrenArray
    const remaining = max && childrenArray.length > max ? childrenArray.length - max : 0
    
    return (
      <div ref={ref} className={cn('flex -space-x-2', className)} {...props}>
        {displayChildren}
        {remaining > 0 && (
          <div className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted ring-2 ring-background">
            <span className="text-xs font-medium text-muted-foreground">+{remaining}</span>
          </div>
        )}
      </div>
    )
  }
)
AvatarGroup.displayName = 'AvatarGroup'

export { Avatar, AvatarGroup }
