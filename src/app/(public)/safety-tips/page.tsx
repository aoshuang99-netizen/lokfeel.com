import { Metadata } from "next";
import { Shield, AlertTriangle, Eye, Lock } from "lucide-react";

export const metadata: Metadata = {
  title: "Safety Tips - LokFee!",
  description: "Essential safety tips for online dating and meaningful connections on LokFee!.",
};

const tips = [
  {
    icon: Shield,
    title: "Protect Your Personal Info",
    desc: "Don't share your address, workplace, or financial info too early. Build trust first.",
  },
  {
    icon: Eye,
    title: "Watch for Red Flags",
    desc: "Too good to be true? Asks for money? Avoids meeting? These are warning signs.",
  },
  {
    icon: Lock,
    title: "Meet in Public First",
    desc: "Always meet in a public place for the first few dates. Tell a friend where you're going.",
  },
  {
    icon: AlertTriangle,
    title: "Report & Block",
    desc: "See something suspicious? Report it. We review every report and take action.",
  },
];

export default function SafetyTipsPage() {
  return (
    <div className="pt-24 pb-20">
      {/* Hero */}
      <section className="py-20 lg:py-28 overflow-hidden text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center mx-auto mb-6">
            <Shield className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            Stay <span className="text-gradient">Safe</span> While Connecting
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            Your safety is our priority. Read our tips and take control of your experience.
          </p>
        </div>
      </section>

      {/* Tips */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">Essential Safety Tips</h2>
            <p className="text-foreground-muted max-w-xl mx-auto">Follow these guidelines to protect yourself while building real connections.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {tips.map((tip, idx) => (
              <div key={idx} className="glass-card p-6 flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                  <tip.icon className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">{tip.title}</h3>
                  <p className="text-foreground-muted text-sm leading-relaxed">{tip.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Reporting */}
      <section className="py-16 lg:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="glass-card p-8 md:p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">Need to Report Something?</h2>
            <p className="text-foreground-muted mb-8 max-w-xl mx-auto">
              If someone makes you uncomfortable or violates our Community Guidelines, report them immediately. We investigate every report.
            </p>
            <a
              href="mailto:safety@lokfee.com"
              className="btn-primary text-lg px-8 py-4"
            >
              Contact Safety Team
            </a>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-20 bg-background-secondary/30 text-center">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">Your Safety Is Our Mission</h2>
          <p className="text-foreground-muted mb-8">
            We're building LokFee! to be the safest place to find real connection. Read our full{' '}
            <a href="/privacy" className="text-blue-400 underline">Privacy Policy</a> and{' '}
            <a href="/community-guidelines" className="text-blue-400 underline">Community Guidelines</a>.
          </p>
        </div>
      </section>
    </div>
  );
}
