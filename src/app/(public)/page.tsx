"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QuickSignupModal from "@/components/auth/quick-signup-modal";
import Footer from "@/components/layout/footer";

/**
 * LANDING PAGE — Dark Purple + Lime (v5)
 * Exact match to lokfeel.com (nexus-landing)
 * Design: LokFeel v5 "Dark Purple+Lime" system
 */

/* ─── VIDEO BACKGROUND COMPONENT ─────────────────────────────── */
function VideoBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSlowConnection, setIsSlowConnection] = useState(false);

  useEffect(() => {
    // Detect slow connections — skip video preload
    const conn = (navigator as any).connection;
    if (conn) {
      const effectiveType = conn.effectiveType;
      setIsSlowConnection(
        effectiveType === "2g" || effectiveType === "3g" || effectiveType === "4g"
      );
    }

    const video = videoRef.current;
    if (!video) return;

    const handleCanPlay = () => setIsLoaded(true);
    video.addEventListener("canplay", handleCanPlay);
    return () => video.removeEventListener("canplay", handleCanPlay);
  }, []);

  return (
    <div className="hero-video-container" aria-hidden="true">
      <video
        ref={videoRef}
        autoPlay={!isSlowConnection}
        muted
        loop
        playsInline
        preload={isSlowConnection ? "none" : "metadata"}
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          filter: "brightness(0.6) contrast(1.1) saturate(0.85)",
        }}
      >
        {/* Mobile: lightweight 720p */}
        <source
          src="/videos/background-mobile-720p.mp4"
          type="video/mp4"
          media="(max-width: 768px)"
        />
        {/* Modern browsers: WebM (smallest) */}
        <source
          src="/videos/background-desktop-1080p.webm"
          type="video/webm"
        />
        {/* Fallback: MP4 1080p */}
        <source
          src="/videos/background-desktop-1080p.mp4"
          type="video/mp4"
        />
      </video>

      {/* Purple overlay — identical to lokfeel.com */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, rgba(76, 29, 149, 0.4) 0%, rgba(109, 40, 217, 0.25) 50%, rgba(0, 0, 0, 0.1) 100%)",
        }}
      />

      {/* Dark base underneath for instant perceived load */}
      {!isLoaded && (
        <div className="absolute inset-0 bg-[#0a0a0a]" />
      )}

      {/* Purple ambient glow — bottom left */}
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-[#4c1d95]/20 rounded-full blur-[120px] pointer-events-none" />
    </div>
  );
}

/* ─── IN-VIEW HOOK ──────────────────────────────────────────── */
function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);

  return { ref, inView };
}

/* ─── NAVBAR ─────────────────────────────────────────────────── */
function Navbar({ onSignupClick, onLoginClick }: any) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-white/5"
          : "bg-transparent"
      }`}
      aria-label="Main navigation"
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 no-underline">
            <span className="font-display text-xl font-bold tracking-tight text-white">
              LokFeel
            </span>
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8">
            <a
              href="#about"
              className="text-sm text-white/50 hover:text-white/90 transition-colors no-underline"
            >
              About
            </a>
            <a
              href="#how"
              className="text-sm text-white/50 hover:text-white/90 transition-colors no-underline"
            >
              How it works
            </a>
          </div>

          {/* Right side — Sign In + Get Started */}
          <div className="flex items-center gap-3">
            <button
              onClick={onLoginClick}
              className="hidden sm:inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors bg-transparent border-none cursor-pointer"
            >
              Sign In
            </button>
            <button
              onClick={onSignupClick}
              className="hidden sm:block rounded-full px-5 py-2 text-sm font-semibold cursor-pointer border-none text-black bg-[#a3e635] hover:bg-[#bef264] transition-all"
            >
              Get Started
            </button>
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden w-9 h-9 flex items-center justify-center text-white/70 bg-transparent border-none cursor-pointer"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-menu"
            >
              {mobileOpen ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          id="mobile-menu"
          className="md:hidden absolute top-16 left-0 right-0 bg-[#0a0a0a]/95 backdrop-blur-xl border-b border-white/5 p-6"
          role="dialog"
          aria-label="Mobile navigation menu"
        >
          <div className="flex flex-col gap-4">
            <a
              href="#about"
              onClick={() => setMobileOpen(false)}
              className="text-lg py-2 text-white/70 hover:text-white transition-colors no-underline"
            >
              About
            </a>
            <a
              href="#how"
              onClick={() => setMobileOpen(false)}
              className="text-lg py-2 text-white/70 hover:text-white transition-colors no-underline"
            >
              How it works
            </a>
            <div className="h-px bg-white/10 my-2" />
            <button
              onClick={() => {
                setMobileOpen(false);
                onLoginClick();
              }}
              className="text-lg py-2 text-white/70 hover:text-white transition-colors text-left bg-transparent border-none cursor-pointer"
            >
              Sign In
            </button>
            <button
              onClick={() => {
                setMobileOpen(false);
                onSignupClick();
              }}
              className="w-full rounded-full py-3 text-base font-semibold cursor-pointer border-none text-black bg-[#a3e635]"
            >
              Get Started
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}

/* ─── HERO SECTION ──────────────────────────────────────────── */
function HeroSection({ onSignupClick }: any) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      style={{ minHeight: "100dvh" }}
    >
      {/* Video background is rendered by parent */}

      {/* Content */}
      <div className="relative z-20 max-w-4xl mx-auto px-6 text-center text-white py-20">
        <h1
          className={`font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl tracking-tight leading-[1.1] mb-6 transition-all duration-700 ${
            loaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          AI matches what
          <br />
          <span className="text-[#a3e635]">swiping can't</span>
        </h1>

        <p
          className={`text-lg sm:text-xl text-white/60 max-w-xl mx-auto mb-8 sm:mb-10 transition-all duration-700 delay-100 ${
            loaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          Our AI engine analyzes personality, values & chemistry. 5 curated matches weekly — each with a reason why.
        </p>

        {/* CTA Buttons — Lime primary */}
        <div
          className={`flex flex-col sm:flex-row gap-4 justify-center items-center transition-all duration-700 delay-200 ${
            loaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <button
            onClick={onSignupClick}
            className="w-full sm:w-auto rounded-full px-8 py-6 text-base font-semibold w-full sm:w-auto flex items-center justify-center gap-2 cursor-pointer border-none text-black bg-[#a3e635] hover:bg-[#bef264] transition-all shadow-lg shadow-[#a3e635]/25"
            aria-label="Start free registration on LokFeel"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            Start Free
          </button>
          <a href="#about" className="block w-full sm:w-auto">
            <button
              className="rounded-full px-8 py-6 text-base font-medium border border-white/15 text-white/80 hover:text-white hover:border-white/30 hover:bg-white/5 transition-all w-full sm:w-auto cursor-pointer bg-transparent"
            >
              Learn More
            </button>
          </a>
        </div>

        {/* 🌸 Ladies Never Pay Banner */}
        <div
          className={`mt-6 sm:mt-8 transition-all duration-700 delay-500 ${
            loaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <button
            onClick={onSignupClick}
            className="inline-flex items-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm hover:bg-white/10 transition-all cursor-pointer text-white/70 text-xs sm:text-sm font-medium"
          >
            <span className="text-base sm:text-lg">🌸</span>
            <span>Ladies Never Pay</span>
            <span className="text-white/30 text-[10px] sm:text-xs hidden sm:inline">
              — Premium features free for women
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30 group-hover:text-white/60 transition-all">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 hidden sm:block">
        <div className="w-6 h-10 rounded-full border-2 border-white/20 flex justify-center pt-2">
          <div className="w-1 h-2 bg-white/40 rounded-full animate-bounce" />
        </div>
      </div>
    </section>
  );
}

/* ─── ABOUT SECTION ──────────────────────────────────────────── */
function AboutSection() {
  const { ref, inView } = useInView();

  return (
    <section id="about" className="py-24 md:py-32 bg-[#0a0a0a]" ref={ref}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Left: Real image */}
          <div
            className={`relative transition-all duration-1000 ${
              inView ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-12"
            }`}
          >
            <div className="relative aspect-[4/5] rounded-2xl overflow-hidden ring-1 ring-white/5">
              <img
                src="/images/about-couple.jpg"
                alt="Real couple connecting through LokFeel"
                loading="lazy"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a]/30 via-transparent to-transparent" />
            </div>
            {/* Floating badge */}
            <div className="absolute -bottom-4 -right-4 bg-[#111111] border border-[#4c1d95]/20 rounded-xl p-4 shadow-xl">
              <p className="text-3xl font-bold font-display text-[#a3e635]">AI</p>
              <p className="text-sm text-white/40">Powered matching engine</p>
            </div>
          </div>

          {/* Right: Content */}
          <div className="text-center md:text-left">
            <h2
              className={`font-display text-3xl sm:text-4xl md:text-5xl tracking-tight text-white transition-all duration-700 ${
                inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
            >
              Swiping is random. AI matching is intentional.
            </h2>
            <p
              className={`text-xl text-white/50 mt-6 transition-all duration-700 delay-100 ${
                inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
            >
              LokFeel's AI engine understands who you really are — and finds the people you'll genuinely click with.
            </p>
            <div
              className={`mt-8 transition-all duration-700 delay-200 ${
                inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
            >
              <a href="#how">
                <button
                  className="rounded-full px-6 py-2.5 text-sm font-medium border border-[#4c1d95]/30 text-[#a78bfa] hover:bg-[#4c1d95]/10 hover:border-[#4c1d95]/50 transition-all cursor-pointer bg-transparent inline-flex items-center gap-2"
                  aria-label="Learn how LokFeel works"
                >
                  See how it works
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── HOW IT WORKS SECTION ──────────────────────────────────── */
function HowSection() {
  const { ref, inView } = useInView();
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    {
      num: "01",
      title: "Tell the AI who you are",
      desc: "A 5-minute conversation. Our engine learns your personality, values & patterns.",
      image: "/images/bg/photo-couple-main.jpg",
    },
    {
      num: "02",
      title: "Get AI-curated matches",
      desc: "5 people weekly, selected by our matching engine — with explanations why.",
      image: "/images/bg/photo-team-1.jpg",
    },
    {
      num: "03",
      title: "Connect with confidence",
      desc: "Every match comes with compatibility insights. Skip the guesswork.",
      image: "/images/bg/photo-team-2.jpg",
    },
  ];

  useEffect(() => {
    if (!inView) return;
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [inView, steps.length]);

  return (
    <section id="how" className="py-24 md:py-32 bg-[#111111]" ref={ref}>
      <div className="max-w-6xl mx-auto px-6">
        <p
          className={`text-sm uppercase tracking-widest text-[#a3e635]/70 mb-6 text-center transition-all duration-700 ${
            inView ? "opacity-100" : "opacity-0"
          }`}
        >
          How it works
        </p>

        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Left: Steps */}
          <div className="space-y-6">
            {steps.map((step, i) => (
              <div
                key={i}
                className={`relative flex gap-6 items-start cursor-pointer p-4 rounded-xl transition-all duration-500 ${
                  activeStep === i
                    ? "bg-[#1a1a1a] shadow-lg scale-[1.02] ring-1 ring-[#4c1d95]/20"
                    : "opacity-50 hover:opacity-80"
                }`}
                onClick={() => setActiveStep(i)}
              >
                {i < steps.length - 1 && (
                  <div className="absolute left-[2.25rem] top-16 w-0.5 h-8 bg-gradient-to-b from-[#4c1d95]/20 to-transparent" />
                )}

                <div className="relative">
                  <span
                    className={`text-5xl font-bold font-display transition-all duration-500 ${
                      activeStep === i ? "text-[#a3e635]" : "text-white/15"
                    }`}
                  >
                    {step.num}
                  </span>
                </div>

                <div className="flex-1 pt-2">
                  <h3
                    className={`text-xl font-semibold mb-2 transition-colors duration-300 ${
                      activeStep === i ? "text-white" : "text-white/50"
                    }`}
                  >
                    {step.title}
                  </h3>
                  <p
                    className={`text-white/40 transition-all duration-500 ${
                      activeStep === i ? "opacity-100" : "opacity-70"
                    }`}
                  >
                    {step.desc}
                  </p>

                  {activeStep === i && (
                    <div className="mt-4 h-0.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-[#a3e635] animate-[progress_4s_linear]" />
                    </div>
                  )}
                </div>

                <div
                  className={`transition-all duration-300 ${
                    activeStep === i ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2"
                  }`}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#a3e635]/60">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            ))}
          </div>

          {/* Right: Real images */}
          <div
            className={`relative aspect-[4/3] rounded-2xl overflow-hidden transition-all duration-700 ${
              inView ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"
            }`}
            style={{
              transform: inView ? "perspective(1000px) rotateY(-3deg)" : "perspective(1000px) rotateY(0)",
              boxShadow: "20px 20px 60px rgba(76, 29, 149, 0.15), -5px -5px 20px rgba(0,0,0,0.3)",
            }}
          >
            {steps.map((step, i) => (
              <div
                key={i}
                className={`absolute inset-0 transition-all duration-700 ${
                  activeStep === i ? "opacity-100 scale-100" : "opacity-0 scale-110"
                }`}
              >
                <img
                  src={step.image}
                  alt={`Step ${step.num}: ${step.title}`}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a]/60 via-transparent to-transparent" />
              </div>
            ))}

            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
              {steps.map((step, i) => (
                <button
                  key={i}
                  onClick={() => setActiveStep(i)}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    activeStep === i ? "bg-[#a3e635] w-8" : "bg-white/20 w-1.5 hover:bg-white/40"
                  }`}
                  aria-label={`Go to step ${step.num}: ${step.title}`}
                />
              ))}
            </div>

            <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-sm text-white px-3 py-1.5 rounded-full text-sm font-medium">
              {String(activeStep + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── CTA SECTION ────────────────────────────────────────────── */
function CTASection({ onSignupClick }: any) {
  const { ref, inView } = useInView();

  return (
    <section className="py-24 md:py-32 bg-[#111111]" ref={ref}>
      <div className="max-w-2xl mx-auto px-6 text-center">
        <h2
          className={`font-display text-3xl sm:text-4xl tracking-tight mb-6 text-white transition-all duration-700 ${
            inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          Let AI find your match
        </h2>
        <p
          className={`text-white/50 mb-8 transition-all duration-700 delay-100 ${
            inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          Join the AI matching revolution. Women get premium features free — forever.
        </p>

        {/* App Download Buttons */}
        <div
          className={`flex flex-col sm:flex-row gap-4 justify-center items-center mb-8 transition-all duration-700 delay-200 ${
            inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <a
            href="https://apps.apple.com/app/lokfeel"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download LokFeel from the App Store (opens in new tab)"
          >
            <button className="rounded-xl px-6 h-14 gap-3 border border-white/15 text-white hover:bg-white/5 transition-all flex items-center cursor-pointer bg-transparent">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.6-2.13 2.87-3.69 3.64-1.36.68-2.87 1.13-4.52 1.31-.75.09-1.52.13-2.29.13-1.96 0-3.79-.44-5.33-1.23-1.56-.79-2.91-2.05-3.86-3.64-.95-1.59-1.49-3.57-1.49-5.78 0-1.95.36-3.73 1.01-5.27.66-1.55 1.69-2.86 2.91-3.79 1.22-.93 2.69-1.48 4.28-1.6 1.58-.12 3.16.12 4.61.68 1.46.56 2.77 1.49 3.78 2.71l.01.01c.4.49.74 1.01 1.01 1.56.27.55.49 1.13.64 1.72.16.59.26 1.19.29 1.79.04 1.17-.13 2.34-.51 3.41-.38 1.07-.99 2.01-1.78 2.71z" />
              </svg>
              <div className="text-left">
                <div className="text-[10px] leading-none opacity-50">Download on the</div>
                <div className="text-sm font-semibold leading-tight">App Store</div>
              </div>
            </button>
          </a>
          <a
            href="https://play.google.com/store/apps/details?id=com.lokfeel.app"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download LokFeel from Google Play (opens in new tab)"
          >
            <button className="rounded-xl px-6 h-14 gap-3 border border-white/15 text-white hover:bg-white/5 transition-all flex items-center cursor-pointer bg-transparent">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3.18 23.67c-.35-.19-.63-.57-.76-1.03l-.02-.08L.5 9.14c-.12-.62.12-1.25.6-1.62l.06-.05L10.16.45c.35-.26.82-.35 1.26-.24l.08.03 11.29 5.14c.47.21.81.63.91 1.13l.02.09.97 6.96c.08.6-.1 1.2-.52 1.63l-.06.06-8.04 6.63c-.39.32-.89.49-1.4.49-.38 0-.75-.09-1.09-.26l-.07-.05-4.17-2.75z" />
              </svg>
              <div className="text-left">
                <div className="text-[10px] leading-none opacity-50">Get it on</div>
                <div className="text-sm font-semibold leading-tight">Google Play</div>
              </div>
            </button>
          </a>
        </div>

        <div
          className={`transition-all duration-700 delay-300 ${
            inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <button
            onClick={onSignupClick}
            className="rounded-full px-8 py-3 text-base font-semibold cursor-pointer border-none text-black bg-[#a3e635] hover:bg-[#bef264] transition-all inline-flex items-center gap-2 shadow-lg shadow-[#a3e635]/25"
          >
            Get Started Free
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}

/* ─── MAIN LANDING PAGE ─────────────────────────────────────── */
export default function LandingPage() {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [signupOpen, setSignupOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const handleScroll = () => {
      const totalHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      const progress = totalHeight > 0 ? (window.scrollY / totalHeight) * 100 : 0;
      setScrollProgress(progress);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="relative min-h-screen bg-[#0a0a0a] text-white overflow-x-hidden">
      {/* Skip Navigation — Accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[#a3e635] focus:text-black focus:rounded-lg focus:text-sm focus:font-semibold"
      >
        Skip to main content
      </a>

      {/* Scroll Progress Bar — Lime */}
      <div
        className="fixed top-0 left-0 h-0.5 z-[9999] transition-[width] duration-150"
        style={{
          width: `${scrollProgress}%`,
          background: "linear-gradient(90deg, #4c1d95, #a3e635)",
        }}
      />

      {/* Video Background */}
      <VideoBackground />

      {/* Navbar */}
      <Navbar onSignupClick={() => setSignupOpen(true)} onLoginClick={() => router.push("/login")} />

      {/* Main Content */}
      <main id="main-content" tabIndex={-1}>
        <HeroSection onSignupClick={() => setSignupOpen(true)} />
        <AboutSection />
        <HowSection />
        <CTASection onSignupClick={() => setSignupOpen(true)} />
      </main>

      {/* Footer */}
      <Footer />

      {/* Modal — unified Sign Up only */}
      <QuickSignupModal
        isOpen={signupOpen}
        onClose={() => setSignupOpen(false)}
      />
    </div>
  );
}
