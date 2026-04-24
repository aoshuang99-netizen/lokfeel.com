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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
