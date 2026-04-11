import type { Metadata } from "next";
import Navbar from "@/components/layout/navbar";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Nexus — Real Matches. Real Connection.",
  description: "A relationship matching engine that delivers curated matches with explanations of why you connect. Built for women who value quality over quantity.",
  keywords: ["dating", "relationships", "matchmaking", "connection", "compatibility", "attachment theory"],
  openGraph: {
    title: "Nexus — Real Matches. Real Connection.",
    description: "A relationship matching engine that delivers curated matches with explanations.",
    type: "website",
    url: "https://app.lokfeel.com",
  },
};

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>{children}</main>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10 bg-background-secondary/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <span className="text-primary text-sm">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                </span>
              </div>
              <span className="text-xl font-bold text-gradient">LokFeel</span>
            </div>
            <p className="text-white/50 text-sm leading-relaxed mb-6 max-w-xs">
              A relationship matching engine that delivers curated matches with explanations of why you connect. Built for depth, not volume.
            </p>
            <p className="text-white/30 text-xs leading-relaxed">
              LokFeel Inc.<br />
              Wilmington, Delaware, USA
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-semibold text-sm uppercase tracking-wider text-white mb-5">Product</h4>
            <ul className="space-y-3">
              <li>
                <a href="/about" className="text-white/50 hover:text-white text-sm transition-colors">
                  About
                </a>
              </li>
              <li>
                <a href="/register" className="text-white/50 hover:text-white text-sm transition-colors">
                  Get Started
                </a>
              </li>
              <li>
                <a href="/login" className="text-white/50 hover:text-white text-sm transition-colors">
                  Sign In
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-sm uppercase tracking-wider text-white mb-5">Legal</h4>
            <ul className="space-y-3">
              <li>
                <a href="/privacy" className="text-white/50 hover:text-white text-sm transition-colors">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="/terms" className="text-white/50 hover:text-white text-sm transition-colors">
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="/cookies" className="text-white/50 hover:text-white text-sm transition-colors">
                  Cookie Policy
                </a>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-semibold text-sm uppercase tracking-wider text-white mb-5">Contact</h4>
            <ul className="space-y-3">
              <li>
                <a href="mailto:hello@lokfeel.com" className="text-white/50 hover:text-white text-sm transition-colors">
                  hello@lokfeel.com
                </a>
              </li>
              <li>
                <a href="mailto:support@lokfeel.com" className="text-white/50 hover:text-white text-sm transition-colors">
                  support@lokfeel.com
                </a>
              </li>
              <li>
                <a href="mailto:privacy@lokfeel.com" className="text-white/50 hover:text-white text-sm transition-colors">
                  privacy@lokfeel.com
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-8 border-t border-white/10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-white/30 text-xs text-center sm:text-left">
              &copy; {new Date().getFullYear()} LokFeel Inc. All rights reserved. Nexus is a registered trademark of LokFeel Inc.
            </p>
            <p className="text-white/30 text-xs">
              Made with care for people who value real connection.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
