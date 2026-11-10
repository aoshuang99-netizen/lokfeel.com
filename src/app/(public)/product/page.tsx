import { Metadata } from "next";
import Link from "next/link";
import {
  PenLine,
  FileText,
  ShieldCheck,
  Bot,
  BadgeCheck,
  Server,
  Lock,
  Eye,
  Users,
} from "lucide-react";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  title: "Product",
  description:
    "One workspace from intent to proof: intent, proposals, consent, approved agent action and three-level outcome verification — plus a machine surface of MCP tools and A2A tasks.",
  openGraph: {
    title: `Product — ${BRAND.name}`,
    description:
      "The full chain from collaboration intent to verified outcome, with permissions, quotas and audit at every step.",
  },
};

const fiveSteps = [
  {
    icon: PenLine,
    step: "01 · Intent",
    title: "State what you want to achieve",
    input: "A goal in your own words",
    output: "An intent record tied to a mission",
    permission: "Self-service (intent.manage)",
    limit: "You must belong to a mission first — otherwise the API returns 409",
  },
  {
    icon: FileText,
    step: "02 · Proposal",
    title: "Turn it into a proposal between two parties",
    input: "An intent and a counterparty",
    output: "A proposal with explicit expiry",
    permission: "Operators and above create; everyone can read their own",
    limit: "A proposal is not consent — one side drafting it proves nothing",
  },
  {
    icon: ShieldCheck,
    step: "03 · Consent",
    title: "Both sides approve, with field-level disclosure",
    input: "A pending proposal",
    output: "A consent record per party",
    permission: "Self-service (proposal.decide)",
    limit: "Decline reasons are never leaked back to the other side",
  },
  {
    icon: Bot,
    step: "04 · Action",
    title: "Agents act — only after approval",
    input: "An approved action request",
    output: "An executed run with provider, progress and failures",
    permission: "Approval (agent.approve, admin) and execution (agent.execute, operator) are separate powers",
    limit: "No approval record → 409. Prompt injection cannot bypass the gate",
  },
  {
    icon: BadgeCheck,
    step: "05 · Outcome",
    title: "Prove what happened",
    input: "A reported result on a connection",
    output: "A verification level: self-reported, counterparty-confirmed or externally-verified",
    permission: "Everyone reports; counterparty confirms; admin verifies",
    limit: "Self-reporting never counts as verified — the level is derived from the record set",
  },
];

const surfaces = [
  {
    icon: Eye,
    title: "Workspace — six screens",
    body: "Now, Studio, Field, Consent, Outcomes and Agents. Every state you see comes from a real server endpoint — no fabricated progress, no timer-based success.",
  },
  {
    icon: Users,
    title: "Console — seven screens",
    body: "Overview, missions, members, connections, agents, outcomes and organization settings. Role-based: owners see and control what members cannot.",
  },
  {
    icon: Server,
    title: "Machine surface",
    body: "MCP with five per-tool authenticated capabilities (list missions, list bridges, bridge discovery, list outcomes, report outcome) and an A2A task endpoint rate-limited to 120 requests per minute. Discovery is public; calling a tool always requires authorization.",
  },
];

const honestBoundaries = [
  "Notifications are in-app and email — there is no Slack, WhatsApp or CRM integration today.",
  "Agents run against real AI providers under per-plan quotas and micro-cent budgets. Every plan has finite limits; we do not sell \"unlimited\".",
  "Nothing on this page promises closed deals, revenue growth or automatic success — only a process with approvals and proofs.",
];

export default function ProductPage() {
  return (
    <div className="pt-24">
      {/* Hero */}
      <section className="relative py-16 lg:py-24 overflow-hidden">
        <div className="glow-orb glow-orb-primary w-[600px] h-[600px] -top-20 -left-20 opacity-30" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <p className="text-primary text-sm font-medium tracking-wide uppercase mb-4">
            {BRAND.category}
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            One workspace, <span className="text-gradient">from intent to proof</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            Five steps, each with explicit inputs, outputs, permissions and limits. If a step
            cannot be verified, the chain does not advance.
          </p>
        </div>
      </section>

      {/* Five steps */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-2">
            {fiveSteps.map((item) => (
              <div key={item.step} className="glass-card p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                    <item.icon className="w-6 h-6 text-primary" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-primary mb-1">{item.step}</p>
                    <h2 className="text-lg font-semibold text-foreground mb-3">{item.title}</h2>
                    <dl className="space-y-1.5 text-sm">
                      <div className="flex gap-2">
                        <dt className="text-foreground-subtle shrink-0">Input →</dt>
                        <dd className="text-foreground-muted">{item.input}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-foreground-subtle shrink-0">Output →</dt>
                        <dd className="text-foreground-muted">{item.output}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-foreground-subtle shrink-0">Who can →</dt>
                        <dd className="text-foreground-muted">{item.permission}</dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-xs leading-relaxed text-foreground-subtle border-t border-white/10 pt-3">
                      {item.limit}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Surfaces */}
      <section className="py-16 lg:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Three surfaces, one permission model
            </h2>
            <p className="text-foreground-muted max-w-xl mx-auto">
              People use the workspace and console; other agents use the machine surface. All
              three check the same role and capability gates.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {surfaces.map((surface) => (
              <div key={surface.title} className="glass-card p-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mb-4">
                  <surface.icon className="w-6 h-6 text-primary" aria-hidden />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{surface.title}</h3>
                <p className="text-foreground-muted text-sm leading-relaxed">{surface.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Honest boundaries */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="glass-card p-8">
            <div className="flex items-center gap-3 mb-4">
              <Lock className="w-5 h-5 text-primary" aria-hidden />
              <h2 className="text-xl font-semibold text-foreground">
                What we will not claim
              </h2>
            </div>
            <ul className="space-y-3">
              {honestBoundaries.map((item) => (
                <li key={item} className="flex gap-3 text-foreground-muted text-sm leading-relaxed">
                  <span className="text-primary shrink-0" aria-hidden>—</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-24">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Start with one real goal
          </h2>
          <p className="text-foreground-muted mb-8">
            Register, create an organization, and take a goal through the full chain — approval
            and verification included.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/register" className="btn-primary text-lg px-8 py-4">
              Start free
            </Link>
            <Link href="/how-it-works" className="btn-secondary text-lg px-8 py-4">
              See the walkthrough
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
