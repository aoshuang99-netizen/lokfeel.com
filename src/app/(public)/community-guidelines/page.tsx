import { Metadata } from "next";
import { Users, Shield, AlertTriangle, MessageSquare } from "lucide-react";

export const metadata: Metadata = {
  title: "Community Guidelines - LokFee!",
  description: "LokFee! Community Guidelines - how we keep this space safe and respectful for everyone.",
};

const guidelines = [
  {
    icon: Users,
    title: "Be Real",
    desc: "Show your真实 self. No catfishing, fake photos, or misrepresentation of who you are.",
  },
  {
    icon: Shield,
    title: "Respect Others",
    desc: "Everyone deserves respect. Harassment, hate speech, and discrimination have no place here.",
  },
  {
    icon: AlertTriangle,
    title: "Stay Safe",
    desc: "Don't share personal info too quickly. Meet in public places. Trust your instincts.",
  },
  {
    icon: MessageSquare,
    title: "Communicate Clearly",
    desc: "Say what you mean. Ghosting hurts. If it's not a match, say so kindly.",
  },
];

const prohibited = [
  "Misrepresentation or catfishing",
  "Harassment, bullying, or hate speech",
  "Sharing intimate images without consent",
  "Spam, scams, or solicitation",
  "Impersonation or fake accounts",
  "Any illegal activity",
];

export default function CommunityGuidelinesPage() {
  return (
    <div className="pt-24 pb-20">
      {/* Hero */}
      <section className="py-20 lg:py-28 overflow-hidden text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center mx-auto mb-6">
            <Users className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            Community <span className="text-gradient">Guidelines</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            LokFee! is built on respect, honesty, and real human connection. These guidelines help us keep it that way.
          </p>
        </div>
      </section>

      {/* Core Guidelines */}
      <section className="py-16 lg:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-10 text-center">Our Core Values</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {guidelines.map((g, i) => (
              <div key={i} className="glass-card p-6 flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                  <g.icon className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">{g.title}</h3>
                  <p className="text-foreground-muted text-sm leading-relaxed">{g.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Prohibited Behavior */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 text-center">Prohibited Behavior</h2>
          <div className="glass-card p-8">
            <ul className="space-y-3">
              {prohibited.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 flex-shrink-0" />
                  <span className="text-foreground-muted">{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-center text-foreground-muted text-sm mt-8">
            Violating these guidelines may result in content removal, account suspension, or permanent ban.
          </p>
        </div>
      </section>

      {/* Reporting */}
      <section className="py-16 lg:py-20 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">See Something? Say Something.</h2>
          <p className="text-foreground-muted mb-8">
            If someone violates these guidelines, please report them. Every report is reviewed by our team.
          </p>
          <a
            href="mailto:safety@lokfee.com"
            className="btn-primary text-lg px-8 py-4"
          >
            Report a Problem
          </a>
        </div>
      </section>
    </div>
  );
}
