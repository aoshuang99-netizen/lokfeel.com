/* ═══════════════════════════════════════════════════════════════
   LOKFEEL BRAND LOGO
   Heart-fluttering, elegant, memorable brand mark
   ═══════════════════════════════════════════════════════════════ */

interface LokFeelLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showText?: boolean
  animated?: boolean
  className?: string
}

export function LokFeelLogo({ 
  size = 'md', 
  showText = true, 
  animated = true,
  className = '' 
}: LokFeelLogoProps) {
  const sizes = {
    sm: { icon: 24, text: 'text-base', gap: 'gap-1.5' },
    md: { icon: 32, text: 'text-xl', gap: 'gap-2' },
    lg: { icon: 40, text: 'text-2xl', gap: 'gap-2.5' },
    xl: { icon: 48, text: 'text-3xl', gap: 'gap-3' },
  }

  const { icon, text, gap } = sizes[size]

  return (
    <div className={`flex items-center ${gap} ${className}`}>
      {/* Icon Container */}
      <div 
        className={`relative flex items-center justify-center ${animated ? 'group' : ''}`}
        style={{ width: icon, height: icon }}
      >
        {/* Background glow */}
        <div 
          className={`absolute inset-0 rounded-xl bg-gradient-to-br from-rose-500/20 via-purple-500/20 to-amber-500/20 ${animated ? 'animate-pulse-slow' : ''}`}
        />
        
        {/* Heartbeat ring */}
        {animated && (
          <div className="absolute inset-0 rounded-xl border border-rose-400/30 animate-heartbeat-ring" />
        )}
        
        {/* Main icon background */}
        <div 
          className="absolute inset-0 rounded-xl bg-gradient-to-br from-rose-500 via-purple-600 to-amber-500"
          style={{ 
            background: 'linear-gradient(135deg, #f43f5e 0%, #9333ea 50%, #f59e0b 100%)' 
          }}
        />
        
        {/* Inner glow */}
        <div className="absolute inset-[1px] rounded-[10px] bg-gradient-to-br from-white/20 to-transparent" />
        
        {/* Heart SVG */}
        <svg 
          width={icon * 0.55} 
          height={icon * 0.55} 
          viewBox="0 0 24 24" 
          fill="none"
          className={`relative z-10 ${animated ? 'animate-gentle-pulse' : ''}`}
        >
          <defs>
            <linearGradient id="heartGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fff" />
              <stop offset="100%" stopColor="#ffe4e6" />
            </linearGradient>
          </defs>
          <path 
            d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
            fill="url(#heartGradient)"
          />
        </svg>
        
        {/* Sparkle accents */}
        {animated && (
          <>
            <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-300 animate-sparkle" />
            <div className="absolute -bottom-0.5 -left-0.5 w-1 h-1 rounded-full bg-rose-300 animate-sparkle-delayed" />
          </>
        )}
      </div>

      {/* Text */}
      {showText && (
        <span className={`font-bold tracking-tight ${text}`}>
          <span className="bg-gradient-to-r from-rose-500 via-purple-600 to-amber-500 bg-clip-text text-transparent">
            LokFeel
          </span>
        </span>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   LOKFEEL WORDMARK
   For footer and subtle placements
   ═══════════════════════════════════════════════════════════════ */
export function LokFeelWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`}>
      <span className="text-rose-500">Lok</span>
      <span className="text-purple-600">Feel</span>
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════════
   APP ICON (for download badges)
   ═══════════════════════════════════════════════════════════════ */
export function LokFeelAppIcon({ size = 64 }: { size?: number }) {
  return (
    <div 
      className="relative rounded-2xl overflow-hidden shadow-2xl"
      style={{ width: size, height: size }}
    >
      {/* Gradient background */}
      <div 
        className="absolute inset-0"
        style={{ 
          background: 'linear-gradient(135deg, #f43f5e 0%, #9333ea 50%, #f59e0b 100%)' 
        }}
      />
      
      {/* Inner gradient overlay */}
      <div 
        className="absolute inset-0 opacity-50"
        style={{
          background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.3) 0%, transparent 60%)'
        }}
      />
      
      {/* Heart */}
      <div className="absolute inset-0 flex items-center justify-center">
        <svg 
          width={size * 0.5} 
          height={size * 0.5} 
          viewBox="0 0 24 24" 
          fill="white"
        >
          <path 
            d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
          />
        </svg>
      </div>
      
      {/* Gloss effect */}
      <div 
        className="absolute top-0 left-0 right-0 h-1/2 rounded-t-2xl"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 100%)'
        }}
      />
    </div>
  )
}
