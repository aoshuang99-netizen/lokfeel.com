import type { NextConfig } from 'next'
import path from 'path'
import { withSentryConfig } from '@sentry/nextjs'

const CSP_VALUE = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' fonts.googleapis.com https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' fonts.googleapis.com fonts.gstatic.com",
  "font-src 'self' fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://images.unsplash.com https://randomuser.me https://picsum.photos https://lh3.googleusercontent.com https://pbs.twimg.com",
  "connect-src 'self' https://*.stripe.com https://api.twitter.com https://twitter.com https://hooks.stripe.com https://accounts.google.com https://www.googleapis.com https://oauth2.googleapis.com",
  "frame-src 'self' https://js.stripe.com https://accounts.google.com https://content.googleapis.com",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com https://twitter.com",
  "object-src 'none'",
].join('; ')

const nextConfig: NextConfig = {
  // Turbopack config (Next.js 16 default bundler)
  turbopack: {
    root: __dirname,
    resolveAlias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  
  // ─── Image Optimization ───
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'randomuser.me',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        pathname: '/**',
      },
      // Google OAuth avatars
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      // Twitter/X OAuth avatars
      {
        protocol: 'https',
        hostname: 'pbs.twimg.com',
        pathname: '/**',
      },
    ],
    // Prefer AVIF (smallest) then WebP, fallback to original
    formats: ['image/avif', 'image/webp'],
    // Cache optimized images for 24 hours on CDN (longer = faster repeat visits)
    minimumCacheTTL: 86400,
    // Device sizes for responsive srcset
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    // Image sizes for avatar/detail views
    imageSizes: [32, 48, 64, 96, 128, 256, 384, 512, 768],
    // Disable unoptimized images in production (always optimize)
    unoptimized: false,
    // Dangerously allow SVG (for emoji avatars if needed)
    dangerouslyAllowSVG: false,
  },
  
  // ─── Navigation Route Redirects ───
  // Redirect old navigation routes to new optimized routes
  async redirects() {
    return [
      // Home → Explore (primary navigation)
      {
        source: '/dashboard',
        destination: '/dashboard/explore',
        permanent: false,
        has: [{ type: 'cookie', key: 'next-auth.session-token' }],
      },
      // Discover → Explore
      {
        source: '/dashboard/discover',
        destination: '/dashboard/explore',
        permanent: true,
      },
      // Activity → Notifications
      {
        source: '/dashboard/activity',
        destination: '/dashboard/notifications',
        permanent: true,
      },
      // Chat → Chats
      {
        source: '/dashboard/chat',
        destination: '/dashboard/chats',
        permanent: true,
      },
      // Chat/[roomId] → Chats/[roomId] (dynamic route redirect)
      {
        source: '/dashboard/chat/:path*',
        destination: '/dashboard/chats/:path*',
        permanent: true,
      },
      // Matches → Connections (consolidated)
      {
        source: '/dashboard/matches',
        destination: '/dashboard/connections',
        permanent: true,
      },
      // Matches/[id] → Connections
      {
        source: '/dashboard/matches/:path*',
        destination: '/dashboard/connections',
        permanent: true,
      },
      // Who-liked-me → Connections
      {
        source: '/dashboard/who-liked-me',
        destination: '/dashboard/connections',
        permanent: true,
      },
      // Inbox → Chats
      {
        source: '/dashboard/inbox',
        destination: '/dashboard/chats',
        permanent: true,
      },
      // Messages → Chats
      {
        source: '/dashboard/messages',
        destination: '/dashboard/chats',
        permanent: true,
      },
      // Square → Explore (replaced by swipe cards)
      {
        source: '/dashboard/square',
        destination: '/dashboard/explore',
        permanent: true,
      },
    ]
  },

  // ─── Admin Domain Routing ───
  // admin.lokfeel.com → /admin/*
  // Deploy: Add CNAME record "admin.lokfeel.com" → your Vercel domain
  async rewrites() {
    return [
      {
        // Redirect admin root to dashboard
        source: '/',
        has: [{ type: 'host', value: 'admin.lokfeel.com' }],
        destination: '/admin',
      },
    ]
  },

  // ─── Security ───
  poweredByHeader: false,

  // ─── Headers for security + performance ───
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          {
            key: 'Content-Security-Policy',
            value: CSP_VALUE,
          },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      // Static assets: aggressive caching
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // Optimized images from next/image: cache 30 days with stale-while-revalidate
      {
        source: '/_next/image',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=2592000, stale-while-revalidate=604800' },
        ],
      },
      // Avatar images (Unsplash): cache 7 days
      {
        source: '/avatars/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=604800, immutable' },
        ],
      },
    ]
  },
  
  // ─── Compress responses ───
  compress: true,
  
  // Keep heavy server-only packages out of client bundle
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-libsql', '@libsql/client', 'libsql', 'bcryptjs', 'stripe', 'firebase-admin'],

  // ─── Tree-shaking for heavy UI/utility libraries ───
  experimental: {
    optimizePackageImports: [
      'framer-motion',
      'lucide-react',
      'recharts',
      'date-fns',
      'firebase',
      '@sentry/nextjs',
    ],
  },
  
  // Logging
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === 'development',
    },
  },
}

// Sentry wrapper
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
})
