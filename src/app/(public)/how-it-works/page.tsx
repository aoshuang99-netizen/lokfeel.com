import { Metadata } from "next";
import Link from "next/link";
import { PenLine, ShieldCheck, Eye, Lock, RefreshCcw } from "lucide-react";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  title: `How it works — ${BRAND.name}`,
  description:
    "Three steps: say the goal, approve what matters, see what happened. Advanced details are folded away, with a clear boundary on what is not live yet.",
  openGraph: {
    title: `How it works — ${BRAND.name}`,
    description:
      "A short, honest walkthrough of the three steps, plus the boundary of what is available today.",
  },
};

const boundaryText =
  "LokFeel is in a controlled rollout. Today you can state a goal, review the steps, decide what needs your approval, and keep an in-app record of what happened. Not live yet: actions carried out inside external apps, automatic execution across other tools, and independent confirmation that a result was achieved outside LokFeel. We do not present any of those as available.";

const steps = [
  {
    icon: PenLine,
    title: "Say the goal",
    body: "Tell LokFeel what you want done in your own words. You get a short list of steps you can read and edit before anything happens.",
    status: "Gated",
  },
  {
    icon: ShieldCheck,
    title: "Approve what matters",
    body: "You decide which actions may go ahead. A key action needs your approval, and the person who requested it cannot approve it themselves. Field-level sharing is available and set by you.",
    status: "Gated / Available",
  },
  {
    icon: Eye,
    title: "See what happened",
    body: "You get an in-app record of what was done. It is a receipt inside LokFeel, not proof of a result in another service.",
    status: "Available",
  },
];

const advancedDetails = [
  "The step list is produced and checked on the server. If it cannot be produced, you see a failure, not a pretend success.",
  "Each change to a step keeps a version, so an earlier decision can be reviewed.",
  "An action with no valid approval is refused by the server, not merely hidden in the interface.",
  "If a step fails, it records the reason and the next thing you can do.",
  "Help is available in the help center, and you can reach us through the contact page.",
];

export default function HowItWorksPage() {
  return (
    <div className="pt-24 pb-20">
      {/* Hero */}
      <section className="relative py-16 lg:py-20 overflow-hidden">
        <div className="glow-orb glow-orb-primary w-[600px] h-[600px] -top-20 -right-20 opacity-30" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <p className="text-primary text-sm font-medium tracking-wide uppercase mb-4">How it works</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            Three steps, <span className="text-gradient">nothing hidden</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            Say the goal, approve what matters, see what happened. The deeper details are folded
            away until you want them.
          </p>

          <div
            role="note"
            aria-label="Current capability boundary"
            className="glass-card mt-8 p-6 text-left max-w-2xl mx-auto"
          >
            <div className="flex items-center gap-3 mb-2">
              <Lock className="w-5 h-5 text-primary shrink-0" aria-hidden />
              <h2 className="text-base font-semibold text-foreground">Where things stand today</h2>
            </div>
            <p className="text-sm text-foreground-muted leading-relaxed">{boundaryText}</p>
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link href="/register" className="btn-primary text-lg px-8 py-4 min-h-[44px]">
              Try with a goal
            </Link>
          </div>
        </div>
      </section>

      {/* Three steps */}
      <section className="py-12 lg:py-16 bg-background-secondary/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <ol className="grid gap-6 md:grid-cols-3">
            {steps.map((step, i) => (
              <li key={step.title} className="glass-card p-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mb-4">
                  <step.icon className="w-6 h-6 text-primary" aria-hidden />
                </div>
                <p className="font-mono text-xs text-primary mb-1">
                  Step {String(i + 1).padStart(2, "0")}
                </p>
                <h2 className="text-xl font-semibold text-foreground mb-2">{step.title}</h2>
                <p className="text-sm text-foreground-muted leading-relaxed">{step.body}</p>
                <p className="mt-3 font-mono text-[11px] text-foreground-subtle">
                  Status: {step.status}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Advanced details — folded */}
      <section className="py-12 lg:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <details className="glass-card">
            <summary className="flex min-h-[44px] cursor-pointer items-center gap-3 px-6 py-4 text-base font-semibold text-foreground">
              <RefreshCcw className="w-5 h-5 text-primary shrink-0" aria-hidden />
              Advanced details (for when you want them)
            </summary>
            <div className="border-t border-white/10 px-6 pb-6 pt-4">
              <ul className="space-y-3">
                {advancedDetails.map((detail) => (
                  <li key={detail} className="flex gap-3 text-sm text-foreground-muted leading-relaxed">
                    <span className="text-primary shrink-0" aria-hidden>
                      —
                    </span>
                    {detail}
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap gap-4">
                <Link
                  href="/help"
                  className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary hover:underline"
                >
                  Open the help center
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary hover:underline"
                >
                  Contact us
                </Link>
              </div>
            </div>
          </details>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            One goal is enough to start
          </h2>
          <p className="text-foreground-muted mb-8">
            You do not need to understand the internals. State a goal and follow the three steps.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/register" className="btn-primary text-lg px-8 py-4 min-h-[44px]">
              Try with a goal
            </Link>
            <Link href="/product" className="btn-secondary text-lg px-8 py-4 min-h-[44px]">
              See what is available
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
