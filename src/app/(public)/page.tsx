"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import QuickSignupModal from "@/components/auth/quick-signup-modal";
import QuickLoginModal from "@/components/auth/quick-login-modal";
import Footer from "@/components/layout/footer";

/**
 * LANDING PAGE — Cool Blue V2
 * Video background + responsive loading + seamless nav
 * Design: LokFee! V2 "Cool Blue" system
 */

// ─── VIDEO BACKGROUND COMPONENT ───────────────────────────────
function VideoBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleCanPlay = () => setIsLoaded(true);
    video.addEventListener("canplay", handleCanPlay);
    return () => video.removeEventListener("canplay", handleCanPlay);
  }, []);

  return (
    <div className="fixed inset-0 z-0 overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          top: "50%",
          left: "50%",
          minWidth: "100%",
          minHeight: "100%",
          width: "auto",
          height: "auto",
          transform: "translate(-50%, -50%)",
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

      {/* Cool Blue overlay gradient */}
      <div
        className="absolute inset-0 transition-opacity duration-1000"
        style={{
          background:
            "linear-gradient(135deg, rgba(59,130,246,0.4) 0%, rgba(99,102,241,0.25) 50%, rgba(0,0,0,0.1) 100%)",
          opacity: isLoaded ? 1 : 0.7,
        }}
      />

      {/* Dark base underneath for instant perceived load */}
      {!isLoaded && (
        <div className="absolute inset-0 bg-gradient-to-br from-blue-950 via-indigo-950 to-black" />
      )}
    </div>
  );
}

// ─── NAVBAR ──────────────────────────────────────────────────
function Navbar({ onSignupClick, onLoginClick }: any) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-100 flex justify-between items-center px-6 sm:px-12 py-4 sm:py-6">
        <Link href="/" className="text-[28px] font-bold text-white no-underline">
          Lok<span className="text-[#60a5fa]">Fee!</span>
        </Link>
      <div className="flex gap-4 sm:gap-8 items-center">
        <a
          href="#about"
          className="text-white no-underline text-sm font-medium opacity-90 hover:opacity-100 transition-opacity max-sm:hidden"
        >
          About
        </a>
        <a
          href="#stories"
          className="text-white no-underline text-sm font-medium opacity-90 hover:opacity-100 transition-opacity max-sm:hidden"
        >
          Stories
        </a>
        <a
          href="#safety"
          className="text-white no-underline text-sm font-medium opacity-90 hover:opacity-100 transition-opacity max-sm:hidden"
        >
          Safety
        </a>
        <button
          onClick={onLoginClick}
          className="bg-transparent border-2 border-white/60 text-white px-5 py-2.5 rounded-full text-sm font-medium cursor-pointer hover:bg-white/10 transition-all"
        >
          Log In
        </button>
        <button
          onClick={onSignupClick}
          className="bg-[#3b82f6] text-white px-5 py-2.5 rounded-full text-sm font-semibold no-underline hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/25"
        >
          Sign Up
        </button>
      </div>
    </nav>
  );
}

// ─── STATS DATA ──────────────────────────────────────────────
const stats = [
  { value: "Science-Based", label: "Matching" },
  { value: "Privacy-First", label: "Design" },
  { value: "Verified", label: "Community" },
  { value: "Inclusive", label: "For Everyone" },
];

// ─── STORY DATA ──────────────────────────────────────────────
const stories = [
  {
    names: "Sarah & Michael",
    quote: "Matched in 3 weeks. The compatibility report was accurate.",
    meta: "✓ Married Spring 2025",
    img: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&h=300&fit=crop",
  },
  {
    names: "James & Emma",
    quote: "Finally, an app that focuses on who you are.",
    meta: "✓ Together 18 months",
    img: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=300&fit=crop",
  },
  {
    names: "David & Chen",
    quote: "Long distance. LokFee! brought us together.",
    meta: "✓ Engaged 2025",
    img: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&h=300&fit=crop",
  },
];

// ─── MAIN LANDING PAGE ───────────────────────────────────────
export default function LandingPage() {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [signupOpen, setSignupOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

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
    <div className="relative min-h-screen text-white">
      {/* Scroll Progress Bar */}
      <div
        className="fixed top-0 left-0 h-0.5 z-[9999] transition-[width] duration-150"
        style={{
          width: `${scrollProgress}%`,
          background:
            "linear-gradient(90deg, #3b82f6, #6366f1)",
        }}
      />

      {/* Video Background */}
      <VideoBackground />

      {/* Navbar */}
      <Navbar onSignupClick={() => setSignupOpen(true)} onLoginClick={() => setLoginOpen(true)} />

      {/* ─── HERO SECTION ─────────────────────────── */}
      <section className="relative min-h-screen flex flex-col justify-center items-center text-center px-6 pt-24 sm:pt-28 pb-20">
        <div className="max-w-[700px] animate-fade-in">
          <h1 className="text-[clamp(44px,8vw,76px)] font-bold leading-[1.1] mb-6 text-white">
            Find Real Love.
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #60a5fa, #818cf8)",
              }}
            >
              No Swiping.
            </span>
          </h1>
          <p
            className="text-[clamp(18px,2.5vw,22px)] text-white/95 mb-10 inline-block px-7 py-3.5 rounded-xl"
            style={{ background: "rgba(0,0,0,0.25)" }}
          >
            Relationship matching that connects you based on who you
            truly are.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <button
              onClick={() => setSignupOpen(true)}
              className="text-white px-10 py-4 rounded-full text-base font-semibold no-underline hover:-translate-y-0.5 transition-transform"
              style={{
                background:
                  "linear-gradient(135deg, #3b82f6, #6366f1)",
                boxShadow: "0 4px 25px rgba(59,130,246,0.4)",
              }}
            >
              Start Free Today
            </button>
            <a
              href="#how-it-works"
              className="text-white px-10 py-4 rounded-full text-base font-medium no-underline backdrop-blur-md hover:bg-white/20 transition-all"
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.3)",
              }}
            >
              How It Works
            </a>
          </div>
        </div>
      </section>

      {/* ─── STATS + STORIES ───────────────────────── */}
      <section
        id="stories"
        className="relative px-6 sm:px-12 py-16 sm:py-20"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(15,15,35,0.95) 100%)",
        }}
      >
        <div className="max-w-[1100px] mx-auto">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-5 mb-14">
            {stats.map((stat, idx) => (
              <div
                key={idx}
                className="text-center p-5 sm:p-6 rounded-2xl backdrop-blur-md"
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                <div
                  className="text-[clamp(32px,4vw,44px)] font-extrabold mb-2"
                  style={{ color: "#60a5fa" }}
                >
                  {stat.value}
                </div>
                <div className="text-xs text-white/80 uppercase tracking-wider">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {/* Stories Section */}
          <div className="text-center mb-10">
            <h3
              className="text-sm uppercase tracking-widest mb-3"
              style={{ color: "#60a5fa" }}
            >
              Real Couples, Real Love
            </h3>
            <h2 className="text-[clamp(24px,4vw,36px)] font-bold">
              They Found Each Other on LokFee!
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {stories.map((story, idx) => (
              <div
                key={idx}
                className="rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "rgba(96,165,250,0.5)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "rgba(255,255,255,0.1)";
                }}
              >
              <div
                className="h-[130px] flex items-center justify-center text-[40px] overflow-hidden"
                style={{
                  background:
                    "linear-gradient(135deg, #3b82f6, #6366f1)",
                }}
              >
                <img
                  src={story.img}
                  alt={story.names}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
                <div className="p-5">
                  <h4 className="text-base font-semibold mb-1.5">
                    {story.names}
                  </h4>
                  <p className="text-[13px] text-white/70 mb-2">
                    &ldquo;{story.quote}&rdquo;
                  </p>
                  <span
                    className="text-xs font-semibold"
                    style={{ color: "#60a5fa" }}
                  >
                    {story.meta}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ──────────────────────────── */}
      <section
        id="how-it-works"
        className="relative px-6 sm:px-12 py-16 sm:py-20"
        style={{ background: "rgba(15,15,35,0.95)" }}
      >
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-12">
            <h3
              className="text-sm uppercase tracking-widest mb-3"
              style={{ color: "#60a5fa" }}
            >
              How It Works
            </h3>
            <h2 className="text-[clamp(24px,4vw,36px)] font-bold">
              Three Steps to Real Connection
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                step: "01",
                title: "Build Your Blueprint",
                desc: "Complete your relationship blueprint \u2014 attachment style, communication needs, and what truly matters to you.",
              },
              {
                step: "02",
                title: "Get Curated Matches",
                desc: "Our algorithm delivers 5 high-quality matches per week with explanations of why you connect.",
              },
              {
                step: "03",
                title: "Start Meaningful Conversations",
                desc: "Every match includes compatibility insights. Skip the small talk and dive into what matters.",
              },
            ].map((item, idx) => (
              <div
                key={idx}
                className="p-7 rounded-2xl"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <span
                  className="text-5xl font-bold block mb-4 opacity-20"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg, #60a5fa, #818cf8)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {item.step}
                </span>
                <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                <p className="text-white/70">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─────────────────────────────── */}
      <section
        className="relative px-6 sm:px-12 py-16 sm:py-20 text-center"
        style={{ background: "rgba(10,10,25,0.95)" }}
      >
        <h2 className="text-[clamp(28px,4vw,40px)] font-bold mb-4">
          Your story starts here
        </h2>
        <p className="text-lg text-white/70 mb-8 max-w-xl mx-auto">
          Join half a million people who found meaningful connections
        </p>
        <button
          onClick={() => setSignupOpen(true)}
          className="inline-block text-white px-12 py-4.5 rounded-full text-base font-semibold no-underline hover:-translate-y-0.5 transition-transform"
          style={{
            background: "linear-gradient(135deg, #3b82f6, #6366f1)",
            padding: "18px 48px",
          }}
        >
          Create Free Account &rarr;
        </button>
      </section>

      {/* ─── FOOTER ────────────────────────────────── */}
      <Footer />

      {/* Modals */}
      <QuickSignupModal
        isOpen={signupOpen}
        onClose={() => setSignupOpen(false)}
      />
      <QuickLoginModal
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSwitchToSignup={() => {
          setLoginOpen(false);
          setSignupOpen(true);
        }}
      />
    </div>
  );
}
