import { Metadata } from "next";
import Link from "next/link";
import { Users2, Target, Briefcase } from "lucide-react";
import { BRAND } from "@/config/brand";
import { PublicHold } from "@/components/marketing/public-hold";
import { isPublicSurfaceFrozen } from "@/config/public-surface";

export const metadata: Metadata = {
  // GA T2：审核期间不索引（正文已由 PublicHold 占位，这里只是配套）
  robots: { index: false, follow: false },
  title: "Solutions",
  description:
    "LokFeel in practice: professional introductions for communities, goal execution for small teams, and collaboration workflows for hiring and cross-border work.",
  openGraph: {
    title: `Solutions — ${BRAND.name}`,
    description:
      "Three verified scenarios built on the same chain: intent, consent, approved action, verified outcome.",
  },
};

const scenarios = [
  {
    icon: Users2,
    id: "Professional communities",
    intro:
      "A community operator turns member requests into introductions both sides actually agreed to.",
    roles: "Community operator (operator/owner), the two members being introduced.",
    trigger: "A member posts a collaboration intent.",
    actions: [
      "The operator drafts a proposal between the two parties, with field-level disclosure.",
      "Both members consent on their own — no consent, no introduction.",
      "The operator sends the introduction; both sides follow up inside the product.",
    ],
    result:
      "The introduction is recorded; afterwards either side can report the outcome and the counterparty confirms it.",
    boundary:
      "Introductions and follow-ups happen in-product (in-app and email notifications). We do not claim delivery to channels we have not integrated.",
  },
  {
    icon: Target,
    id: "Small teams",
    intro:
      "A team takes a goal from a chat message to an executed, independently verified outcome.",
    roles: "A member submits the goal; the owner approves; another member verifies.",
    trigger: "The team records a goal in the workspace (compiled into a mission).",
    actions: [
      "The owner approves the agent action — approval and execution are separate powers.",
      "The agent executes against a real AI provider; progress and failures are visible.",
      "A third role verifies the outcome, which is recorded as externally verified.",
    ],
    result:
      "The outcome carries a verification level and audit events; the console keeps the whole trail.",
    boundary:
      "Agent execution runs under per-plan quotas and micro-cent budgets. Every plan has finite limits — no unlimited tiers.",
  },
  {
    icon: Briefcase,
    id: "Hiring & cross-border collaboration",
    intro:
      "The same chain supports hiring coordination and cross-border team collaboration.",
    roles: "Whoever owns the relationship manages the proposals; both sides consent.",
    trigger: "A concrete collaboration need: an introduction, a referral, a joint task.",
    actions: [
      "Record the intent, draft the proposal, get consent — identical to the scenarios above.",
      "Run approved follow-up actions and track them as outcomes.",
    ],
    result: "A recorded, consented and verified collaboration step — not an inbox thread.",
    boundary:
      "LokFeel is a general collaboration platform, not an industry-specific solution. If your scenario needs the intent → consent → action → verification chain, it fits.",
  },
];

export default function SolutionsPage() {
  // GA T2：内容安全的保证在**渲染层** —— 审核未完成时这个组件不渲染任何商业声明。
  if (isPublicSurfaceFrozen()) return <PublicHold />;
  return (
    <div className="pt-24">
      {/* Hero */}
      <section className="relative py-16 lg:py-24 overflow-hidden">
        <div className="glow-orb glow-orb-secondary w-[600px] h-[600px] -top-20 -right-20 opacity-30" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <p className="text-primary text-sm font-medium tracking-wide uppercase mb-4">
            Scenarios
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            Same chain, <span className="text-gradient">three workloads</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            Every scenario runs on the same verified path: intent, consent, approved action,
            outcome. Pick the one closest to your work.
          </p>
        </div>
      </section>

      {/* Scenarios */}
      <section className="py-16 lg:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          {scenarios.map((scenario) => (
            <article key={scenario.id} className="glass-card p-8">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                  <scenario.icon className="w-6 h-6 text-primary" aria-hidden />
                </div>
                <h2 className="text-2xl font-bold text-foreground">{scenario.id}</h2>
              </div>
              <p className="text-foreground mb-6">{scenario.intro}</p>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-bold tracking-widest text-white/60 uppercase mb-1">
                      Roles
                    </h3>
                    <p className="text-sm text-foreground-muted">{scenario.roles}</p>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold tracking-widest text-white/60 uppercase mb-1">
                      Trigger
                    </h3>
                    <p className="text-sm text-foreground-muted">{scenario.trigger}</p>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold tracking-widest text-white/60 uppercase mb-1">
                      Result
                    </h3>
                    <p className="text-sm text-foreground-muted">{scenario.result}</p>
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-bold tracking-widest text-white/60 uppercase mb-3">
                    How it runs
                  </h3>
                  <ol className="space-y-2">
                    {scenario.actions.map((action, i) => (
                      <li key={action} className="flex gap-3 text-sm text-foreground-muted">
                        <span className="font-mono text-primary shrink-0" aria-hidden>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        {action}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
              <p className="mt-6 text-xs leading-relaxed text-foreground-subtle border-t border-white/10 pt-4">
                <span className="font-semibold text-foreground-muted">Boundary: </span>
                {scenario.boundary}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Closest scenario not listed?
          </h2>
          <p className="text-foreground-muted mb-8">
            If your work needs the intent → consent → approved action → verification chain, it
            runs on LokFeel. Ask us, or try it directly.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/register" className="btn-primary text-lg px-8 py-4">
              Start free
            </Link>
            <Link href="/contact" className="btn-secondary text-lg px-8 py-4">
              Talk to us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
