import { Metadata } from "next";
import Link from "next/link";
import {
  HelpCircle,
  ShieldCheck,
  TriangleAlert,
  Lock,
  Server,
} from "lucide-react";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  title: `Product — ${BRAND.name}`,
  description:
    "What you can do with LokFeel today, what needs your approval, and what is not live yet. Every item carries a status from the public capability register.",
  openGraph: {
    title: `Product — ${BRAND.name}`,
    description:
      "State a goal, approve what matters, and keep an in-app record of what happened, with a clear boundary on what is not live yet.",
  },
};

const boundaryText =
  "LokFeel is in a controlled rollout. Today you can state a goal, review the steps, decide what needs your approval, and keep an in-app record of what happened. Not live yet: actions carried out inside external apps, automatic execution across other tools, and independent confirmation that a result was achieved outside LokFeel. We do not present any of those as available.";

type Capability = {
  title: string;
  body: string;
  status: "Available" | "Gated" | "Planned";
  href?: string;
  linkLabel?: string;
};

const whatYouCanDo: Capability[] = [
  {
    title: "State a goal and get an editable step list",
    body: "Describe what you want to get done in your own words and get a list of steps you can change.",
    status: "Gated",
    href: "/workspace?view=now",
    linkLabel: "Open the goal input",
  },
  {
    title: "Edit each step and keep a version history",
    body: "Change the steps one by one; each change is recorded so you can see what was decided earlier.",
    status: "Gated",
    href: "/workspace?view=missions",
    linkLabel: "Open my tasks",
  },
  {
    title: "Decide exactly which fields to share",
    body: "Choose field by field what to disclose. Silence is treated as no, never as consent.",
    status: "Available",
    href: "/workspace?view=consent",
    linkLabel: "Review what needs approval",
  },
  {
    title: "See everything you have asked for in one list",
    body: "Your goals and their current state live together in a single list you can return to.",
    status: "Gated",
    href: "/workspace?view=missions",
    linkLabel: "Open my tasks",
  },
  {
    title: "See who did each step and where it stopped",
    body: "Each step records what happened and whether it is still in progress or came to a halt.",
    status: "Gated",
    href: "/workspace?view=agents",
    linkLabel: "Open the activity log",
  },
  {
    title: "Keep an in-app receipt after an action",
    body: "After an action you get a record inside LokFeel. It is an in-app receipt only, not proof of a result in another service.",
    status: "Available",
    href: "/workspace?view=outcomes",
    linkLabel: "Open results",
  },
];

const needsApproval: Capability[] = [
  {
    title: "A key action needs another person to approve it",
    body: "The person who requested an action cannot approve it themselves; a second approval is required.",
    status: "Gated",
    href: "/workspace?view=consent",
    linkLabel: "Open approvals",
  },
  {
    title: "Field-level sharing is set by you, not inferred",
    body: "Sensitive fields move only after you explicitly allow them. With no valid approval the request is refused.",
    status: "Available",
    href: "/workspace?view=consent",
    linkLabel: "Open approvals",
  },
];

const notLiveYet: Capability[] = [
  {
    title: "Real actions inside external apps",
    body: "Sending a real calendar invite or a real email to an outside service is not supported today.",
    status: "Planned",
  },
  {
    title: "Automatic execution across other tools",
    body: "Chaining actions across several applications without your approval is not supported today.",
    status: "Planned",
  },
  {
    title: "Independent confirmation of a result outside LokFeel",
    body: "Confirming that an outside result was actually achieved, independently of an in-app record, is not supported today.",
    status: "Planned",
  },
];

const statusStyles: Record<Capability["status"], string> = {
  Available: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  Gated: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  Planned: "bg-slate-500/10 text-slate-300 border-slate-500/30",
};

function CapabilityCard({ item }: { item: Capability }) {
  return (
    <div className="glass-card p-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${statusStyles[item.status]}`}
        >
          {item.status}
        </span>
      </div>
      <p className="text-sm text-foreground-muted leading-relaxed">{item.body}</p>
      {item.href && item.linkLabel ? (
        <Link
          href={item.href}
          className="mt-4 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-primary hover:underline"
        >
          {item.linkLabel} <span aria-hidden>→</span>
        </Link>
      ) : null}
    </div>
  );
}

export default function ProductPage() {
  return (
    <div className="pt-24 pb-20">
      {/* Hero */}
      <section className="relative py-16 lg:py-20 overflow-hidden">
        <div className="glow-orb glow-orb-primary w-[600px] h-[600px] -top-20 -left-20 opacity-30" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <p className="text-primary text-sm font-medium tracking-wide uppercase mb-4">Product</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            Know what you can do, <span className="text-gradient">and what needs your OK</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            Three plain questions, one honest answer each. Every capability is labelled Available,
            Gated, or Planned, straight from the capability register.
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

      {/* Status legend */}
      <section className="py-6">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-sm text-foreground-subtle leading-relaxed">
            <span className="font-semibold text-foreground-muted">Reading the labels: </span>
            available means wired up with an in-app record; gated means the capability exists but
            needs authorization or a second person and is not confirmed in production yet; planned
            means not built or not accepted, so please do not expect it today. These are the three
            statuses in the public capability register.
          </p>
        </div>
      </section>

      {/* Q1 */}
      <section className="py-12 lg:py-16 bg-background-secondary/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-8">
            <HelpCircle className="w-7 h-7 text-primary" aria-hidden />
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">What can I do?</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {whatYouCanDo.map((item) => (
              <CapabilityCard key={item.title} item={item} />
            ))}
          </div>
        </div>
      </section>

      {/* Q2 */}
      <section className="py-12 lg:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-8">
            <ShieldCheck className="w-7 h-7 text-primary" aria-hidden />
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">What needs my approval?</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {needsApproval.map((item) => (
              <CapabilityCard key={item.title} item={item} />
            ))}
          </div>
        </div>
      </section>

      {/* Q3 */}
      <section className="py-12 lg:py-16 bg-background-secondary/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-8">
            <TriangleAlert className="w-7 h-7 text-primary" aria-hidden />
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">What is not live yet?</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {notLiveYet.map((item) => (
              <CapabilityCard key={item.title} item={item} />
            ))}
          </div>
          <p className="mt-6 text-sm text-foreground-subtle">
            These are planned, not supported. If one of them matters to your work, tell us what
            you need it for.
          </p>
          <Link
            href="/contact"
            className="mt-3 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            Contact us <span aria-hidden>→</span>
          </Link>
        </div>
      </section>

      {/* For developers — implementation details only */}
      <section className="py-12 lg:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <details className="glass-card">
            <summary className="flex min-h-[44px] cursor-pointer items-center gap-3 px-6 py-4 text-base font-semibold text-foreground">
              <Server className="w-5 h-5 text-primary shrink-0" aria-hidden />
              For developers — implementation details (not user-facing features)
            </summary>
            <div className="border-t border-white/10 px-6 pb-6 pt-4">
              <p className="text-sm text-foreground-muted leading-relaxed mb-4">
                Implementation detail only. The names below are internal terms used in developer
                documentation. They are not product features, not user-facing capabilities, and
                not promises about what you can do today.
              </p>
              <ul className="space-y-2 text-sm text-foreground-muted leading-relaxed list-disc pl-5">
                <li>
                  A machine interface: MCP tools, an A2A task endpoint, and REST routes under
                  /api/v1. These exist for integrations, not for the first screen.
                </li>
                <li>
                  An internal plan object (WorkspaceSpec) checked against a Schema on the server,
                  with internal stage names such as INTENT_EXTRACTION and internal module names
                  such as Studio, Proposals, a Compiler, and Token accounting.
                </li>
                <li>
                  Internal positioning labels you may see in older code: Connection OS, Agent OS,
                  and Mission pipeline. They describe the implementation, not the product you use.
                </li>
              </ul>
              <p className="mt-4 text-sm text-foreground-subtle">
                None of the above describes something you can do in the product today. See the
                capability statuses above for what is actually available.
              </p>
            </div>
          </details>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-20">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">Start with one goal</h2>
          <p className="text-foreground-muted mb-8">
            State something you want done. See the steps, decide what to approve, and keep the
            record inside LokFeel.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/register" className="btn-primary text-lg px-8 py-4 min-h-[44px]">
              Try with a goal
            </Link>
            <Link href="/how-it-works" className="btn-secondary text-lg px-8 py-4 min-h-[44px]">
              See how it works
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
