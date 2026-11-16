import { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert, Lock, Handshake, ClipboardCheck } from "lucide-react";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  title: `Stories — ${BRAND.name}`,
  description:
    "No customer results published yet. Any walkthrough on this page is clearly labelled as an illustrative demo on the card itself.",
  openGraph: {
    title: `Stories — ${BRAND.name}`,
    description:
      "No customer results published yet. Demos are labelled at the card level and carry no numbers.",
  },
};

const boundaryText =
  "LokFeel is in a controlled rollout. Today you can state a goal, review the steps, decide what needs your approval, and keep an in-app record of what happened. Not live yet: actions carried out inside external apps, automatic execution across other tools, and independent confirmation that a result was achieved outside LokFeel. We do not present any of those as available.";

const demoLabel = "DEMO — illustrative, not a real result";

const demos = [
  {
    icon: Handshake,
    title: "An introduction both sides agreed to",
    steps: [
      "One person describes the introduction they would like.",
      "Both parties give field-level consent before any field is shared.",
      "LokFeel keeps an in-app record of the agreed introduction and the consent decisions.",
    ],
    boundary:
      "No real introduction is delivered outside LokFeel and no result is confirmed. This walkthrough is illustrative only and proves nothing about a customer outcome.",
  },
  {
    icon: ClipboardCheck,
    title: "A team goal taken through approvals",
    steps: [
      "The team records a goal and reviews the suggested steps.",
      "A second person approves the key actions; the requester cannot approve their own request.",
      "LokFeel keeps an in-app record of the steps, the approvals and what happened.",
    ],
    boundary:
      "No external action is executed and no result is independently confirmed. This walkthrough is illustrative only and proves nothing about a customer outcome.",
  },
];

export default function StoriesPage() {
  return (
    <div className="pt-24 pb-20">
      {/* No results statement — shown before anything else */}
      <div className="bg-primary-muted border-b border-primary/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-start gap-3">
          <TriangleAlert className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden />
          <p className="text-sm text-foreground">
            <span className="font-semibold">No customer results published yet.</span> We have no
            customer case studies, numbers, or confirmed outcomes to show. Anything below is an
            illustrative demo, labelled on every card.
          </p>
        </div>
      </div>

      {/* Hero */}
      <section className="relative py-16 lg:py-20 overflow-hidden">
        <div className="glow-orb glow-orb-primary w-[600px] h-[600px] -top-20 -left-20 opacity-30" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <p className="text-primary text-sm font-medium tracking-wide uppercase mb-4">Stories</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            No customer results <span className="text-gradient">published yet</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            We do not dress up demos as success stories. Here is what the in-app flow looks like,
            clearly marked as illustrative.
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

      {/* Demo cards */}
      <section className="py-12 lg:py-16 bg-background-secondary/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-8">
            {demos.map((demo) => (
              <article key={demo.title} className="glass-card p-8">
                <p className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300 mb-5">
                  {demoLabel}
                </p>
                <div className="flex items-center gap-4 mb-5">
                  <div className="w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                    <demo.icon className="w-6 h-6 text-primary" aria-hidden />
                  </div>
                  <h2 className="text-2xl font-bold text-foreground">{demo.title}</h2>
                </div>
                <ol className="space-y-2 mb-6">
                  {demo.steps.map((step, i) => (
                    <li key={step} className="flex gap-3 text-sm text-foreground-muted">
                      <span className="font-mono text-primary shrink-0" aria-hidden>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
                <p className="text-xs leading-relaxed text-foreground-subtle border-t border-white/10 pt-4">
                  <span className="font-semibold text-foreground-muted">Boundary: </span>
                  {demo.boundary}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-20">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Run your own first goal
          </h2>
          <p className="text-foreground-muted mb-8">
            The most honest way to evaluate this is to take one of your own goals through it
            yourself.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/register" className="btn-primary text-lg px-8 py-4 min-h-[44px]">
              Try with a goal
            </Link>
            <Link href="/product" className="btn-secondary text-lg px-8 py-4 min-h-[44px]">
              Read the product page
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
