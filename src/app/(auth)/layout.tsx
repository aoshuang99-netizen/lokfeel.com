"use client";

import { useEffect, useState } from "react";
import Footer from "@/components/layout/footer";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [fromLanding, setFromLanding] = useState(false);

  useEffect(() => {
    // Check if user navigated from landing page for seamless transition
    if (sessionStorage.getItem("lokfeel_from_landing") === "1") {
      setFromLanding(true);
      // Clean up the flag
      sessionStorage.removeItem("lokfeel_from_landing");
    }
  }, []);

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#0a0a0a]">
      {/* Video Background — identical to landing page */}
      <div className="hero-video-container" aria-hidden="true">
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className={`absolute inset-0 w-full h-full object-cover animate-ken-burns ${
            fromLanding ? "opacity-100" : "opacity-0 animate-fadeIn"
          }`}
        >
          {/* Mobile: lightweight 720p */}
          <source
            src="/videos/background-mobile-720p.mp4"
            type="video/mp4"
            media="(max-width: 768px)"
          />
          {/* Modern browsers: WebM */}
          <source
            src="/videos/background-desktop-1080p.webm"
            type="video/webm"
          />
          {/* Fallback: MP4 */}
          <source
            src="/videos/background-desktop-1080p.mp4"
            type="video/mp4"
          />
        </video>
        {/* Overlay handled by hero-video-container::after in globals.css — identical to landing */}
        {/* Purple ambient glow — bottom left (identical to landing) */}
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-[#4c1d95]/20 rounded-full blur-[120px] pointer-events-none" />
      </div>

      {/* Auth Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-6 pt-20 pb-20">
        {children}
      </div>

      {/* Footer */}
      <Footer />
    </div>
  );
}
