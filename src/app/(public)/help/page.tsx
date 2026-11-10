import { Metadata } from "next";
import Link from "next/link";
import { Mail, Shield, AlertTriangle, BookOpen, CreditCard, Users } from "lucide-react";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  title: "Help center",
  description:
    "Answers to common questions about accounts, billing, consent and outcomes — plus how to reach the right mailbox when you need a human.",
  openGraph: {
    title: `Help center — ${BRAND.name}`,
    description:
      "Common questions and the fastest route to support: the right mailbox for each topic, with real response expectations.",
  },
};

const topics = [
  {
    icon: Mail,
    title: "Accounts & sign-in",
    items: [
      "Sign in works with email and password, Google, or X — the same options at registration.",
      "Verification email missing? Open the verification page and use the resend link (a real resend, not a spinner).",
      "Invitations: the link in the invite email takes you straight into the organization — expired or revoked invitations are refused with a clear message.",
    ],
    links: [
      { label: "Register", href: "/register" },
      { label: "Contact support", href: "mailto:support@lokfeel.com" },
    ],
  },
  {
    icon: Shield,
    title: "Consent & privacy",
    items: [
      "Consent is per party and per field: a proposal discloses what will be shared, and nothing sensitive moves without your record.",
      "Declining does not tell the other side why — the reason stays with you.",
      "Your organization's data is isolated from other organizations; cross-organization requests are refused, not merely filtered.",
    ],
    links: [
      { label: "Privacy policy", href: "/privacy" },
      { label: "Product page", href: "/product" },
    ],
  },
  {
    icon: CreditCard,
    title: "Billing & plans",
    items: [
      "The free tier covers your first chains: 20 proposals, 10 outcomes, 5 seats. No card required.",
      "Paid plans add quotas, seats and agent budgets — all finite, by design. There is no \"unlimited\" tier.",
      "Subscriptions have a 14-day trial: the first charge happens after the trial, and cancelling before it ends means no charge.",
    ],
    links: [
      { label: "Pricing", href: "/pricing" },
      { label: "Refund policy", href: "/refunds" },
    ],
  },
  {
    icon: Users,
    title: "Organizations & roles",
    items: [
      "Creating an organization makes you its owner; members join by invitation only.",
      "Roles decide powers: approval and execution of agent actions are separate powers, held by different roles.",
      "Removing a member takes effect immediately — their old session cannot keep acting.",
    ],
    links: [{ label: "How it works", href: "/how-it-works" }],
  },
  {
    icon: AlertTriangle,
    title: "When something fails",
    items: [
      "Agent run failures show the reason and the next step — in the run record, not in a chat log.",
      "Notifications that cannot be delivered are stored with their content; nothing is silently dropped.",
      "If a page or action fails, tell us — every report reaches a human at support@lokfeel.com.",
    ],
    links: [
      { label: "Report an issue", href: "mailto:support@lokfeel.com" },
      { label: "Support page", href: "/support" },
    ],
  },
  {
    icon: BookOpen,
    title: "Reference",
    items: [
      "The product page maps every claim to its permission and limit.",
      "The machine surface (MCP tools, A2A tasks) is documented for developers in the repository.",
      "Legal texts — terms, privacy, refunds — state the operating entity and your rights directly.",
    ],
    links: [
      { label: "Product", href: "/product" },
      { label: "Terms of service", href: "/terms" },
    ],
  },
];

const mailboxes = [
  { name: "General support", email: "support@lokfeel.com", sla: "Within 24 hours" },
  { name: "Billing", email: "billing@lokfeel.com", sla: "Within 24–48 hours" },
  { name: "Legal", email: "legal@lokfeel.com", sla: "Within 24–48 hours" },
  { name: "Privacy", email: "privacy@lokfeel.com", sla: "Within 24–48 hours" },
  { name: "General inquiries", email: "hello@lokfeel.com", sla: "Within 24–48 hours" },
];

export default function HelpPage() {
  return (
    <div className="pt-24">
      {/* Hero */}
      <section className="relative py-16 lg:py-24 overflow-hidden">
        <div className="glow-orb glow-orb-secondary w-[600px] h-[600px] -top-20 -left-20 opacity-30" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <p className="text-primary text-sm font-medium tracking-wide uppercase mb-4">
            Help center
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            Answers first, <span className="text-gradient">humans when you need them</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            Common questions answered without a login — and the right mailbox for everything
            else.
          </p>
        </div>
      </section>

      {/* Topics */}
      <section className="py-16 lg:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 md:grid-cols-2">
            {topics.map((topic) => (
              <div key={topic.title} className="glass-card p-6">
                <div className="flex items-center gap-3 mb-4">
                  <topic.icon className="w-5 h-5 text-primary" aria-hidden />
                  <h2 className="text-lg font-semibold text-foreground">{topic.title}</h2>
                </div>
                <ul className="space-y-2 mb-4">
                  {topic.items.map((item) => (
                    <li key={item} className="flex gap-3 text-sm text-foreground-muted leading-relaxed">
                      <span className="text-primary shrink-0" aria-hidden>—</span>
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-3 border-t border-white/10 pt-4">
                  {topic.links.map((link) => (
                    <Link
                      key={link.href + link.label}
                      href={link.href}
                      className="text-sm text-primary hover:text-primary-hover transition-colors"
                    >
                      {link.label} →
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mailboxes */}
      <section className="py-16 lg:py-20 bg-background-secondary/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 text-center">
            Reach the right mailbox
          </h2>
          <div className="glass-card p-6">
            <ul className="divide-y divide-white/10">
              {mailboxes.map((box) => (
                <li key={box.email} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{box.name}</p>
                    <a
                      href={`mailto:${box.email}`}
                      className="text-sm text-primary hover:text-primary-hover transition-colors"
                    >
                      {box.email}
                    </a>
                  </div>
                  <p className="text-xs text-foreground-subtle">{box.sla}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-foreground-subtle">
              Every mailbox above is a real, monitored inbox. If you do not hear back within
              the stated window, reply once — the reply is part of the same thread and will not
              be lost.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
