import { Metadata } from "next";
import Link from "next/link";
import { Handshake, ClipboardCheck, TriangleAlert } from "lucide-react";
import { BRAND } from "@/config/brand";
import { PublicHold } from "@/components/marketing/public-hold";
import { isPublicSurfaceFrozen } from "@/config/public-surface";

export const metadata: Metadata = {
  // GA T2：审核期间不索引（正文已由 PublicHold 占位，这里只是配套）
  robots: { index: false, follow: false },
  title: "Stories",
  description:
    "Two complete walkthroughs of LokFeel: a consented professional introduction and a small-team goal executed under approval and externally verified.",
  openGraph: {
    title: `Stories — ${BRAND.name}`,
    description:
      "Demo scenarios with full evidence chains. No invented customer logos, quotes or revenue figures.",
  },
};

const stories = [
  {
    icon: Handshake,
    id: "A professional introduction, done properly",
    problem:
      "A community member asks for an introduction to another member. The usual way is a group-chat @mention: no consent, no record, and three weeks later nobody knows whether it happened.",
    input:
      "One intent from the requester, and one proposal drafted by the community operator with field-level disclosure.",
    steps: [
      "Both members consent on their own terms — the introduction cannot proceed without both records.",
      "The operator sends the introduction; both sides receive in-app and email notifications.",
      "Three weeks later, the requester reports the outcome of the introduction.",
      "The other side confirms it — the outcome moves to counterparty-confirmed.",
    ],
    evidence:
      "Consent records, the introduction event, the reported outcome, and the audit events behind every transition (reported / confirmed).",
    result:
      "A recorded, twice-consented introduction with a confirmed outcome — not a chat scroll.",
  },
  {
    icon: ClipboardCheck,
    id: "From goal to verified outcome in one workspace",
    problem:
      "A five-person team keeps a quarterly goal in a message thread. Nobody can say who approved the work, whether an agent ran, or what the result actually was.",
    input: "The goal, recorded in the workspace and compiled into a mission.",
    steps: [
      "The owner approves the agent action — approval and execution are separate powers, held by different roles.",
      "The agent executes against a real AI provider; progress and any failures are visible in the run record.",
      "A member who is neither the submitter nor the executor verifies the outcome.",
      "The outcome is recorded as externally verified, with audit events behind each transition.",
    ],
    evidence:
      "The run record, the approval record, the verification record set, and the derived level (externally verified).",
    result:
      "A goal that can be shown — with approvals, execution history and independent verification — to anyone who asks.",
  },
];

export default function StoriesPage() {
  // GA T2：内容安全的保证在**渲染层** —— 审核未完成时这个组件不渲染任何商业声明。
  if (isPublicSurfaceFrozen()) return <PublicHold />;
  return (
    <div className="pt-24">
      {/* Demo disclaimer — 醒目、先于一切内容（总令 §5：演示必须显式标注） */}
      <div className="bg-primary-muted border-b border-primary/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3">
          <TriangleAlert className="w-5 h-5 text-primary shrink-0" aria-hidden />
          <p className="text-sm text-foreground">
            <span className="font-semibold">These are demo scenarios, not real customer results.</span>{" "}
            LokFeel has no customer case studies to publish yet — so we show what the product
            actually does, with the evidence chain you would get.
          </p>
        </div>
      </div>

      {/* Hero */}
      <section className="relative py-16 lg:py-24 overflow-hidden">
        <div className="glow-orb glow-orb-primary w-[600px] h-[600px] -top-20 -left-20 opacity-30" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <p className="text-primary text-sm font-medium tracking-wide uppercase mb-4">
            Walkthroughs
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            What a verified outcome <span className="text-gradient">actually looks like</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            Two complete chains: problem, input, steps, evidence, result — and the limits of
            what each one proves.
          </p>
        </div>
      </section>

      {/* Stories */}
      <section className="py-16 lg:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          {stories.map((story) => (
            <article key={story.id} className="glass-card p-8">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                  <story.icon className="w-6 h-6 text-primary" aria-hidden />
                </div>
                <h2 className="text-2xl font-bold text-foreground">{story.id}</h2>
              </div>
              <div className="space-y-6">
                <div>
                  <h3 className="text-xs font-bold tracking-widest text-white/60 uppercase mb-2">
                    The problem
                  </h3>
                  <p className="text-foreground-muted text-sm leading-relaxed">{story.problem}</p>
                </div>
                <div>
                  <h3 className="text-xs font-bold tracking-widest text-white/60 uppercase mb-2">
                    Input
                  </h3>
                  <p className="text-foreground-muted text-sm leading-relaxed">{story.input}</p>
                </div>
                <div>
                  <h3 className="text-xs font-bold tracking-widest text-white/60 uppercase mb-2">
                    Steps
                  </h3>
                  <ol className="space-y-2">
                    {story.steps.map((step, i) => (
                      <li key={step} className="flex gap-3 text-sm text-foreground-muted">
                        <span className="font-mono text-primary shrink-0" aria-hidden>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <h3 className="text-xs font-bold tracking-widest text-white/60 uppercase mb-2">
                      Evidence you get
                    </h3>
                    <p className="text-foreground-muted text-sm leading-relaxed">
                      {story.evidence}
                    </p>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold tracking-widest text-white/60 uppercase mb-2">
                      Result — and its limit
                    </h3>
                    <p className="text-foreground-muted text-sm leading-relaxed">
                      {story.result} No quantitative improvement claims are made — a verified
                      outcome proves the step happened, not what it earned.
                    </p>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Run your own first chain
          </h2>
          <p className="text-foreground-muted mb-8">
            The fastest way to evaluate this is to take one real goal through it.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/register" className="btn-primary text-lg px-8 py-4">
              Start free
            </Link>
            <Link href="/product" className="btn-secondary text-lg px-8 py-4">
              Read the product page
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
