import type { Metadata } from "next";
import { Outfit, Sora } from "next/font/google";
import "./globals.css";
import AuthProvider from "@/components/providers/auth-provider";
import { registerServiceWorker } from "@/lib/service-worker";

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
  title: {
    default: "LokFeel — AI Relationship Matching Engine",
    template: "%s | LokFeel",
  },
  description:
    "LokFeel's AI engine analyzes personality, values & chemistry. 5 curated matches weekly — each with a reason why. Women get premium free forever.",
  keywords: [
    "dating app",
    "relationship matching",
    "AI matchmaking",
    "AI relationship",
    "deep connection",
    "intentional dating",
    "relationship structure",
    "lokfeel",
    "curated matches",
    "AI matching engine",
  ],
  authors: [{ name: "LokFeel Team" }],
  creator: "LokFeel",
  publisher: "LokFeel",
  manifest: "/manifest.json",
  openGraph: {
    title: "LokFeel — AI Relationship Matching Engine",
    description:
      "AI-powered relationship matching. 5 curated matches weekly — each with a reason why. Women get premium free forever.",
    url: "https://app.lokfeel.com",
    siteName: "LokFeel",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "LokFeel — AI Relationship Matching Engine",
    description:
      "AI-powered relationship matching. 5 curated matches weekly — each with a reason why.",
    creator: "@lokfeel",
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
    navigator.serviceWorker.register('/sw.js').catch(function(err) {
      console.warn('SW registration failed:', err);
    });
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
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
