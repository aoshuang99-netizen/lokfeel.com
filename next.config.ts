import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  // Turbopack config (Next.js 16 default bundler)
  turbopack: {
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
        hostname: 'api.dicebear.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'thispersondoesnotexist.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'xsgames.co',
        pathname: '/**',
      },
    ],
    // Prefer AVIF (smallest) then WebP, fallback to original
    formats: ['image/avif', 'image/webp'],
    // Cache optimized images for 60 minutes on CDN
    minimumCacheTTL: 3600,
    // Device sizes for responsive srcset
    deviceSizes: [640, 750, 828, 1080, 1200],
    // Image sizes for avatar/detail views
    imageSizes: [32, 48, 64, 96, 128, 256, 384],
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
      // Optimized images from next/image: cache 7 days
      {
        source: '/_next/image',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' },
        ],
      },
    ]
  },
  
  // ─── Compress responses ───
  compress: true,
  
  // Keep heavy server-only packages out of client bundle
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-libsql', '@libsql/client', 'libsql', 'bcryptjs', 'stripe'],
  
  // Logging
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === 'development',
    },
  },
}

export default nextConfig
