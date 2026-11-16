"use client";

/**
 * LANDING PAGE — V22 strategic recovery.
 *
 * Product lock (docs/v22/STRATEGY_LOCK.md):
 *   "Let AI carry the digital complexity so people can return to real life."
 *   ONE Goal -> controllable action -> checkable result -> leave the screen.
 *
 * What changed vs the v4 page this replaces:
 *   - Hero uses the frozen GA candidate copy; no product-architecture words.
 *   - The primary action is a real goal input that carries the typed goal into
 *     signup, not a decorative "compile" demo or a static 3D diagram.
 *   - No live counters, stage names, token chips, MCP/REST stats or "verified"
 *     case numbers on the first screen. Internal evidence lives on /product.
 *   - Capability boundaries are visible in the same screen as the promise,
 *     not hidden in a footer disclaimer.
 *
 * Truth gate: external action execution and independent outcome verification
 * are NOT live. This page must never imply they are.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { withGoal, writeGoalDraft } from "@/lib/goal-draft";

/* ─────────────────────────── design tokens ─────────────────────────── */

const INK = "#0b0e11";
const PAPER = "#f7f5f0";
const SIGNAL_DEEP = "#8a5a1e";
const MUTED = "#5a636b";
const FAINT = "#626a70";
const LINE = "rgba(11,14,17,0.12)";
const WHITE = "#ffffff";

/* ─────────────────────────── goal entry ─────────────────────────── */

const EXAMPLES = [
  "Plan a relocation without losing track of the paperwork",
  "Get three quotes for a home repair and compare them",
  "Coordinate a small event with five people",
];

/**
 * GoalForm is the single primary action. The typed goal is persisted in
 * sessionStorage and passed as ?goal= so /register and /workspace can restore
 * it after auth. No goal is fabricated and nothing is sent to a model here.
 */
function GoalForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [goal, setGoal] = useState("");

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = goal.trim();
    if (trimmed.length < 4) return;
    writeGoalDraft(trimmed);
    router.push(withGoal("/register", trimmed));
  };

  return (
    <form onSubmit={submit} className={compact ? "w-full" : "w-full max-w-[34rem]"}>
      <label
        htmlFor="goal-input"
        className="font-mono text-[10.5px] uppercase tracking-[0.18em]"
        style={{ color: FAINT }}
      >
        What do you want to get done?
      </label>
      <textarea
        id="goal-input"
        name="goal"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        rows={compact ? 2 : 3}
        maxLength={240}
        className="mt-2.5 w-full resize-none rounded-xl border px-4 py-3 text-[16px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-[#8a5a1e]"
        style={{ borderColor: LINE, background: WHITE, color: INK }}
        placeholder="e.g. Get three quotes for a home repair and compare them"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-6 py-3 text-[14.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          style={{ background: INK }}
          disabled={goal.trim().length < 4}
        >
          Try with a goal
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
        <Link
          href="/how-it-works"
          className="inline-flex min-h-11 items-center rounded-full border px-5 py-3 text-[14.5px] font-medium transition-colors hover:bg-black/[0.03]"
          style={{ borderColor: LINE, color: INK }}
        >
          See a real walkthrough
        </Link>
      </div>
      {!compact && (
        <div className="mt-5 flex flex-wrap gap-2">
          {EXAMPLES.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => setGoal(sample)}
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
    t: "Say the goal",
    d: "Write what you want done in your own words. No setup, no template to fill in first.",
  },
  {
    n: "02",
    t: "Approve what matters",
    d: "Read the proposed steps, edit them, and decide which actions need your explicit yes.",
  },
  {
    n: "03",
    t: "See what happened",
    d: "Each step leaves a record you can open. A task being created is not the same as the result being achieved.",
  },
];

const SCENARIOS = [
  {
    t: "For one person",
    d: "Turn a messy personal task into a short list of steps, and be reminded when a decision is yours to make.",
    now: "Goal to editable steps · explicit decisions · an in-app record",
    later: "Sending those steps to outside services on your behalf",
  },
  {
    t: "For a small team",
    d: "Agree on who does what before anything runs, and keep a record of what was actually approved.",
    now: "Shared tasks · a second person must approve consequential actions",
    later: "Automatic delivery to external calendars or mail",
  },
  {
    t: "For a relationship",
    d: "Arrange an introduction only after both people have agreed to share the relevant details.",
    now: "Field-level consent · silence means no · withdrawal of access",
    later: "Independent confirmation that the introduction really happened",
  },
];

const BOUNDARIES = [
  {
    state: "Available today",
    tone: SIGNAL_DEEP,
    items: [
      "Turn a goal into steps you can edit",
      "Decide which fields another person may see",
      "Keep an in-app record of what was run",
    ],
  },
  {
    state: "Needs your approval",
    tone: INK,
    items: [
      "Any consequential action waits for an explicit decision",
      "A different person must approve a request they did not raise",
      "Approvals expire and can be withdrawn",
    ],
  },
  {
    state: "Not live yet",
    tone: MUTED,
    items: [
      "Sending actions to outside services",
      "Receipts from an external provider",
      "Independent verification that the outcome was achieved",
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
              Say what you want done.
              <br className="hidden sm:block" />{" "}Stay in control.
              <br className="hidden sm:block" />{" "}
              <span style={{ color: SIGNAL_DEEP }}>See what actually happened.</span>
            </h1>

            <p className="mt-6 max-w-[42rem] text-[17px] leading-[1.6] sm:text-[18px]" style={{ color: MUTED }}>
              Turn one goal into clear steps, approve the actions that matter, and track
              evidence-backed progress. Then get back to your day.
            </p>

            <div className="mt-9">
              <GoalForm />
            </div>

            {/* Truth gate: on the same screen as the promise, not in a footer. */}
            <div
              className="mt-10 max-w-[46rem] rounded-xl border-l-2 px-4 py-3.5"
              style={{ borderColor: SIGNAL_DEEP, background: "rgba(184,134,63,0.07)" }}
            >
              <p className="text-[13.5px] leading-relaxed" style={{ color: INK }}>
                <span className="font-semibold">Where the product stands today: </span>
                planning, explicit approval and an in-app record are working. Sending actions
                to outside services and independently verifying a result are not live yet.
                We will not describe a task as a completed outcome.
              </p>
            </div>
          </div>
        </section>

        {/* ── THREE STEPS ── */}
        <section className="mx-auto max-w-6xl px-5 py-14 sm:px-6 sm:py-20">
          <h2 className="font-display text-[1.65rem] font-bold tracking-[-0.02em] sm:text-[2rem]">
            Three steps. You stay in the loop.
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

        {/* ── JOB STORIES ── */}
        <section className="border-y" style={{ borderColor: LINE, background: WHITE }}>
          <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6 sm:py-20">
            <h2 className="font-display text-[1.65rem] font-bold tracking-[-0.02em] sm:text-[2rem]">
              Start with your own goal.
            </h2>
            <p className="mt-3 max-w-[42rem] text-[15px] leading-relaxed" style={{ color: MUTED }}>
              Teams and relationships are things a goal can involve, not things you have to
              understand before you begin.
            </p>
            <div className="mt-8 grid gap-5 lg:grid-cols-3">
              {SCENARIOS.map((s) => (
                <article key={s.t} className="rounded-2xl border p-5 sm:p-6" style={{ borderColor: LINE }}>
                  <h3 className="font-display text-[17px] font-bold">{s.t}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed" style={{ color: MUTED }}>
                    {s.d}
                  </p>
                  <dl className="mt-5 space-y-3 text-[12.5px] leading-relaxed">
                    <div>
                      <dt className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: SIGNAL_DEEP }}>
                        Now
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
                Every capability is labelled. If it is not live, we say so here rather than
                letting a screenshot imply otherwise.
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
              Bring one real goal. Keep the rest of your day.
            </h2>
            <p className="mt-4 max-w-[38rem] text-[14.5px] leading-relaxed" style={{ color: "rgba(242,241,236,0.72)" }}>
              Your goal is carried into signup, so you do not have to start over after creating
              an account.
            </p>
            <div className="mt-8">
              <GoalForm compact />
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
