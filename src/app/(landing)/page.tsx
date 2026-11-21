"use client";

/**
 * LANDING PAGE — V25.6 value-first reset.
 *
 * 5-second promise (V25.6-GA closure, copy deck §1 variant B — the honest
 *   version used UNTIL a real model passes independent evaluation):
 *   "Conversations belong to people."
 *   "Talk to real people and stay in control of what you share. AI writing
 *    assistance is being tested privately."
 *   Variant A ("Say it better — with AI…") may ONLY ship once a real model
 *   trace + independent review pass; claiming it early would be a fake promise.
 *   The first screen reads as a place for REAL human conversation — NOT as a
 *   generic AI SaaS, an enterprise console, or a dating engine.
 *
 * V25.6 corrections vs the V23 "relationship-first" page this replaces:
 *   - Lead with what the user can DO (express a thought to a real person, with
 *     an AI draft they review), not with system modules or "meet people" funnels.
 *   - Single primary CTA carries a real message draft into signup, so the first
 *     action after login is a real conversation — not a configuration workspace.
 *   - Honest capability boundary on the same screen: AI suggestions require the
 *     user's confirmation; cloud processing requires explicit, server-issued
 *     consent; unlaunched capabilities are never shown as available.
 *   - No fake people, compatibility percentages, counters, published prices or
 *     "verified success" numbers. Message draft stays in sessionStorage only —
 *     never in a URL (private message text must not leak into links/history).
 *
 * Truth gate: real cross-language AI drafts require a configured provider AND a
 * server-issued processing consent; without them the product degrades honestly
 * (labelled, never passed off as AI output). Nothing here implies that outcome
 * data, pricing or publicly verified results exist.
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

/* ───────────────────── real-message entry (V25.6) ───────────────────── */

/** Examples are things a person might want help expressing. No invented people. */
const INTENT_EXAMPLES = [
  "I want to reply to a colleague in English, but I'm not sure my wording is polite enough",
  "I need to explain a sensitive decision to a friend without hurting them",
  "I'd like to suggest a time to meet a group, clearly and without ambiguity",
];

/**
 * IntentForm is the single primary action. It captures what the visitor wants
 * to SAY to a real person. The draft lives in sessionStorage and is restored
 * after signup into the real chat flow — nothing is sent to a model here,
 * nothing is written to a URL, and no recipient is fabricated.
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
        // compact 表单落在深色 CTA 区块上：用浅灰保证 ≥4.5:1（WCAG 2.2 AA）
        style={{ color: compact ? "rgba(242,241,236,0.78)" : FAINT }}
      >
        What would you like to say to someone?
      </label>
      <textarea
        id="goal-input"
        name="goal"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        rows={compact ? 2 : 3}
        maxLength={500}
        className="mt-2.5 w-full resize-none rounded-xl border px-4 py-3 text-[16px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-[#8a5a1e]"
        style={{ borderColor: LINE, background: WHITE, color: INK }}
        placeholder="e.g. I want to thank a colleague in English and suggest we talk next week"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-6 py-3 text-[14.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          style={{ background: INK }}
          disabled={intent.trim().length < 4}
          data-testid="intent-submit"
        >
          Start a real conversation
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
        <Link
          href="/how-it-works"
          className="inline-flex min-h-11 items-center rounded-full border px-5 py-3 text-[14.5px] font-medium transition-colors hover:bg-black/[0.03]"
          style={{ borderColor: LINE, color: INK }}
        >
          How private AI works
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
    t: "Write what you mean",
    d: "Type the message to a real person in your own words. No need to learn agents, workspaces or pipelines first.",
  },
  {
    n: "02",
    t: "Let AI help — if you ask",
    d: "Ask for a translation, a clearer tone or intent help. You see what the AI would say, where it was processed, and what it is unsure about.",
  },
  {
    n: "03",
    t: "You review, you send",
    d: "Edit or reject the draft. Only your confirmed message is sent, and you see real delivered and read states — never a simulated one.",
  },
];

/** Two products, kept visibly separate (STRATEGY_LOCK §2). */
const PRODUCTS = [
  {
    t: "For you and your contacts",
    d: "Get across language barriers and say delicate things well, to real people you already know — with a private AI helper that respects your boundaries.",
    now: "Real chat · reviewable AI drafts · per-use cloud consent you control",
    later: "Independent language-quality evaluation results (not published yet)",
  },
  {
    t: "For teams and communities",
    d: "Give real members a shared space with AI that helps everyone understand each other — with clear roles and organisation data kept separate from private notes.",
    now: "Separate organisation spaces · visible AI identity · explicit permissions",
    later: "Approved pricing and organisation reports (not approved)",
  },
];

const BOUNDARIES = [
  {
    state: "Working today",
    tone: SIGNAL_DEEP,
    items: [
      "Send and receive real messages with accurate delivery and read states",
      "AI writing help in private testing — draft-only, never auto-sent",
      "Server-issued, revocable consent before any text reaches a cloud model",
    ],
  },
  {
    state: "Needs your consent",
    tone: INK,
    items: [
      "Cloud translation and expression help — only with an explicit grant",
      "Any organisation knowledge used to help a member communicate",
      "A revoke takes effect immediately for future reads and drafts",
    ],
  },
  {
    state: "Not live yet",
    tone: MUTED,
    items: [
      "Independently evaluated language quality or 'understands you' claims",
      "Published prices, customer results or success rates",
      "Guaranteed outcomes for relationships or group decisions",
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
              className="max-w-[20ch] font-display text-[2.25rem] font-extrabold leading-[1.03] tracking-[-0.035em] sm:text-[3.15rem] lg:text-[3.5rem]"
              style={{ color: INK }}
            >
              Conversations belong to people.
              <br className="hidden sm:block" />{" "}
              <span style={{ color: SIGNAL_DEEP }}>You decide what you share.</span>
            </h1>

            <p className="mt-6 max-w-[42rem] text-[17px] leading-[1.6] sm:text-[18px]" style={{ color: MUTED }}>
              Talk to real people and stay in control of what you share. AI writing assistance —
              translation, clearer tone, intent help — is being tested privately and is not yet
              a published capability. You can have a real conversation here today, with no setup.
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
                <span className="font-semibold">Where the product stands: </span>
                you can write to real contacts and read their replies today. AI writing help is
                in private testing — when it is enabled for you, it only ever produces a draft
                for your review and never sends on your behalf; cloud processing needs an
                explicit, server-issued consent you can revoke. No outcome data, pricing or
                verified success rates are published.
              </p>
            </div>
          </div>
        </section>

        {/* ── THREE STEPS ── */}
        <section className="mx-auto max-w-6xl px-5 py-14 sm:px-6 sm:py-20">
          <h2 className="font-display text-[1.65rem] font-bold tracking-[-0.02em] sm:text-[2rem]">
            One real conversation, three honest steps.
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
              One private AI helper, two separate worlds.
            </h2>
            <p className="mt-3 max-w-[42rem] text-[15px] leading-relaxed" style={{ color: MUTED }}>
              Personal conversations and organisation spaces have different boundaries. We keep
              their records, AI permissions and commercial terms apart — your private notes are
              never an administrator&apos;s dashboard.
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
                Every capability is labelled. A revoked consent stops future processing at once,
                and a rejected AI draft is never sent. A draft is never presented as your own
                words, and an in-app state is never presented as a delivery guarantee.
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
              Start with the words you want to say.
            </h2>
            <p className="mt-4 max-w-[38rem] text-[14.5px] leading-relaxed" style={{ color: "rgba(242,241,236,0.72)" }}>
              Your draft stays on this device until you create an account, then opens into a real
              conversation. We never put private message text in a link, and AI suggestions are
              always yours to review before anything is sent.
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
