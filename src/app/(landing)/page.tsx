"use client";

/**
 * LANDING PAGE — V23 Relationship-first reset.
 *
 * Product lock (docs/v23/STRATEGY_LOCK.md §1):
 *   "AI-Native Relationship & Generative Social Platform"
 *   Real Person -> Relationship Intent -> AI Recommendation -> Mutual Consent
 *   -> Verified Introduction -> Communication -> Follow-up -> Relationship Outcome
 *
 * What changed vs the V22 page this replaces:
 *   - The first screen is about real people and trusted introductions, not an
 *     "any goal you want done" personal agent OS.
 *   - The single primary action asks what kind of relationship the visitor
 *     wants to build. It is a real draft carried into signup, not a demo.
 *   - No fake people, no compatibility percentages, no fake counters, no
 *     published prices, no "verified success" case numbers.
 *   - Relationship intent is kept in sessionStorage only. V23 U06 forbids
 *     private preferences in the URL; the legacy `?goal=` reader is retained
 *     for old links but no new link writes private intent into a URL.
 *   - Capability boundaries are on the same screen as the promise.
 *
 * Truth gate: there are NO real two-sided introduction samples yet. Nothing on
 * this page may imply that introductions have been delivered or that a
 * relationship outcome has been achieved.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { writeGoalDraft } from "@/lib/goal-draft";

/* ─────────────────────────── design tokens ─────────────────────────── */

const INK = "#0b0e11";
const PAPER = "#f7f5f0";
const SIGNAL_DEEP = "#8a5a1e";
const MUTED = "#5a636b";
const FAINT = "#626a70";
const LINE = "rgba(11,14,17,0.12)";
const WHITE = "#ffffff";

/* ───────────────────── relationship intent entry ───────────────────── */

/** Examples describe intent only. No sensitive attributes, no invented people. */
const INTENT_EXAMPLES = [
  "I'd like to meet someone who shares my pace of life and wants something long-term",
  "I want to be introduced to people in my city who care about the same things I do",
  "Our community would like to introduce two members who could work well together",
];

/**
 * IntentForm is the single primary action. The draft lives in sessionStorage
 * and is restored by /register and the signed-in home. Nothing is sent to a
 * model here, nothing is written to the URL, and no candidate is fabricated.
 */
function IntentForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [intent, setIntent] = useState("");

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = intent.trim();
    if (trimmed.length < 4) return;
    // V23 U06: private relationship intent must not appear in a URL.
    writeGoalDraft(trimmed);
    router.push("/register");
  };

  return (
    <form onSubmit={submit} className={compact ? "w-full" : "w-full max-w-[34rem]"}>
      <label
        htmlFor="goal-input"
        className="font-mono text-[10.5px] uppercase tracking-[0.18em]"
        style={{ color: FAINT }}
      >
        Who would you like to meet?
      </label>
      <textarea
        id="goal-input"
        name="goal"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        rows={compact ? 2 : 3}
        maxLength={240}
        className="mt-2.5 w-full resize-none rounded-xl border px-4 py-3 text-[16px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-[#8a5a1e]"
        style={{ borderColor: LINE, background: WHITE, color: INK }}
        placeholder="e.g. I'd like to meet someone who wants a long-term relationship and lives nearby"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-6 py-3 text-[14.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          style={{ background: INK }}
          disabled={intent.trim().length < 4}
          data-testid="intent-submit"
        >
          Start with this intent
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
        <Link
          href="/how-it-works"
          className="inline-flex min-h-11 items-center rounded-full border px-5 py-3 text-[14.5px] font-medium transition-colors hover:bg-black/[0.03]"
          style={{ borderColor: LINE, color: INK }}
        >
          How an introduction works
        </Link>
      </div>
      {!compact && (
        <div className="mt-5 flex flex-wrap gap-2">
          {INTENT_EXAMPLES.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => setIntent(sample)}
              className="cursor-pointer rounded-full border px-3 py-2 text-left text-[12px] leading-snug transition-colors hover:bg-black/[0.03]"
              style={{ borderColor: LINE, color: MUTED }}
            >
              {sample}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

/* ─────────────────────────── page sections ─────────────────────────── */

const STEPS = [
  {
    n: "01",
    t: "Say who you want to meet",
    d: "Describe the kind of relationship you are looking for and the boundaries that matter to you. You can edit it later.",
  },
  {
    n: "02",
    t: "Both people decide",
    d: "You see a small number of real candidates with the reasons for each. Nothing is shared until both sides say yes.",
  },
  {
    n: "03",
    t: "Meet, talk, follow through",
    d: "After a proper introduction you can talk, plan to meet and each give feedback. A sent message is not a relationship result.",
  },
];

/** Two products, kept visibly separate (STRATEGY_LOCK §2). */
const PRODUCTS = [
  {
    t: "For people",
    d: "You want fewer wrong introductions and more people worth knowing. You set the intent, see why someone was suggested, and keep the choice to accept or decline.",
    now: "Relationship intent · explained candidates · a real choice for both sides",
    later: "Published real introduction results (none yet)",
  },
  {
    t: "For community organisers",
    d: "You look after a group of real members and want to make a small number of well-reviewed introductions, then follow what happened.",
    now: "Separate member records · review before anything is sent · follow-up records",
    later: "Paid pilot pricing and organisation-level reporting (not approved)",
  },
];

const BOUNDARIES = [
  {
    state: "Working today",
    tone: SIGNAL_DEEP,
    items: [
      "State and edit a relationship intent",
      "Two independent decisions before contact details are shared",
      "Field-level disclosure, withdrawal and a visible record",
    ],
  },
  {
    state: "Needs both people",
    tone: INK,
    items: [
      "An introduction only after both sides accept",
      "Only the fields each person allowed can be shared",
      "A decline stops further contact instead of being retried",
    ],
  },
  {
    state: "Not live yet",
    tone: MUTED,
    items: [
      "Any real introduction delivered to a person outside this product",
      "Independently confirmed meeting or relationship outcomes",
      "Published prices, customer results or success rates",
    ],
  },
];

/* ─────────────────────────── page ─────────────────────────── */

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div style={{ background: PAPER, color: INK }} className="min-h-screen antialiased">
      <header
        className="fixed inset-x-0 top-0 z-40 transition-colors duration-300"
        style={{
          background: scrolled ? "rgba(247,245,240,0.94)" : "transparent",
          backdropFilter: scrolled ? "blur(10px)" : undefined,
          borderBottom: `1px solid ${scrolled ? LINE : "transparent"}`,
        }}
      >
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="LokFeel home">
            <span
              className="grid h-8 w-8 place-items-center rounded-md font-display text-[13px] font-bold text-white"
              style={{ background: INK }}
            >
              L
            </span>
            <span className="font-display text-[15px] font-bold tracking-[-0.01em]">LOKFEEL</span>
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {[
              ["How it works", "/how-it-works"],
              ["What works today", "/product"],
              ["For communities", "/solutions"],
              ["Pricing", "/pricing"],
            ].map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="inline-flex min-h-11 items-center px-3.5 text-[13.5px] transition-opacity hover:opacity-60"
                style={{ color: MUTED }}
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center rounded-full px-3.5 text-[13.5px] transition-colors hover:bg-black/[0.04]"
              style={{ color: MUTED }}
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="inline-flex min-h-11 items-center rounded-full px-4 text-[13.5px] font-medium text-white transition-opacity hover:opacity-90"
              style={{ background: INK }}
            >
              Start
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* ── HERO: one promise, one primary action, visible boundary ── */}
        <section className="border-b pb-14 pt-28 sm:pb-20 sm:pt-36" style={{ borderColor: LINE }}>
          <div className="mx-auto max-w-6xl px-5 sm:px-6">
            <h1
              className="max-w-[19ch] font-display text-[2.25rem] font-extrabold leading-[1.03] tracking-[-0.035em] sm:text-[3.15rem] lg:text-[3.5rem]"
              style={{ color: INK }}
            >
              Meet people worth knowing.
              <br className="hidden sm:block" />{" "}Both people choose.
              <br className="hidden sm:block" />{" "}
              <span style={{ color: SIGNAL_DEEP }}>Real connections follow.</span>
            </h1>

            <p className="mt-6 max-w-[42rem] text-[17px] leading-[1.6] sm:text-[18px]" style={{ color: MUTED }}>
              LokFeel uses AI to understand the relationship you want, suggests a few real
              people worth meeting with clear reasons, and only shares anything after both
              sides agree. Less wasted social effort, more introductions you can trust.
            </p>

            <div className="mt-9">
              <IntentForm />
            </div>

            {/* Truth gate: on the same screen as the promise. */}
            <div
              className="mt-10 max-w-[46rem] rounded-xl border-l-2 px-4 py-3.5"
              style={{ borderColor: SIGNAL_DEEP, background: "rgba(184,134,63,0.07)" }}
            >
              <p className="text-[13.5px] leading-relaxed" style={{ color: INK }}>
                <span className="font-semibold">Where the product stands today: </span>
                intent capture, two-sided decisions and field-level privacy controls are
                implemented in the product. No real introduction has been delivered to a
                person as part of a pilot yet, and we have no customer results to publish.
                If there is no suitable person, we will tell you rather than invent one.
              </p>
            </div>
          </div>
        </section>

        {/* ── THREE STEPS ── */}
        <section className="mx-auto max-w-6xl px-5 py-14 sm:px-6 sm:py-20">
          <h2 className="font-display text-[1.65rem] font-bold tracking-[-0.02em] sm:text-[2rem]">
            One relationship, three honest steps.
          </h2>
          <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-3" style={{ borderColor: LINE, background: LINE }}>
            {STEPS.map((s) => (
              <div key={s.n} className="px-5 py-6 sm:px-6 sm:py-7" style={{ background: WHITE }}>
                <p className="font-mono text-[11px] tracking-[0.2em]" style={{ color: SIGNAL_DEEP }}>
                  {s.n}
                </p>
                <h3 className="mt-4 font-display text-[17px] font-bold">{s.t}</h3>
                <p className="mt-2 text-[14px] leading-relaxed" style={{ color: MUTED }}>
                  {s.d}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── TWO PRODUCT SHAPES ── */}
        <section className="border-y" style={{ borderColor: LINE, background: WHITE }}>
          <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6 sm:py-20">
            <h2 className="font-display text-[1.65rem] font-bold tracking-[-0.02em] sm:text-[2rem]">
              One relationship engine, two separate products.
            </h2>
            <p className="mt-3 max-w-[42rem] text-[15px] leading-relaxed" style={{ color: MUTED }}>
              People looking to meet someone and community organisers looking after members
              have different needs. We keep their pages, records and commercial terms apart.
            </p>
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              {PRODUCTS.map((s) => (
                <article key={s.t} className="rounded-2xl border p-5 sm:p-6" style={{ borderColor: LINE }}>
                  <h3 className="font-display text-[17px] font-bold">{s.t}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed" style={{ color: MUTED }}>
                    {s.d}
                  </p>
                  <dl className="mt-5 space-y-3 text-[12.5px] leading-relaxed">
                    <div>
                      <dt className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: SIGNAL_DEEP }}>
                        In the product
                      </dt>
                      <dd className="mt-1" style={{ color: INK }}>{s.now}</dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: FAINT }}>
                        Not yet
                      </dt>
                      <dd className="mt-1" style={{ color: MUTED }}>{s.later}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── CAPABILITY BOUNDARY ── */}
        <section id="boundaries" className="mx-auto max-w-6xl px-5 py-14 sm:px-6 sm:py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-[1.65rem] font-bold tracking-[-0.02em] sm:text-[2rem]">
                What you can count on today.
              </h2>
              <p className="mt-3 max-w-[40rem] text-[15px] leading-relaxed" style={{ color: MUTED }}>
                Every capability is labelled. A decline, a withdrawal or a block must stop
                further contact. An in-app record is never presented as a real meeting.
              </p>
            </div>
            <Link
              href="/product"
              className="inline-flex min-h-11 items-center text-[13.5px] font-medium underline underline-offset-4"
              style={{ color: INK }}
            >
              Full capability list
            </Link>
          </div>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {BOUNDARIES.map((b) => (
              <div key={b.state} className="rounded-2xl border p-5" style={{ borderColor: LINE, background: WHITE }}>
                <h3 className="font-display text-[15px] font-bold" style={{ color: b.tone }}>
                  {b.state}
                </h3>
                <ul className="mt-4 space-y-2.5">
                  {b.items.map((it) => (
                    <li key={it} className="flex gap-2 text-[13.5px] leading-relaxed" style={{ color: MUTED }}>
                      <span aria-hidden style={{ color: b.tone }}>·</span>
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-6">
          <div className="rounded-3xl px-6 py-11 sm:px-10 sm:py-14" style={{ background: INK }}>
            <h2 className="max-w-[22ch] font-display text-[1.85rem] font-bold leading-[1.08] tracking-[-0.025em] text-[#f2f1ec] sm:text-[2.3rem]">
              Tell us who is worth meeting. Both of you stay in control.
            </h2>
            <p className="mt-4 max-w-[38rem] text-[14.5px] leading-relaxed" style={{ color: "rgba(242,241,236,0.72)" }}>
              Your intent is kept on this device until you create an account. We never put
              private relationship preferences in a link, and we never show you an invented
              person when there is no suitable match.
            </p>
            <div className="mt-8">
              <IntentForm compact />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t" style={{ borderColor: LINE }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5 px-5 py-8 sm:px-6">
          <div className="flex items-center gap-2">
            <span
              className="grid h-6 w-6 place-items-center rounded-md font-display text-[12px] font-bold text-white"
              style={{ background: INK }}
            >
              L
            </span>
            <span className="font-display text-[13px] font-bold tracking-[-0.01em]">LOKFEEL</span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]" style={{ color: MUTED }}>
            {[
              ["How it works", "/how-it-works"],
              ["What works today", "/product"],
              ["For communities", "/solutions"],
              ["Pricing", "/pricing"],
              ["Help", "/help"],
              ["Log in", "/login"],
            ].map(([label, href]) => (
              <Link key={href} href={href} className="inline-flex min-h-11 items-center hover:opacity-60">
                {label}
              </Link>
            ))}
          </nav>
          <p className="font-mono text-[10px]" style={{ color: FAINT }}>
            © {new Date().getFullYear()} LokFeel
          </p>
        </div>
      </footer>
    </div>
  );
}
