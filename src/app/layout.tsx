import type { Metadata } from "next";
import { Outfit, Sora } from "next/font/google";
import "./globals.css";

// Self-hosted fonts via next/font — eliminates Google Fonts CDN dependency
// Auto-optimizes: no CLS, no layout shift, no external request, works in China
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-outfit",
  display: "swap",
  preload: true,
});

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-sora",
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  metadataBase: new URL("https://lokfeel.com"),
  // V23 STRATEGY_LOCK §1/§4：对外只讲真实关系价值，不作通用 Agent OS 叙事，
  // 不宣称 "verified outcome"，不出现 MCP/A2A/WorkspaceSpec 等技术词。
  title: {
    default: "LokFeel — Conversations belong to people",
    template: "%s | LokFeel",
  },
  description:
    "LokFeel is where real people have conversations and stay in control of what they share. AI writing assistance is in private testing — never auto-sent, always yours to review.",
  keywords: [
    "AI communication assistant",
    "cross-language conversation",
    "private AI draft",
    "user-controlled consent",
    "real connections",
    "lokfeel",
  ],
  authors: [{ name: "LokFeel Team" }],
  creator: "LokFeel",
  publisher: "LokFeel",
  manifest: "/manifest.json",
  // 🔴 根布局**不许**声明 canonical / og:url（2026-11-14 · P1-1）。
  //    此前这里写死 `canonical: 'https://app.lokfeel.com'`，而 metadata 会被所有子页继承 ——
  //    于是 /pricing、/terms、/faq 等全部对外声明「正本是首页」，等于自请出索引。
  //    同样地，写死的 `openGraph.url` 会让每个子页的分享卡都指回首页。
  //    两者都删掉：不声明时搜索引擎以页面自身 URL 为准，比错误声明安全得多。
  //    需要显式 canonical 的页面请各自在 `export const metadata` 里声明自己的绝对 URL；
  //    守卫见 `tests/e2e-ci/smoke.spec.ts` ⑦（子页 canonical 若存在，必须等于自身 URL）。
  openGraph: {
    title: "LokFeel — Conversations belong to people",
    description:
      "Talk to real people and stay in control of what you share. AI writing assistance is being tested privately.",
    siteName: "LokFeel",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: 'https://app.lokfeel.com/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'LokFeel — Meet people worth knowing',
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "LokFeel — Meet people worth knowing",
    description:
      "Clearer relationship intent, explained introductions, and a real choice for both sides before anything is shared.",
    creator: "@lokfeel",
    images: ['https://app.lokfeel.com/opengraph-image'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID || '';

  return (
    <html lang="en" className={`h-full antialiased ${outfit.variable} ${sora.variable}`} suppressHydrationWarning>
      <head>
        {/* Google Tag Manager */}
        {gtmId && (
          <script
            id="gtm-script"
            dangerouslySetInnerHTML={{
              __html: `
(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${gtmId}');
              `.trim(),
            }}
          />
        )}

        {/* PWA Meta Tags */}
        <meta name="theme-color" content="#050a18" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="LokFeel" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />

        {/* Service Worker Registration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    var register = function() {
      navigator.serviceWorker.register('/sw.js').catch(function(err) {
        console.warn('SW registration failed:', err);
      });
    };
    // V21 第三批 · C01：SW 注册从「load 立即」改为「空闲后」。
    // 实测（Chrome Trace, 4x CPU 节流）：/sw.js 脚本自耗时可达 1002ms，
    // 外加 skipWaiting 272ms —— 全部落在首屏 TBT 窗口内。
    // PWA 离线缓存不是首屏必需能力，先让输入框与结果可交互，再装缓存。
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(register, { timeout: 5000 });
    } else {
      setTimeout(register, 3000);
    }
  });
}
            `.trim(),
          }}
        />

        {/* Preconnect for critical services — reduces TLS+DNS on cold start */}
        <link rel="preconnect" href="https://www.googletagmanager.com" />
        <link rel="preconnect" href="https://api.dicebear.com" />
        <link rel="preconnect" href="https://accounts.google.com" />
        <link rel="preconnect" href="https://www.googleapis.com" />
        <link rel="dns-prefetch" href="https://api.dicebear.com" />
        <link rel="dns-prefetch" href="https://accounts.google.com" />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        {/* Google Tag Manager (noscript) */}
        {gtmId && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
              height="0"
              width="0"
              style={{ display: 'none', visibility: 'hidden' }}
            />
          </noscript>
        )}
        {/* 🔴 V19.4（WB19-45）：LazyMotion 不再挂根布局。
            之前它把 framer-motion 运行时塞进全站共享 chunk —— /login 自己
            不用任何动画，却要为此加载；且全仓 m. 组件只存在于 (dashboard)。
            LazyMotion 已下放到 (dashboard)/dashboard-ui.tsx。
            注意：这里不能再包 LazyMotion，否则下放等于没做（双 provider 会
            掩盖漏挂问题，但 /login 的 JS 不会下降）。 */}
        {/* 🔴 R6-T7：SessionProvider 从根布局**下放**到真正用它的四棵子树
            （dashboard / workspace / console / admin）。
            实测依据：`useSession` 在 src 里只出现在 dashboard / workspace 组件，
            公开营销页一个都不用；而根布局挂 SessionProvider 会让每个营销页
            都下载 next-auth/react、并在水合后打一次 `/api/auth/session`。
            (dashboard) 本来就已经在 dashboard-ui.tsx 里自带 SessionProvider（且预置了服务端 session）。 */}
        {children}
      </body>
    </html>
  );
}
