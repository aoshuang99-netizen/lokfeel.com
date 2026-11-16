import { Metadata } from "next";
import Link from "next/link";
import { Target, Users2, Handshake, Lock } from "lucide-react";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  title: `Solutions — ${BRAND.name}`,
  description:
    "Three job stories for an individual, a team, and two parties coordinating an introduction. Each states the input, the approval, the in-app result, and the boundary of what is live today.",
  openGraph: {
    title: `Solutions — ${BRAND.name}`,
    description:
      "Real situations with honest limits: what you put in, what needs approval, what you get, and what is not live yet.",
  },
};

const boundaryText =
  "LokFeel is in a controlled rollout. Today you can state a goal, review the steps, decide what needs your approval, and keep an in-app record of what happened. Not live yet: actions carried out inside external apps, automatic execution across other tools, and independent confirmation that a result was achieved outside LokFeel. We do not present any of those as available.";

const stories = [
  {
    icon: Target,
    id: "For an individual",
    goal: "Break one complicated piece of digital work into steps you can actually act on.",
    input: "A goal in your own words.",
    approval:
      "You review the suggested steps and decide which actions may go ahead. A key action needs your approval, or a second person, before anything runs.",
    result: "An editable list of steps and an in-app record of what you decided and what happened.",
    boundary:
      "Turning those steps into automatic actions across other apps, and independently confirming a result outside LokFeel, are planned and not live today.",
  },
  {
    icon: Users2,
    id: "For a team",
    goal: "Organize a meeting, coordinate roles, and start tasks that people have approved.",
    input: "A shared goal and the people involved.",
    approval:
      "A second person approves key actions. The person who requested an action cannot approve their own request.",
    result: "A task list with an approval trail inside LokFeel, so you can see who agreed to what.",
    boundary:
      "Sending a real calendar invite or a real email to an outside service is planned and not live today. An in-app record is not the same as a delivered message.",
  },
  {
    icon: Handshake,
    id: "For relationship and community collaboration",
    goal: "Arrange an introduction between two parties who have both agreed to it.",
    input: "A request and the fields each party is willing to share.",
    approval:
      "Both parties give explicit, field-level consent before any field is shared. Silence counts as no.",
    result: "A consent record and a read-only view of the agreed fields inside LokFeel.",
    boundary:
      "Delivering a real introduction to an outside channel and getting a result receipt are planned and not live today.",
  },
];

export default function SolutionsPage() {
  return (
    <div className="pt-24 pb-20">
      {/* Hero */}
      <section className="relative py-16 lg:py-20 overflow-hidden">
        <div className="glow-orb glow-orb-secondary w-[600px] h-[600px] -top-20 -right-20 opacity-30" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <p className="text-primary text-sm font-medium tracking-wide uppercase mb-4">Solutions</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6">
            Three situations, <span className="text-gradient">one honest boundary</span>
          </h1>
          <p className="text-xl text-foreground-muted max-w-2xl mx-auto">
            An individual, a team, and two parties coordinating an introduction. For each one: what
            you put in, what needs approval, what you get, and what is not live yet.
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

      {/* Job stories */}
      <section className="py-12 lg:py-16 bg-background-secondary/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-sm text-foreground-subtle mb-8">
            These are job stories that describe current capability and its limits. They are not
            customer case studies and they carry no performance numbers.
          </p>
          <div className="space-y-8">
            {stories.map((story, i) => (
              <article key={story.id} className="glass-card p-8">
                <div className="flex items-center gap-4 mb-5">
                  <div className="w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                    <story.icon className="w-6 h-6 text-primary" aria-hidden />
                  </div>
                  <div>
                    <p className="font-mono text-xs text-primary mb-1">
                      {String(i + 1).padStart(2, "0")}
                    </p>
                    <h2 className="text-2xl font-bold text-foreground">{story.id}</h2>
                  </div>
                </div>
                <p className="text-foreground mb-6">{story.goal}</p>
                <dl className="grid gap-5 md:grid-cols-2">
                  <div>
                    <dt className="text-xs font-bold tracking-widest text-foreground-subtle uppercase mb-1">
                      Input
                    </dt>
                    <dd className="text-sm text-foreground-muted leading-relaxed">{story.input}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold tracking-widest text-foreground-subtle uppercase mb-1">
                      Approval
                    </dt>
                    <dd className="text-sm text-foreground-muted leading-relaxed">{story.approval}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold tracking-widest text-foreground-subtle uppercase mb-1">
                      Result
                    </dt>
                    <dd className="text-sm text-foreground-muted leading-relaxed">{story.result}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold tracking-widest text-foreground-subtle uppercase mb-1">
                      Boundary
                    </dt>
                    <dd className="text-sm text-foreground-muted leading-relaxed">{story.boundary}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-20">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Your situation is the starting point
          </h2>
          <p className="text-foreground-muted mb-8">
            Start with one goal and see the steps, the approvals, and the record for yourself.
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
