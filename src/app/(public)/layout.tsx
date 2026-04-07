import type { Metadata } from "next";
import Navbar from "@/components/layout/navbar";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Nexus — Real Matches. Real Connection.",
  description: "A relationship matching engine that delivers curated matches with explanations of why you connect. Built for women who want quality over quantity.",
  keywords: ["dating", "relationships", "matchmaking", "connection", "compatibility"],
  openGraph: {
    title: "Nexus — Real Matches. Real Connection.",
    description: "A relationship matching engine that delivers curated matches with explanations.",
    type: "website",
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
    <footer className="border-t border-white/10 bg-background-secondary/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl font-bold text-gradient">Nexus</span>
            </div>
            <p className="text-white/60 text-sm">
              Real matches. Real connection. No swiping.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-semibold text-white mb-4">Product</h4>
            <ul className="space-y-2">
              <li>
                <a href="/about" className="text-white/60 hover:text-white text-sm transition-colors">
                  About
                </a>
              </li>
              <li>
                <a href="/register" className="text-white/60 hover:text-white text-sm transition-colors">
                  Get Started
                </a>
              </li>
              <li>
                <a href="/dashboard" className="text-white/60 hover:text-white text-sm transition-colors">
                  App
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-white mb-4">Legal</h4>
            <ul className="space-y-2">
              <li>
                <a href="/privacy" className="text-white/60 hover:text-white text-sm transition-colors">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="/terms" className="text-white/60 hover:text-white text-sm transition-colors">
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="/cookies" className="text-white/60 hover:text-white text-sm transition-colors">
                  Cookie Policy
                </a>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-semibold text-white mb-4">Contact</h4>
            <ul className="space-y-2">
              <li>
                <a href="mailto:hello@nexus.dating" className="text-white/60 hover:text-white text-sm transition-colors">
                  hello@nexus.dating
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10">
          <p className="text-white/40 text-sm text-center">
            © {new Date().getFullYear()} Nexus. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
