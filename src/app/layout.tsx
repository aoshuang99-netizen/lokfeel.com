import type { Metadata } from "next";
import "./globals.css";
import AuthProvider from "@/components/providers/auth-provider";

export const metadata: Metadata = {
  metadataBase: new URL("https://lokfeel.com"),
  title: {
    default: "LokFeel — Real Matches. Real Connection.",
    template: "%s | LokFeel",
  },
  description:
    "LokFeel is a relationship structure matching engine built for depth, not swiping. Get 5 AI-curated matches per week with explanations of why you connect. Safe, private, and designed for meaningful relationships.",
  keywords: [
    "dating app",
    "relationship matching",
    "AI matchmaking",
    "deep connection",
    "intentional dating",
    "relationship structure",
    "lokfeel",
    "alternative dating",
    "kink-friendly dating",
    "LGBTQ+ dating",
    "meaningful relationships",
    "curated matches",
  ],
  authors: [{ name: "LokFeel Team" }],
  creator: "LokFeel",
  publisher: "LokFeel",
  openGraph: {
    title: "LokFeel — Real Matches. Real Connection.",
    description:
      "Relationship structure matching engine built for depth, not swiping. 5 AI-curated matches per week.",
    url: "https://lokfeel.com",
    siteName: "LokFeel",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "LokFeel — Real Matches. Real Connection.",
    description:
      "Relationship structure matching engine built for depth, not swiping.",
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
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Preconnect to external domains for faster resource loading */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.googleapis.cn" />
        {/* Google Fonts — non-blocking <link> won't block CSS like @import does */}
        {/* Uses rel="stylesheet" with display=swap: graceful fallback to system fonts if blocked */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Sora:wght@600;700;800&display=swap"
        />
        <link rel="preconnect" href="https://images.unsplash.com" />
        <link rel="preconnect" href="https://i.pravatar.cc" />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
