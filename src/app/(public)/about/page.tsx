import { Metadata } from "next";
import Link from "next/link";
import { Heart, Users, Sparkles, Shield } from "lucide-react";

export const metadata: Metadata = {
  title: "About - LokFeel",
  description: "Learn about LokFeel - a relationship matching engine built for genuine connection.",
};

const values = [
  {
    icon: Heart,
    title: "Authentic Connection",
    description: "We believe meaningful relationships come from understanding, not algorithms alone. Our matching is rooted in relationship science.",
  },
  {
    icon: Shield,
    title: "Safety First",
    description: "Built by women for everyone. Your safety and comfort are our top priorities, with robust privacy controls and verification.",
  },
  {
    icon: Users,
    title: "Quality Over Quantity",
    description: "We deliver curated matches, not endless options. Every connection has potential because we understand what you truly need.",
  },
  {
    icon: Sparkles,
    title: "Continuous Learning",
    description: "Our matching improves with every successful relationship. We learn what works and refine our approach constantly.",
  },
];

const team = [
  {
    name: "Alexandra Chen",
    role: "CEO & Co-Founder",
    bio: "Former product lead at Hinge. Passionate about creating technology that serves human connection.",
    image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop",
  },
  {
    name: "Dr. Sarah Martinez",
    role: "Chief Science Officer",
    bio: "PhD in Relationship Psychology. 15 years of research on attachment theory and relationship compatibility.",
    image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop",
  },
  {
    name: "Michael Park",
    role: "CTO & Co-Founder",
    bio: "Previously led engineering at Bumble. Expert in building scalable, secure platforms.",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop",
  },
];

export default function AboutPage() {
  return (
    <div className="pt-24">
      {/* Hero */}
      <section className="relative py-20 lg:py-28 overflow-hidden">
        <div className="glow-orb glow-orb-primary w-[600px] h-[600px] -top-20 -left-20 opacity-30" />
        
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            About <span className="text-gradient">LokFeel</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            We're building the future of relationship matching — one where technology helps people find genuine connection, not just endless options.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="py-20 lg:py-28 bg-background-secondary/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="glass-card p-8 lg:p-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">Our Mission</h2>
            <p className="text-foreground text-lg leading-relaxed mb-6">
              The dating app industry was built on engagement metrics, not relationship success. We created LokFeel to change that.
            </p>
            <p className="text-foreground-muted leading-relaxed mb-6">
              Our mission is simple: help people find meaningful, lasting relationships through better matching. We believe everyone deserves to understand why they connect with someone — not just that they do.
            </p>
            <p className="text-foreground-muted leading-relaxed">
              Built on relationship science and powered by AI, LokFeel delivers curated matches with transparency. No games. No misrepresentation. Just real connection.
            </p>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">Our Values</h2>
            <p className="text-foreground-muted max-w-xl mx-auto">What guides everything we do</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {values.map((value, idx) => (
              <div key={idx} className="glass-card p-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mb-4">
                  <value.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{value.title}</h3>
                <p className="text-foreground-muted">{value.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section className="py-20 lg:py-28 bg-background-secondary/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">Meet the Team</h2>
            <p className="text-foreground-muted max-w-xl mx-auto">People passionate about helping you find love</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {team.map((member, idx) => (
              <div key={idx} className="glass-card p-6 text-center">
                <div className="w-32 h-32 mx-auto mb-4 rounded-full overflow-hidden border-2 border-primary/30">
                  <img src={member.image} alt={member.name} className="w-full h-full object-cover" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-1">{member.name}</h3>
                <p className="text-primary text-sm mb-3">{member.role}</p>
                <p className="text-foreground-muted text-sm">{member.bio}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 lg:py-28">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">Ready to Find Your Match?</h2>
          <p className="text-foreground-muted mb-8">Join thousands of people who are tired of swiping and ready for real connection.</p>
          <Link href="/register" className="btn-primary text-lg px-8 py-4">
            Get Started
          </Link>
        </div>
      </section>
    </div>
  );
}
