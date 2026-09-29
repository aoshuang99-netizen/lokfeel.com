import type { NextConfig } from 'next'
import path from 'path'
// @sentry/nextjs v11 破坏性变更：withSentryConfig 从包根迁移到 "@sentry/nextjs/config"
// （sentry-javascript #23628 `ref(nextjs)!: Move withSentryConfig to @sentry/nextjs/config`）
// 根入口不再导出该符号，旧写法会让 tsc 报 TS2305。
import { withSentryConfig } from '@sentry/nextjs/config'

const CSP_VALUE = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' fonts.googleapis.com https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' fonts.googleapis.com fonts.gstatic.com",
  "font-src 'self' fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://api.dicebear.com https://images.unsplash.com https://randomuser.me https://picsum.photos https://lh3.googleusercontent.com https://pbs.twimg.com",
  // Removed 'unsafe-eval' (was a high-risk XSS vector). Added Creem, Firebase
  // and Pusher hosts so realtime auth/messaging/payments work under CSP.
  "connect-src 'self' https://*.stripe.com https://api.twitter.com https://twitter.com https://hooks.stripe.com https://accounts.google.com https://www.googleapis.com https://oauth2.googleapis.com https://securetoken.googleapis.com https://firebasestorage.googleapis.com https://firebaseinstallations.googleapis.com https://fcm.googleapis.com https://api.creem.io https://www.creem.io https://*.pusher.com wss://*.pusher.com",
  "frame-src 'self' https://js.stripe.com https://accounts.google.com https://content.googleapis.com",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com https://twitter.com",
  "object-src 'none'",
].join('; ')

const nextConfig: NextConfig = {
  // ─── 自托管构建产物（P1-1）───
  // Docker 自托管需要 standalone 输出（自包含的 server.js + 精简 node_modules）。
  // 用环境变量门控，避免影响现有云端部署链路（Vercel / Netlify / Cloudflare）。
  //   · Docker 构建：BUILD_TARGET=standalone（见 Dockerfile）
  //   · 云端部署：不设置该变量 → 保持 Next.js 默认输出
  output: process.env.BUILD_TARGET === 'standalone' ? 'standalone' : undefined,

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
      // DiceBear API — Reliable avatar CDN (REPLACES Unsplash)
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
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
    // Cloudflare Workers: next/image optimization requires the (paid) Cloudflare
    // Images binding. On the Workers Free plan we serve images unoptimized —
    // remote hosts (DiceBear/Google/Twitter) are already allowed by the CSP.
    unoptimized: true,
    // Dangerously allow SVG — REQUIRED for DiceBear avatars
    // DiceBear returns SVG (Content-Type: image/svg+xml) which next/image
    // silently rejects when dangerouslyAllowSVG=false, causing blank avatars
    dangerouslyAllowSVG: true,
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
        // NextAuth v5 cookie name is `authjs.session-token` (v4 used
        // `next-auth.session-token`). Must match or the logged-in redirect
        // never fires.
        has: [{ type: 'cookie', key: 'authjs.session-token' }],
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
  // admin.lokfeel.com → /admin-login (bypasses admin auth)
  // Deploy: Add CNAME record "admin.lokfeel.com" → your Vercel domain
  async rewrites() {
    return [
      {
        // Redirect admin root to login page (which is now at /admin-login)
        source: '/',
        has: [{ type: 'host', value: 'admin.lokfeel.com' }],
        destination: '/admin-login',
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
          // 2026-09-29 修复：原值 `camera=(), microphone=(), geolocation=()` 是**空允许列表**，
          // 语义是"对所有来源（含 self）一律禁用"—— 不是"不限制"。
          // 实测（Playwright 在 app.lokfeel.com 页面上下文 + 已自动授权 + 合成摄像头）：
          //   document.featurePolicy.allowsFeature('camera') === false
          //   navigator.mediaDevices.getUserMedia({video,audio}) → NotAllowedError
          // 即 WebRTC 视频通话与定位功能在线上被这条响应头**整体禁掉**。
          // 改为 (self)：仅本域可用，跨域嵌入方仍被拒绝。
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self)' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          {
            key: 'Content-Security-Policy',
            value: CSP_VALUE,
          },
        ],
      },
      // ─── Public ISR pages: allow CDN caching ───
      // Without this, Vercel defaults to max-age=0, preventing Cloudflare
      // from caching the response (cf-cache-status: DYNAMIC)
      // s-maxage controls CDN cache; stale-while-revalidate allows serving
      // slightly stale content while Vercel regenerates ISR in background
      {
        source: '/',
        headers: [
          { key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=86400' },
        ],
      },
      {
        source: '/login',
        headers: [
          { key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=86400' },
        ],
      },
      {
        source: '/register',
        headers: [
          { key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=86400' },
        ],
      },
      // Default API: no caching (for mutation-heavy endpoints)
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      // Read-only API endpoints: allow CDN/browser caching
      // TTLs match Redis cache layer TTLs to prevent stale data
      {
        source: '/api/discover',
        headers: [
          { key: 'Cache-Control', value: 'private, max-age=60, stale-while-revalidate=120' },
        ],
      },
      {
        source: '/api/settings',
        headers: [
          { key: 'Cache-Control', value: 'private, max-age=300, stale-while-revalidate=600' },
        ],
      },
      {
        source: '/api/who-liked-me',
        headers: [
          { key: 'Cache-Control', value: 'private, max-age=60, stale-while-revalidate=120' },
        ],
      },
      {
        source: '/api/health',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=60, stale-while-revalidate=86400' },
          { key: 'Surrogate-Control', value: 'public, max-age=60' },
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
      // Open Graph image: cache 1 day, stale-while-revalidate 7 days
      {
        source: '/opengraph-image',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
      // Sitemap & robots: cache 1 hour
      {
        source: '/sitemap.xml',
        headers: [
          { key: 'Cache-Control', value: 'public, s-maxage=3600, stale-while-revalidate=86400' },
        ],
      },
      {
        source: '/robots.txt',
        headers: [
          { key: 'Cache-Control', value: 'public, s-maxage=3600, stale-while-revalidate=86400' },
        ],
      },
    ]
  },
  
  // ─── Compress responses ───
  compress: true,
  
  // Keep heavy server-only packages out of client bundle
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-libsql', '@libsql/client', 'libsql', 'bcryptjs', 'stripe', 'firebase-admin'],

  // ─── 强制把 firebase-admin 整包纳入这两条路由的函数包 ───
  // 背景（2026-09-29 线上事故）：firebase-admin 在 serverExternalPackages 里，**不参与打包**，
  // 它的文件只能靠 Next 的文件追踪（nft）被带进 serverless bundle。v13 的根入口 index 会把
  // 所有子模块 require 一遍，于是追踪顺带带走了整包；v14 把根入口收窄成只有 app 层导出，
  // 我们改为显式引入子路径 `firebase-admin/auth` 之后，就出现了"包在本地存在、函数包里却加载
  // 失败"的情况 —— 表现为 /api/diagnostic/firebase 从 403 变 500，且**构建期不报错**。
  // 这里显式声明包含（该包仅 1.9MB / 244 个文件，代价可忽略）。
  outputFileTracingIncludes: {
    '/api/diagnostic/firebase': ['./node_modules/firebase-admin/**/*'],
    '/api/health': ['./node_modules/firebase-admin/**/*'],
  },

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

// OpenNext Cloudflare adapter: enables Cloudflare bindings during `next dev`.
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
initOpenNextCloudflareForDev()
