import { Metadata } from "next";
import Link from "next/link";
import { Compass, ShieldCheck, GitBranch, Network } from "lucide-react";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  title: "About",
  description: BRAND.description,
  openGraph: {
    title: `About ${BRAND.name}`,
    description: BRAND.shortDescription,
  },
};

const values = [
  {
    icon: Compass,
    title: "Structured over conversational",
    description:
      "A conversation that ends without an artifact is a cost, not progress. Every run must land a validated workspace spec or a mission — something the next person can pick up.",
  },
  {
    icon: ShieldCheck,
    title: "Consent is a first-class object",
    description:
      "Permissions are modeled per field and per action, checked server-side. Nothing sensitive moves because a model inferred it should.",
  },
  {
    icon: GitBranch,
    title: "Recoverable by design",
    description:
      "Compilation can fail, approval can be revoked, an agent can be stopped. The system keeps a path back to a legal state instead of leaving half-applied changes.",
  },
  {
    icon: Network,
    title: "Open at the edges",
    description:
      "MCP tools, an A2A task API and a published OpenAPI contract. Other agents can call LokFeel as a tool — an operating system, not a walled garden.",
  },
];

const pipeline = [
  { step: "Intent", detail: "You describe the outcome in your own words." },
  { step: "WorkspaceSpec", detail: "The intent is compiled into a strictly validated spec." },
  { step: "Consent", detail: "Fields and actions are gated by explicit approval." },
  { step: "Outcome", detail: "Actions are recorded, reconciled and made traceable." },
];

export default function AboutPage() {
  return (
    <div className="pt-24">
      {/* Hero */}
      <section className="relative py-20 lg:py-28 overflow-hidden">
        <div className="glow-orb glow-orb-primary w-[600px] h-[600px] -top-20 -left-20 opacity-30" />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <p className="text-primary text-sm font-medium tracking-wide uppercase mb-4">
            {BRAND.category}
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            About <span className="text-gradient">{BRAND.name}</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">{BRAND.subheading}</p>
        </div>
      </section>

      {/* Mission */}
      <section className="py-20 lg:py-28 bg-background-secondary/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="glass-card p-8 lg:p-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">Why we built it</h2>
            <p className="text-foreground text-lg leading-relaxed mb-6">
              Most work starts as a sentence and dies in a thread. Someone says what they want, a
              model answers, and three days later nobody can reconstruct what was decided, who
              approved it, or whether it happened.
            </p>
            <p className="text-foreground-muted leading-relaxed mb-6">
              {BRAND.name} exists to close that gap. The unit of work is not a message — it is a
              compiled workspace: a goal, its constraints, the people involved, the boundaries they
              agreed to, and the outcome that can be checked afterwards.
            </p>
            <p className="text-foreground-muted leading-relaxed">
              That means the interesting engineering is not the chat box. It is the compiler, the
              permission model, and the reconciliation trail. Everything else is interface.
            </p>
          </div>
        </div>
      </section>

      {/* What it is / is not */}
      <section className="py-20 lg:py-28">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-foreground mb-3">What {BRAND.name} is</h3>
              <ul className="space-y-2 text-foreground-muted text-sm leading-relaxed">
                <li>A compiler from plain-language intent to a validated workspace spec</li>
                <li>A consent layer that gates fields and actions, enforced server-side</li>
                <li>An outcome ledger where every number traces back to an event</li>
                <li>An open surface: MCP tools, A2A tasks, a published OpenAPI contract</li>
              </ul>
            </div>
            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-foreground mb-3">What it is not</h3>
              <ul className="space-y-2 text-foreground-muted text-sm leading-relaxed">
                <li>Not a chatbot wrapper — a run that produces no spec or mission is a failure</li>
                <li>Not a general low-code canvas — fields are whitelisted, not free-form</li>
                <li>Not an autonomous agent that acts without approval</li>
                <li>Not a single-player tool — workspaces belong to an organization</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Pipeline */}
      <section className="py-20 lg:py-28 bg-background-secondary/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">How a run works</h2>
            <p className="text-foreground-muted max-w-xl mx-auto">
              Four stages, each one inspectable. If a stage cannot be verified, the run does not
              advance.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {pipeline.map((item, idx) => (
              <div key={item.step} className="glass-card p-5">
                <p className="text-primary font-mono text-xs mb-2">
                  {String(idx + 1).padStart(2, "0")}
                </p>
                <h3 className="text-base font-semibold text-foreground mb-2">{item.step}</h3>
                <p className="text-foreground-muted text-sm leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-20 lg:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              What we optimize for
            </h2>
            <p className="text-foreground-muted max-w-xl mx-auto">
              Design constraints we are willing to lose features over
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {values.map((value) => (
              <div key={value.title} className="glass-card p-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mb-4">
                  <value.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{value.title}</h3>
                <p className="text-foreground-muted leading-relaxed">{value.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 lg:py-28 bg-background-secondary/30">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">
            Start with one sentence
          </h2>
          <p className="text-foreground-muted mb-8">
            Describe an outcome. See what {BRAND.name} compiles it into — before you commit your
            team to anything.
          </p>
          <Link href="/register" className="btn-primary text-lg px-8 py-4">
            Create a workspace
          </Link>
        </div>
      </section>
    </div>
  );
}
