import { Metadata } from "next";
import Link from "next/link";
import {
  UserPlus,
  Building2,
  PenLine,
  ShieldCheck,
  BadgeCheck,
  RefreshCcw,
  LifeBuoy,
} from "lucide-react";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "From sign-up to your first verified outcome: register, create or join an organization, submit a goal, approve, and check the result — with failure recovery and support along the way.",
  openGraph: {
    title: `How it works — ${BRAND.name}`,
    description:
      "The seven-step first run. No developer explanation required — each step names where it happens and what to do when it fails.",
  },
};

const steps = [
  {
    icon: UserPlus,
    title: "Register",
    body: "Sign up with email and password, Google, or X. If your verification email does not arrive, use the resend link on the verification page — it is a real resend, not a spinner.",
    where: "/register",
  },
  {
    icon: Building2,
    title: "Create or join an organization",
    body: "Creating an organization makes you its owner. Joining happens by invitation — the invite link or email takes you straight in. Workspaces belong to an organization, not to an individual.",
    where: "Workspace, first run",
  },
  {
    icon: PenLine,
    title: "Submit your first goal",
    body: "Record what you want to achieve as an intent. The workspace compiles it into a mission — a structured object, not a message. Re-submitting the same goal twice does not create duplicates (idempotency keys are built in).",
    where: "Workspace → Studio",
  },
  {
    icon: ShieldCheck,
    title: "Approve",
    body: "An agent action needs an explicit approval from someone with the approval power — the submitter cannot approve their own request. Without an approval record, execution is refused with a 409.",
    where: "Workspace → Agents / Console → Agents",
  },
  {
    icon: BadgeCheck,
    title: "Check the result",
    body: "Outcomes carry a level: self-reported, counterparty-confirmed, or externally-verified. Self-reporting never counts as verified — the level is derived from who confirmed it, not from what the summary text says.",
    where: "Workspace → Outcomes / Console → Outcomes",
  },
  {
    icon: RefreshCcw,
    title: "Recover from failure",
    body: "Agent runs show failures with their reason and next step. Notifications that cannot be delivered are stored with their content — nothing is silently dropped. Declined proposals and revoked approvals return the workspace to a legal state instead of leaving half-applied changes.",
    where: "Workspace → Agents / Console → Overview",
  },
  {
    icon: LifeBuoy,
    title: "Get support",
    body: "support@lokfeel.com answers within 24 hours. Billing, legal and privacy each have a dedicated mailbox on the contact page. The help center covers common questions without a login.",
    where: "/help · /contact · /support",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="pt-24">
      {/* Hero */}
      <section className="relative py-16 lg:py-24 overflow-hidden">
        <div className="glow-orb glow-orb-primary w-[600px] h-[600px] -top-20 -right-20 opacity-30" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <p className="text-primary text-sm font-medium tracking-wide uppercase mb-4">
            First run
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            Seven steps to your first <span className="text-gradient">verified outcome</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            Each step says where it happens and what to do when it fails. You should not need a
            developer to explain any of them.
          </p>
        </div>
      </section>

      {/* Steps */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <ol className="space-y-6">
            {steps.map((step, i) => (
              <li key={step.title} className="glass-card p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                    <step.icon className="w-6 h-6 text-primary" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-primary mb-1">
                      {String(i + 1).padStart(2, "0")}
                    </p>
                    <h2 className="text-lg font-semibold text-foreground mb-2">{step.title}</h2>
                    <p className="text-foreground-muted text-sm leading-relaxed">{step.body}</p>
                    <p className="mt-2 font-mono text-[11px] text-foreground-subtle">
                      Where: {step.where}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-24">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            The walkthrough stops where the product starts
          </h2>
          <p className="text-foreground-muted mb-8">
            Everything above runs on the free tier — no card needed to take a goal through
            intent, approval and outcome.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/register" className="btn-primary text-lg px-8 py-4">
              Start free
            </Link>
            <Link href="/help" className="btn-secondary text-lg px-8 py-4">
              Open the help center
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
