import Footer from "@/components/layout/footer";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Video Background — identical to landing page */}
      <div className="fixed inset-0 z-0 overflow-hidden">
        {/* Dark base for instant perceived load — visible before video loads */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-950 via-indigo-950 to-black" />

        <video
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-1000"
          style={{
            top: "50%",
            left: "50%",
            minWidth: "100%",
            minHeight: "100%",
            width: "auto",
            height: "auto",
            transform: "translate(-50%, -50%)",
          }}
          onCanPlay={(e) => {
            // Fade in video once ready — no blocking render
            (e.target as HTMLVideoElement).style.opacity = "1";
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

        {/* Cool Blue overlay — identical to landing page */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(59,130,246,0.4) 0%, rgba(99,102,241,0.25) 50%, rgba(0,0,0,0.1) 100%)",
          }}
        />
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
