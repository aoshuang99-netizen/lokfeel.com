import { Metadata } from "next";
import Link from "next/link";
import { Compass, ShieldCheck, GitBranch, Network, Lock } from "lucide-react";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  title: `About — ${BRAND.name}`,
  description:
    "Why LokFeel exists: let AI carry the digital complexity so people can return to real life. Individual-first, with a clear boundary on what is live today.",
  openGraph: {
    title: `About — ${BRAND.name}`,
    description:
      "An individual-first product with a human mission and an honest statement of what is and is not available today.",
  },
};

const boundaryText =
  "LokFeel is in a controlled rollout. Today you can state a goal, review the steps, decide what needs your approval, and keep an in-app record of what happened. Not live yet: actions carried out inside external apps, automatic execution across other tools, and independent confirmation that a result was achieved outside LokFeel. We do not present any of those as available.";

const values = [
  {
    icon: Compass,
    title: "Time back, not more screens",
    description:
      "The point is fewer tedious digital steps and more time away from the screen, not another place to spend your attention.",
  },
  {
    icon: ShieldCheck,
    title: "You stay in control",
    description:
      "AI proposes the steps; you approve what matters. A key action needs your approval, and the person who requested it cannot approve it themselves.",
  },
  {
    icon: GitBranch,
    title: "An honest record",
    description:
      "What was decided, what was approved, and what happened are kept as an in-app record you can return to. A record inside LokFeel is not proof of a result in another service.",
  },
  {
    icon: Network,
    title: "Consent by default",
    description:
      "Nothing sensitive moves because a system inferred it should. Sharing is field by field, and silence counts as no.",
  },
];

export default function AboutPage() {
  return (
    <div className="pt-24 pb-20">
      {/* Hero */}
      <section className="relative py-16 lg:py-20 overflow-hidden">
        <div className="glow-orb glow-orb-primary w-[600px] h-[600px] -top-20 -left-20 opacity-30" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <p className="text-primary text-sm font-medium tracking-wide uppercase mb-4">About</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            About <span className="text-gradient">{BRAND.name}</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            We build for the person who has something to get done, not for an org chart.
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
        </div>
      </section>

      {/* Mission */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="glass-card p-8 lg:p-12">
            <div className="flex items-center gap-3 mb-6">
              <Compass className="w-6 h-6 text-primary" aria-hidden />
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground">Why we exist</h2>
            </div>
            <p className="text-foreground text-xl leading-relaxed mb-6">
              Let AI carry the digital complexity so people can return to real life.
            </p>
            <p className="text-foreground-muted leading-relaxed mb-6">
              Most digital work starts as a simple hope and turns into a pile of tabs, forms and
              follow-ups. Keeping track of it all costs time and attention that belong elsewhere.
            </p>
            <p className="text-foreground-muted leading-relaxed">
              {BRAND.name} takes on that complexity: it helps you state a goal, see the steps,
              decide what to approve, and keep a record. It is built for an individual first;
              working with other people is an extension, not a requirement to get started.
            </p>
          </div>
        </div>
      </section>

      {/* Trustworthy boundary */}
      <section className="py-16 lg:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">
            What we can and cannot say
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-foreground mb-3">What we stand behind</h3>
              <ul className="space-y-2 text-foreground-muted text-sm leading-relaxed list-disc pl-5">
                <li>An individual-first product: one person with one goal is a complete starting point.</li>
                <li>Clear labels for what is available, what needs approval, and what is not live yet.</li>
                <li>An in-app record of what happened, without dressing it up as an outside result.</li>
              </ul>
            </div>
            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-foreground mb-3">What we will not claim</h3>
              <ul className="space-y-2 text-foreground-muted text-sm leading-relaxed list-disc pl-5">
                <li>We do not claim confirmed outcomes, customer results, or automatic action across other apps.</li>
                <li>
                  The operating entity has not been confirmed, so this page makes no claim about
                  who runs the service or where it is based.
                </li>
                <li>We do not present anything marked as planned as if it were available today.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              What we optimize for
            </h2>
            <p className="text-foreground-muted max-w-xl mx-auto">
              Principles we would rather keep than add a flashy feature
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {values.map((value) => (
              <div key={value.title} className="glass-card p-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mb-4">
                  <value.icon className="w-6 h-6 text-primary" aria-hidden />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{value.title}</h3>
                <p className="text-foreground-muted leading-relaxed">{value.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-20">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Start with one goal
          </h2>
          <p className="text-foreground-muted mb-8">
            You do not need a team or an organization to begin. One goal is enough.
          </p>
          <Link href="/register" className="btn-primary text-lg px-8 py-4 min-h-[44px]">
            Try with a goal
          </Link>
        </div>
      </section>
    </div>
  );
}
