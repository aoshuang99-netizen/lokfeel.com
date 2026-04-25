"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Heart,
  Sparkles,
  Users,
  Shield,
  ChevronRight,
  Check,
  ArrowRight,
  Star,
  Zap,
} from "lucide-react";

// Mock user data for showcase
const showcaseUsers = [
  { id: 1, name: "Sarah", age: 29, traits: ["Emotionally intelligent", "Values depth"], gender: "woman", sexuality: "bisexual", image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=500&fit=crop" },
  { id: 2, name: "James", age: 32, traits: ["Secure attachment", "Open communicator"], gender: "man", sexuality: "straight", image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=500&fit=crop" },
  { id: 3, name: "Maya", age: 27, traits: ["Thoughtful", "Growth-minded"], gender: "woman", sexuality: "lesbian", image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=500&fit=crop" },
  { id: 4, name: "Alex", age: 30, traits: ["Emotionally available", "Curious mind"], gender: "non-binary", sexuality: "queer", image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=500&fit=crop" },
  { id: 5, name: "Emma", age: 31, traits: ["Secure", "Authentic"], gender: "woman", sexuality: "bisexual", image: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&h=500&fit=crop" },
  { id: 6, name: "Michael", age: 34, traits: ["Emotionally mature", "Good listener"], gender: "man", sexuality: "straight", image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=500&fit=crop" },
  { id: 7, name: "Priya", age: 28, traits: ["Deep thinker", "Compassionate"], gender: "woman", sexuality: "pansexual", image: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400&h=500&fit=crop" },
  { id: 8, name: "David", age: 33, traits: ["Securely attached", "Adventurous"], gender: "man", sexuality: "straight", image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=500&fit=crop" },
];

const testimonials = [
  { name: "Jennifer K.", role: "Marketing Director", quote: "After years of swiping, I finally found someone who truly gets me. The match explanation was spot-on.", rating: 5 },
  { name: "Rebecca S.", role: "Software Engineer", quote: "The relationship blueprint feature helped me understand what I was actually looking for. Game changer.", rating: 5 },
  { name: "Amanda T.", role: "Therapist", quote: "As a therapist, I'm picky about dating apps. LokFeel is the first one that takes emotional compatibility seriously.", rating: 5 },
];

const features = [
  { icon: "target", title: "Relationship Structure Matching", description: "We match based on attachment styles, communication patterns, and relationship goals — not just interests." },
  { icon: "sparkles", title: "Match Explanations", description: "Every match comes with a detailed breakdown of why you connect. No more guessing." },
  { icon: "shield", title: "Conflict Pre-filtering", description: "We identify potential friction points before they become problems. Better matches, fewer surprises." },
  { icon: "heart", title: "Female-Friendly Design", description: "Built by women, for women. Your safety and comfort are our top priorities." },
];

export default function LandingPage() {
  const [email, setEmail] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = (window.scrollY / totalHeight) * 100;
      setScrollProgress(progress);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleWaitlistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setIsSubmitted(true);
    }
  };

  return (
    <div className="relative">
      {/* Scroll Progress */}
      <div className="fixed top-0 left-0 h-0.5 bg-gradient-to-r from-primary to-secondary z-50" style={{ width: `${scrollProgress}%` }} />

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-background" />
          <div className="absolute inset-0 opacity-30 animate-ken-burns" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=1920&h=1080&fit=crop&q=80')", backgroundSize: "cover", backgroundPosition: "center" }} />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0d0c11] via-[#0d0c11]/80 to-[#0d0c11]/50" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0d0c11]/60 via-transparent to-[#0d0c11]/60" />
        </div>

        <div className="glow-orb glow-orb-primary w-[600px] h-[600px] -top-20 -left-20 animate-breathe opacity-40" />
        <div className="glow-orb glow-orb-secondary w-[500px] h-[500px] -bottom-20 -right-20 animate-breathe opacity-30" style={{ animationDelay: "2s" }} />

        <div className="relative z-10 max-w-5xl mx-auto px-4 text-center section-padding-lg">
          <div className="animate-slide-up">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass mb-8">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm text-foreground">Relationship Matching Reimagined</span>
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
              <span className="text-foreground">Real Matches.</span><br />
              <span className="text-gradient">Real Connection.</span><br />
              <span className="text-foreground-muted">No Swiping.</span>
            </h1>

            <p className="text-lg sm:text-xl text-foreground-muted max-w-2xl mx-auto mb-10">
              Tired of endless swiping? LokFeel delivers 5 curated relationship matches per week with explanations of why you connect. Built for those who want quality over quantity.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/register" className="btn-primary text-lg px-8 py-4">
                Join the Waitlist <ArrowRight className="w-5 h-5 ml-2" />
              </Link>
              <Link href="/about" className="btn-secondary text-lg px-8 py-4">
                Learn More
              </Link>
            </div>

            <div className="mt-12 flex items-center justify-center gap-8 text-foreground-subtle text-sm">
              <div className="flex items-center gap-2"><Users className="w-4 h-4" /><span>10,000+ waiting</span></div>
              <div className="flex items-center gap-2"><Heart className="w-4 h-4 text-primary" /><span>500+ successful matches</span></div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronRight className="w-6 h-6 text-foreground-subtle rotate-90" />
        </div>
      </section>

      {/* User Showcase */}
      <section className="relative py-20 lg:py-28 overflow-hidden">
        <div className="glow-orb glow-orb-mixed w-[800px] h-[800px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-20" />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">Meet Your <span className="text-gradient">Matches</span></h2>
            <p className="text-foreground-muted max-w-xl mx-auto">Our algorithm considers emotional compatibility, not just shared interests</p>
          </div>

          <div className="relative overflow-hidden">
            <div className="flex gap-6" style={{ animation: "scroll-x 30s linear infinite" }}>
              {[...showcaseUsers, ...showcaseUsers].map((user, idx) => (
                <div key={`${user.id}-${idx}`} className="flex-shrink-0 w-64 glass-card overflow-hidden group hover:scale-105 transition-transform duration-300">
                  <div className="relative h-80">
                    <img src={user.image} alt={user.name} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-foreground font-semibold">{user.name}, {user.age}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-medium ${user.sexuality === 'straight' ? 'bg-secondary/30 text-secondary' : 'bg-primary/30 text-primary'}`}>{user.sexuality}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {user.traits.map((trait, i) => (
                          <span key={i} className="text-xs text-foreground-muted bg-background-tertiary px-2 py-0.5 rounded">{trait}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Why Section */}
      <section className="relative py-20 lg:py-28 bg-background-secondary/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">Why <span className="text-gradient">LokFeel</span>?</h2>
            <p className="text-foreground-muted max-w-2xl mx-auto">Dating apps were designed for volume. We were designed for connection.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, idx) => (
              <div key={idx} className="glass-card p-6 hover:scale-105 transition-transform duration-300">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mb-4">
                  {feature.icon === 'heart' && <Heart className="w-6 h-6 text-primary" />}
                  {feature.icon === 'sparkles' && <Sparkles className="w-6 h-6 text-primary" />}
                  {feature.icon === 'shield' && <Shield className="w-6 h-6 text-primary" />}
                  {feature.icon === 'target' && <ChevronRight className="w-6 h-6 text-primary" />}
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{feature.title}</h3>
                <p className="text-foreground-muted text-sm">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="relative py-20 lg:py-28">
        <div className="glow-orb glow-orb-secondary w-[600px] h-[600px] top-1/2 right-0 translate-y-1/2 opacity-20" />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">How It <span className="text-gradient">Works</span></h2>
            <p className="text-foreground-muted max-w-xl mx-auto">Three simple steps to find meaningful connection</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "01", title: "Build Your Blueprint", description: "Complete your relationship blueprint — attachment style, communication needs, conflict resolution preferences." },
              { step: "02", title: "Receive Curated Matches", description: "Our algorithm delivers 5 high-quality matches per week, not an endless stream of options." },
              { step: "03", title: "Understand Your Connection", description: "Every match includes a detailed explanation of why you connect and potential areas to explore." },
            ].map((item, idx) => (
              <div key={idx} className="relative">
                <div className="glass-card p-8 h-full">
                  <span className="text-5xl font-bold text-gradient/20 mb-4 block">{item.step}</span>
                  <h3 className="text-xl font-semibold text-foreground mb-3">{item.title}</h3>
                  <p className="text-foreground-muted">{item.description}</p>
                </div>
                {idx < 2 && <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2"><ChevronRight className="w-8 h-8 text-foreground-faint" /></div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="relative py-20 lg:py-28 bg-background-secondary/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">The <span className="text-gradient">Difference</span></h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="glass-card p-8 opacity-60">
              <h3 className="text-xl font-semibold text-foreground-subtle mb-6">Traditional Dating Apps</h3>
              <ul className="space-y-4">
                {["Endless swiping, decision fatigue", "Surface-level matching on photos", "No understanding of why you match", "High volume, low quality", "Game-playing and misrepresentation"].map((item, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-foreground-subtle">
                    <span className="w-5 h-5 rounded-full bg-background-tertiary flex items-center justify-center flex-shrink-0 mt-0.5"><span className="w-2 h-2 rounded-full bg-background-tertiary" /></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="glass-card p-8 border-primary/30">
              <h3 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2"><Heart className="w-5 h-5 text-primary" /> LokFeel</h3>
              <ul className="space-y-4">
                {["Curated weekly matches, no overwhelm", "Deep matching on relationship needs", "Full explanation of compatibility", "High quality, intentional connections", "Transparent and authentic experience"].map((item, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-foreground">
                    <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5"><Check className="w-3 h-3 text-primary" /></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="relative py-20 lg:py-28">
        <div className="glow-orb glow-orb-primary w-[600px] h-[600px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-20" />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">What Our <span className="text-gradient">Members</span> Say</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, idx) => (
              <div key={idx} className="glass-card p-6">
                <div className="flex gap-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (<Star key={i} className="w-4 h-4 fill-primary text-primary" />))}
                </div>
                <p className="text-foreground mb-4 italic">"{testimonial.quote}"</p>
                <div><p className="font-semibold text-foreground">{testimonial.name}</p><p className="text-sm text-foreground-subtle">{testimonial.role}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Waitlist CTA */}
      <section className="relative py-20 lg:py-28 bg-background-secondary/30">
        <div className="glow-orb glow-orb-mixed w-[800px] h-[800px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-30" />
        
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <div className="glass-card p-10">
            <Zap className="w-12 h-12 text-primary mx-auto mb-6" />
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">Join the <span className="text-gradient">Waitlist</span></h2>
            <p className="text-foreground-muted mb-8">Be among the first to experience relationship matching reimagined. We launch in early 2026.</p>

            {!isSubmitted ? (
              <form onSubmit={handleWaitlistSubmit} className="flex flex-col sm:flex-row gap-3">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" className="input-feeld flex-1" required />
                <button type="submit" className="btn-primary whitespace-nowrap">Get Early Access</button>
              </form>
            ) : (
              <div className="flex items-center justify-center gap-2 text-success"><Check className="w-5 h-5" /><span className="font-medium">You're on the list!</span></div>
            )}
            <p className="text-xs text-foreground-subtle mt-4">No spam, ever. Unsubscribe anytime.</p>
          </div>
        </div>
      </section>

      <style>{`
        @keyframes scroll-x {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
