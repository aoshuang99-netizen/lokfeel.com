import type { Metadata } from "next";
import "./globals.css";
import AuthProvider from "@/components/providers/auth-provider";

export const metadata: Metadata = {
  title: {
    default: "LokFeel — Real Matches. Real Connection.",
    template: "%s | LokFeel",
  },
  description: "Relationship structure matching engine. 5 curated matches per week with explanations of why you connect. Built for depth, not swiping.",
  keywords: ["dating", "matching", "relationships", "lokfeel", "deep connection"],
  openGraph: {
    title: "LokFeel — Real Matches. Real Connection.",
    description: "Relationship structure matching engine. Built for depth, not swiping.",
    url: "https://lokfeel.com",
    siteName: "LokFeel",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "LokFeel — Real Matches. Real Connection.",
    description: "Relationship structure matching engine. Built for depth, not swiping.",
  },
  robots: {
    index: true,
    follow: true,
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
