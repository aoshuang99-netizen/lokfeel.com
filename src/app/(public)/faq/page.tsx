import { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  HelpCircle,
  Compass,
  ShieldCheck,
  CreditCard,
  Trash2,
  Users,
  Smartphone,
  Mail,
  Plug,
} from "lucide-react";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  title: "FAQ",
  description: `Common questions about ${BRAND.name} — how intent becomes a workspace, how consent is enforced, and what agents can and cannot do.`,
  openGraph: {
    title: `FAQ · ${BRAND.name}`,
    description: BRAND.shortDescription,
  },
};

interface FaqItem {
  icon: typeof HelpCircle;
  tint: string;
  question: string;
  answer: ReactNode;
}

const items: FaqItem[] = [
  {
    icon: Compass,
    tint: "bg-primary/20 text-primary",
    question: `What is ${BRAND.name}?`,
    answer: (
      <>
        {BRAND.name} is an {BRAND.category}. You describe an outcome in plain language; the system
        compiles it into a structured, schema-validated workspace containing the goal, its
        constraints, the people involved, the boundaries they approve, and the metrics that define
        success. Work happens inside that workspace — not in a chat thread that disappears.
      </>
    ),
  },
  {
    icon: Compass,
    tint: "bg-secondary/20 text-secondary",
    question: "What happens when I describe a goal?",
    answer: (
      <>
        A run goes through four stages: <strong>Intent</strong> is captured, a{" "}
        <strong>workspace spec</strong> is compiled and validated, <strong>consent</strong> gates are
        applied to fields and actions, and <strong>outcomes</strong> are recorded and reconciled.
        If a stage cannot be verified, the run does not advance — a failed compilation is shown as
        failed, never as success.
      </>
    ),
  },
  {
    icon: ShieldCheck,
    tint: "bg-success/20 text-success",
    question: "What can the AI actually change — and what needs approval?",
    answer: (
      <>
        The model proposes; it does not execute. It can produce a draft spec, suggest candidates and
        recommend a next step, but every write that touches people or money passes a server-side
        permission check and, where the spec requires it, an explicit approval. Sensitive actions
        with no valid consent are rejected by the API, not hidden in the UI.
      </>
    ),
  },
  {
    icon: Users,
    tint: "bg-info/20 text-info",
    question: `Who is ${BRAND.name} for?`,
    answer: (
      <>
        Teams and communities that coordinate work involving other people: recruiting, partnerships,
        member introductions, vendor onboarding, internal approvals. If your work currently lives in
        threads and spreadsheets, and you need to know who approved what, it fits.
      </>
    ),
  },
  {
    icon: ShieldCheck,
    tint: "bg-primary/20 text-primary",
    question: "How is my organization's data isolated?",
    answer: (
      <>
        Every workspace belongs to an organization, and access is checked on the server for each
        request through a tenant-scoped data layer. Our database does not provide row-level security,
        so isolation is enforced in application code and covered by cross-tenant negative tests in
        CI. We would rather state that plainly than imply a guarantee the storage engine does not
        make.
      </>
    ),
  },
  {
    icon: CreditCard,
    tint: "bg-warning/20 text-warning",
    question: `How much does ${BRAND.name} cost?`,
    answer: (
      <>
        There is a free tier for evaluating the platform. Paid plans are listed on the{" "}
        <Link href="/pricing" className="text-primary hover:underline">
          pricing page
        </Link>
        . Subscription checkout is not yet open to the public — while it is closed, no card is
        charged and every checkout endpoint returns a configuration error instead of a payment
        form. See{" "}
        <Link href="/refunds" className="text-primary hover:underline">
          refunds
        </Link>{" "}
        for the policy that applies once billing is live.
      </>
    ),
  },
  {
    icon: Users,
    tint: "bg-primary/20 text-primary",
    question: "How do I create an account?",
    answer: (
      <>
        Visit{" "}
        <Link href="/register" className="text-primary hover:underline">
          app.lokfeel.com/register
        </Link>{" "}
        and sign up with email, Google or GitHub. No credit card is required to create a workspace.
        You will be asked to name your organization — that organization owns everything you create.
      </>
    ),
  },
  {
    icon: Plug,
    tint: "bg-secondary/20 text-secondary",
    question: "Can other agents and tools call it?",
    answer: (
      <>
        Yes. {BRAND.name} exposes an MCP server with five tools, an A2A task endpoint, and a
        published OpenAPI contract, so an external agent can compile a workspace or check an outcome
        programmatically. The same permission model applies to machine callers — a token does not
        bypass consent.
      </>
    ),
  },
  {
    icon: Smartphone,
    tint: "bg-secondary/20 text-secondary",
    question: "Is there a mobile app?",
    answer: (
      <>
        {BRAND.name} is a responsive web application and can be installed as a PWA from your mobile
        browser. Native iOS and Android clients are not shipped; the web app is the supported client
        today.
      </>
    ),
  },
  {
    icon: Trash2,
    tint: "bg-danger/20 text-danger",
    question: "How do I delete my account and data?",
    answer: (
      <>
        Account settings include a delete action. Deletion removes your account and its owned
        workspace data; export is available before you delete. For requests that need a human, email{" "}
        <a href="mailto:support@lokfeel.com" className="text-primary hover:underline">
          support@lokfeel.com
        </a>
        . Details are in the{" "}
        <Link href="/privacy" className="text-primary hover:underline">
          privacy policy
        </Link>
        .
      </>
    ),
  },
  {
    icon: Mail,
    tint: "bg-primary/20 text-primary",
    question: "Still have questions?",
    answer: (
      <>
        Write to{" "}
        <a href="mailto:support@lokfeel.com" className="text-primary hover:underline">
          support@lokfeel.com
        </a>{" "}
        for product questions,{" "}
        <a href="mailto:billing@lokfeel.com" className="text-primary hover:underline">
          billing@lokfeel.com
        </a>{" "}
        for invoices, or{" "}
        <a href="mailto:hello@lokfeel.com" className="text-primary hover:underline">
          hello@lokfeel.com
        </a>{" "}
        for anything else.
      </>
    ),
  },
];

export default function FAQPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <HelpCircle className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">
            Frequently Asked Questions
          </h1>
          <p className="text-foreground-muted">How {BRAND.name} works, and where its limits are</p>
        </div>

        {/* Content */}
        <div className="glass-card p-8 lg:p-12 space-y-10">
          {items.map((item) => (
            <section key={item.question}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${item.tint}`}>
                  <item.icon className="w-5 h-5" />
                </div>
                <h2 className="text-xl font-bold text-foreground">{item.question}</h2>
              </div>
              <div className="text-foreground leading-relaxed ml-13 space-y-3">{item.answer}</div>
            </section>
          ))}
        </div>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <Link href="/" className="btn-ghost">
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
