import Footer from "@/components/layout/footer";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Video Background — identical to landing page */}
      <div className="hero-video-container" aria-hidden="true">
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            filter: 'brightness(0.55) contrast(1.1) saturate(0.8)',
          }}
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
        {/* Purple overlay — identical to landing page */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(76, 29, 149, 0.4) 0%, rgba(109, 40, 217, 0.25) 50%, rgba(0, 0, 0, 0.1) 100%)",
          }}
        />
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
