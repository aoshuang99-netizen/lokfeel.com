import { ImageResponse } from 'next/og'

/**
 * Dynamic Open Graph image generator (1200×630).
 * Served at /opengraph-image when social crawlers fetch og:image.
 *
 * Design: dark background, "LokFeel" in lime, tagline in white,
 * subtle purple gradient accent bar.
 */
export const runtime = 'edge'
export const alt = 'LokFeel — AI Relationship Matching Engine'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0a',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Subtle purple gradient accent — bottom bar */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 6,
            background: 'linear-gradient(90deg, #4c1d95 0%, #7c3aed 50%, #4c1d95 100%)',
          }}
        />

        {/* Subtle purple glow orb — top right */}
        <div
          style={{
            position: 'absolute',
            top: -120,
            right: -80,
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(76,29,149,0.25) 0%, transparent 70%)',
          }}
        />

        {/* Main content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
          }}
        >
          {/* Brand name */}
          <div
            style={{
              fontSize: 96,
              fontWeight: 800,
              color: '#a3e635',
              letterSpacing: -2,
              lineHeight: 1.1,
              fontFamily: 'sans-serif',
            }}
          >
            LokFeel
          </div>

          {/* Tagline */}
          <div
            style={{
              fontSize: 28,
              fontWeight: 400,
              color: '#e5e5e5',
              letterSpacing: 0.5,
              lineHeight: 1.4,
              fontFamily: 'sans-serif',
            }}
          >
            AI Relationship Matching Engine
          </div>

          {/* Accent dot */}
          <div
            style={{
              marginTop: 12,
              width: 48,
              height: 4,
              borderRadius: 2,
              background: 'linear-gradient(90deg, #a3e635, #f472b6)',
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
    },
  )
}
