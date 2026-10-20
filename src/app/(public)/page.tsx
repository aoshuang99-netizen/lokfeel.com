"use client";

/**
 * LANDING PAGE — Connection OS（SaaS AI 生成式平台）
 *
 * 定位：用户描述目标 → 平台把目标**编译**为结构化工作空间（WorkspaceSpec）→
 * 人 + AI Agent 在 Mission / Intent / Consent / Outcome 上协作达成结果。
 *
 * 设计语言（与 `/workspace` 同源，不另起一套）：
 *   · 纸面底 #f7f5f0 + 墨黑字 #0b0e11 + 暖金 signal #b8863f + 发丝线
 *   · 标题 Sora（font-display），正文 Outfit，系统标注用等宽小字母
 *   · 深色段（#0b0e11）只用于「同意门禁 / 收尾 CTA」两处，形成节奏而非全站反色
 *
 * 诚实约束：
 *   1. Hero 里的编译演示**明确标注**为浏览器内 demo 规则，不冒充服务端能力；
 *   2. 不放虚构客户 logo、虚构证言、虚构价格；
 *   3. 数字（5 个 MCP 工具 / 50 条 REST 端点）取自仓库真实实现。
 */

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QuickSignupModal from "@/components/auth/quick-signup-modal";

/* ─────────────────────────── 1. 品牌常量 ─────────────────────────── */

const INK = "#0b0e11";
const PAPER = "#f7f5f0";
const SIGNAL = "#b8863f";
const MUTED = "#5a636b";
const FAINT = "#8a9298";

/* ─────────────────────────── 2. 编译演示（纯前端规则） ─────────────────────────── */

type Extracted = {
  horizon: string | null;
  target: string | null;
};

/** 从目标描述里抽取「期限」与「数量」——只做演示用的启发式，不做业务判断。 */
function extractGoal(goal: string): Extracted {
  const horizonMatch = goal.match(/(\d+)\s*(天|日|周|个月|days?|weeks?|months?)/i);
  const targetMatch = goal.match(
    /(\d+)\s*(次|个|位|人|partners?|introductions?|deals?|calls?|co-investors?|design partners?)/i
  );

  const horizon = horizonMatch
    ? `${horizonMatch[1]} ${
        /天|日|days?/i.test(horizonMatch[2])
          ? "days"
          : /周|weeks?/i.test(horizonMatch[2])
            ? "weeks"
            : "months"
      }`
    : null;

  return { horizon, target: targetMatch ? targetMatch[1] : null };
}

const COMPILE_STEPS = [
  "parse · extracting goal & constraints",
  "spec · validating against workspace schema",
  "assemble · rendering nodes from the allow-list",
];

const SAMPLE_GOALS = [
  "Connect our climate-tech founders with 20 qualified manufacturing partners in 30 days",
  "Introduce 12 vetted design partners to our AI infrastructure team this quarter",
  "Find 8 co-investors for our Series A within 45 days",
];

function CompileDemo() {
  const [goal, setGoal] = useState(SAMPLE_GOALS[0]);
  const [phase, setPhase] = useState<"idle" | "compiling" | "done">("idle");
  const [visibleSteps, setVisibleSteps] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  const parsed = useMemo(() => extractGoal(goal), [goal]);

  const compile = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("compiling");
    setVisibleSteps(0);
    COMPILE_STEPS.forEach((_, i) => {
      timers.current.push(setTimeout(() => setVisibleSteps(i + 1), 260 * (i + 1)));
    });
    timers.current.push(setTimeout(() => setPhase("done"), 260 * COMPILE_STEPS.length + 320));
  };

  const reset = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("idle");
    setVisibleSteps(0);
  };

  return (
    <div
      className="rounded-2xl border bg-white shadow-[0_1px_0_rgba(11,14,17,0.04),0_24px_60px_-32px_rgba(11,14,17,0.25)]"
      style={{ borderColor: "rgba(11,14,17,0.12)" }}
    >
      {/* 顶栏：产品内同款上下文条 */}
      <div
        className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5"
        style={{ borderColor: "rgba(11,14,17,0.08)" }}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: SIGNAL }} aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: MUTED }}>
            Mission studio
          </span>
        </div>
        <span className="font-mono text-[10px] tracking-wide" style={{ color: FAINT }}>
          demo · runs in your browser
        </span>
      </div>

      <div className="p-4 sm:p-5">
        <label
          htmlFor="goal-input"
          className="font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ color: FAINT }}
        >
          Describe the outcome
        </label>
        <textarea
          id="goal-input"
          value={goal}
          onChange={(e) => {
            setGoal(e.target.value);
            reset();
          }}
          rows={2}
          maxLength={180}
          className="mt-2 w-full resize-none rounded-xl border px-3.5 py-3 text-[15px] leading-relaxed outline-none transition-colors focus-visible:ring-2"
          style={{
            borderColor: "rgba(11,14,17,0.14)",
            background: PAPER,
            color: INK,
          }}
          placeholder="e.g. Connect our founders with 20 manufacturing partners in 30 days"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={compile}
            disabled={phase === "compiling" || goal.trim().length < 8}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white transition-transform duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: INK }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
              <circle cx="12" cy="12" r="3.2" />
            </svg>
            {phase === "compiling" ? "Compiling…" : phase === "done" ? "Recompile" : "Compile workspace"}
          </button>

          {SAMPLE_GOALS.slice(1).map((g, i) => (
            <button
              key={i}
              onClick={() => {
                setGoal(g);
                reset();
              }}
              className="cursor-pointer rounded-full border px-3 py-1.5 text-[12px] transition-colors hover:bg-black/[0.03]"
              style={{ borderColor: "rgba(11,14,17,0.14)", color: MUTED }}
            >
              Example {i + 2}
            </button>
          ))}
        </div>

        {/* 编译日志 */}
        <div className="mt-4 space-y-1.5" aria-live="polite">
          {COMPILE_STEPS.map((step, i) => (
            <div
              key={step}
              className="flex items-center gap-2 font-mono text-[11px] transition-opacity duration-300"
              style={{ opacity: visibleSteps > i ? 1 : 0, color: MUTED }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={SIGNAL} strokeWidth="2.4" aria-hidden>
                <path d="M20 6L9 17l-5-5" />
              </svg>
              {step}
            </div>
          ))}
        </div>

        {/* 编译结果：三节点画布 */}
        {phase === "done" && (
          <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
            <NodeCard
              label="Goal & criteria"
              tone="goal"
              lines={[
                goal.length > 58 ? `${goal.slice(0, 58)}…` : goal,
                parsed.horizon ? `Horizon · ${parsed.horizon}` : "Horizon · not stated",
                parsed.target ? `Success · ${parsed.target} connected` : "Success · needs a number",
              ]}
            />
            <NodeCard
              label="Candidate pool"
              tone="candidate"
              lines={[
                "Resolved server-side after consent",
                "Disclosed per field, not per profile",
                "No silent widening of the pool",
              ]}
            />
            <NodeCard
              label="Execution"
              tone="execution"
              lines={[
                "Queue · pending approval",
                "Agents draft, humans approve",
                "Outcome verified before it counts",
              ]}
            />
          </div>
        )}

        <p className="mt-4 text-[11px] leading-relaxed" style={{ color: FAINT }}>
          Demo rules only. In the product, compilation produces a{" "}
          <span className="font-mono">WorkspaceSpec</span> validated on the server — the canvas never
          renders model-authored HTML.
        </p>
      </div>
    </div>
  );
}

function NodeCard({
  label,
  lines,
  tone,
}: {
  label: string;
  lines: string[];
  tone: "goal" | "candidate" | "execution";
}) {
  const accent = tone === "goal" ? SIGNAL : tone === "candidate" ? "#3f8c74" : "rgba(11,14,17,0.55)";
  return (
    <div className="rounded-xl border bg-white p-3" style={{ borderColor: "rgba(11,14,17,0.12)" }}>
      <div className="mb-2 flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} aria-hidden />
        <span className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: accent }}>
          {label}
        </span>
      </div>
      <ul className="space-y-1.5">
        {lines.map((l, i) => (
          <li key={i} className="text-[11.5px] leading-snug" style={{ color: i === 0 ? INK : MUTED }}>
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────── 3. 通用小件 ─────────────────────────── */

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <p
      className="font-mono text-[10px] uppercase tracking-[0.22em]"
      style={{ color: dark ? "rgba(242,241,236,0.45)" : FAINT }}
    >
      {children}
    </p>
  );
}

function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "-60px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, inView };
}

/* ─────────────────────────── 4. 页面 ─────────────────────────── */

export default function LandingPage() {
  const router = useRouter();
  const [signupOpen, setSignupOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // 初始就是顶部（scrolled=false），不在 effect 里同步 setState —— 避免 react-hooks/set-state-in-effect
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const openWorkspace = () => router.push("/workspace");

  return (
    <div style={{ background: PAPER, color: INK }} className="min-h-screen antialiased">
      {/* ── NAV ── */}
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-all duration-300 ${scrolled ? "backdrop-blur-md" : ""}`}
        style={{
          background: scrolled ? "rgba(247,245,240,0.86)" : "transparent",
          borderBottom: scrolled ? "1px solid rgba(11,14,17,0.08)" : "1px solid transparent",
        }}
      >
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-6">
          <Link href="/" className="flex cursor-pointer items-center gap-2.5" aria-label="LokFeel home">
            <span
              className="grid h-7 w-7 place-items-center rounded-md font-display text-[13px] font-bold text-white"
              style={{ background: INK }}
            >
              L
            </span>
            <span className="font-display text-[15px] font-bold tracking-[-0.01em]">LOKFEEL</span>
            <span
              className="ml-1 hidden rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] sm:inline-block"
              style={{ borderColor: "rgba(11,14,17,0.16)", color: MUTED }}
            >
              Connection OS
            </span>
          </Link>

          <div className="hidden items-center gap-7 md:flex">
            {[
              ["Product", "#product"],
              ["How it compiles", "#compile"],
              ["Interop", "#interop"],
              ["Governance", "#governance"],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="text-[13.5px] transition-colors hover:opacity-60"
                style={{ color: MUTED }}
              >
                {label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden cursor-pointer rounded-full px-3.5 py-2 text-[13.5px] transition-colors hover:bg-black/[0.04] sm:block"
              style={{ color: MUTED }}
            >
              Log in
            </Link>
            <button
              onClick={openWorkspace}
              className="cursor-pointer rounded-full px-4 py-2 text-[13.5px] font-medium text-white transition-transform duration-200 hover:-translate-y-px"
              style={{ background: INK }}
            >
              Open workspace
            </button>
          </div>
        </nav>
      </header>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden pb-16 pt-28 sm:pb-20 sm:pt-32">
        {/* 纸面网格：极淡，给「工作台」以秩序感 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(11,14,17,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(11,14,17,0.045) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
            maskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, black, transparent 78%)",
            WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, black, transparent 78%)",
          }}
        />

        <div className="relative mx-auto grid max-w-6xl gap-10 px-5 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-start lg:gap-14">
          <div className="lg:pt-6">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: SIGNAL }} aria-hidden />
              <Eyebrow>AI-native workspace · organisations &amp; agents</Eyebrow>
            </div>

            <h1
              className="mt-5 font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.035em] sm:text-[3.4rem] lg:text-[3.9rem]"
              style={{ color: INK }}
            >
              Describe the outcome.
              <br />
              Get a workspace
              <br />
              <span style={{ color: SIGNAL }}>that runs it.</span>
            </h1>

            <p className="mt-6 max-w-xl text-[16.5px] leading-[1.65]" style={{ color: MUTED }}>
              LokFeel compiles a goal into a structured workspace — missions, consent gates and AI
              agents — then runs the pipeline with your team. Every number is traceable to an
              endpoint, every disclosure is explicit, every outcome has to be verified.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                onClick={openWorkspace}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full px-5 py-3 text-[14.5px] font-medium text-white transition-transform duration-200 hover:-translate-y-px"
                style={{ background: INK }}
              >
                Open your workspace
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
              <button
                onClick={() => setSignupOpen(true)}
                className="cursor-pointer rounded-full border px-5 py-3 text-[14.5px] font-medium transition-colors hover:bg-black/[0.03]"
                style={{ borderColor: "rgba(11,14,17,0.16)", color: INK }}
              >
                Create an account
              </button>
            </div>

            {/* 证据行：真实实现数字 */}
            <dl
              className="mt-9 grid max-w-lg grid-cols-2 gap-x-6 gap-y-3 border-t pt-5 sm:grid-cols-4"
              style={{ borderColor: "rgba(11,14,17,0.1)" }}
            >
              {[
                ["5", "MCP tools"],
                ["50", "REST v1 routes"],
                ["Per-field", "consent"],
                ["Tenant", "isolated"],
              ].map(([v, k]) => (
                <div key={k}>
                  <dt className="font-display text-[17px] font-bold leading-tight">{v}</dt>
                  <dd className="font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: FAINT }}>
                    {k}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="lg:pt-2">
            <CompileDemo />
          </div>
        </div>
      </section>

      {/* ── HOW IT COMPILES ── */}
      <section id="compile" className="mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <Eyebrow>How it compiles</Eyebrow>
          <h2 className="mt-3 font-display text-[1.9rem] font-bold leading-[1.1] tracking-[-0.025em] sm:text-[2.4rem]">
            A goal is not a to-do list.
            <br />
            It is a structure.
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed" style={{ color: MUTED }}>
            Four stages, each with a verifiable artefact — so the workspace can be inspected,
            replayed and audited instead of trusted.
          </p>
        </div>

        <ol
          className="mt-10 grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-2 lg:grid-cols-4"
          style={{ borderColor: "rgba(11,14,17,0.12)", background: "rgba(11,14,17,0.12)" }}
        >
          {[
            {
              n: "01",
              title: "Describe",
              body: "One sentence in, constraints extracted. No forms, no wizard, no taxonomy to learn.",
            },
            {
              n: "02",
              title: "Compile",
              body: "Text becomes a WorkspaceSpec — schema-validated, rendered from a fixed node allow-list.",
            },
            {
              n: "03",
              title: "Coordinate",
              body: "Mission → intent → proposal → workflow. Agents draft; humans approve the risky steps.",
            },
            {
              n: "04",
              title: "Prove",
              body: "Outcomes are reported, verified and metered. A claim only counts once it is confirmed.",
            },
          ].map((s) => (
            <li key={s.n} className="bg-white p-6">
              <span className="font-mono text-[10px] tracking-[0.2em]" style={{ color: SIGNAL }}>
                {s.n}
              </span>
              <h3 className="mt-3 font-display text-[17px] font-bold">{s.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: MUTED }}>
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── PRODUCT SURFACES ── */}
      <section id="product" className="mx-auto max-w-6xl px-5 pb-16 sm:px-6 sm:pb-20">
        <Eyebrow>Three surfaces, one graph</Eyebrow>
        <h2 className="mt-3 max-w-2xl font-display text-[1.9rem] font-bold leading-[1.1] tracking-[-0.025em] sm:text-[2.4rem]">
          The workspace you work in. The console you run it from. The protocol others connect through.
        </h2>

        <div className="mt-9 grid gap-4 lg:grid-cols-3">
          <SurfaceCard
            tag="Living Workspace"
            title="Where the work happens"
            items={[
              "Now — today's queue, with evidence links",
              "Studio — describe → compile → canvas",
              "Field — the relationship graph",
              "Consent — per-field disclosure gates",
              "Outcomes — what actually landed",
              "Agents — runs, approvals, usage",
            ]}
            primary
          />
          <SurfaceCard
            tag="Console"
            title="Where the org runs it"
            items={[
              "Queue health & dead letters",
              "Stalled connections, not just failures",
              "Missions, members and roles",
              "Outcome verification",
              "Delivery counts that never inflate",
            ]}
          />
          <SurfaceCard
            tag="Interop"
            title="Where others connect"
            items={[
              "MCP — 5 tools over Streamable HTTP",
              "A2A — agent card & task endpoint",
              "REST v1 — 50 routes",
              "OpenAPI contract in the repo",
              "Runnable SDK examples",
            ]}
          />
        </div>
      </section>

      {/* ── CONSENT (dark) ── */}
      <section id="governance" style={{ background: INK }} className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div>
              <Eyebrow dark>Consent by design</Eyebrow>
              <h2 className="mt-3 font-display text-[1.9rem] font-bold leading-[1.1] tracking-[-0.025em] text-[#f2f1ec] sm:text-[2.3rem]">
                Disclosure is a field-level decision.
                <span className="block" style={{ color: "rgba(242,241,236,0.5)" }}>
                  Absence means no.
                </span>
              </h2>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed" style={{ color: "rgba(242,241,236,0.62)" }}>
                Most platforms ask for a profile. We ask, field by field, who may see it. A missing
                entry is never treated as permission — it stays private, by default, forever.
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  "No silent widening when a proposal is created",
                  "Import from profile requires an explicit, timestamped grant",
                  "Withdrawal takes effect on the next projection, not the next deploy",
                ].map((t) => (
                  <li
                    key={t}
                    className="flex gap-2.5 text-[13.5px] leading-relaxed"
                    style={{ color: "rgba(242,241,236,0.72)" }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={SIGNAL}
                      strokeWidth="2.2"
                      className="mt-1 shrink-0"
                      aria-hidden
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            {/* 披露表：真实受众档位 */}
            <div
              className="overflow-hidden rounded-2xl border"
              style={{ borderColor: "rgba(242,241,236,0.14)", background: "#171c21" }}
            >
              <div
                className="flex items-center justify-between border-b px-4 py-3"
                style={{ borderColor: "rgba(242,241,236,0.1)" }}
              >
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.18em]"
                  style={{ color: "rgba(242,241,236,0.45)" }}
                >
                  disclosure map
                </span>
                <span className="font-mono text-[10px]" style={{ color: SIGNAL }}>
                  fail-closed
                </span>
              </div>
              <table className="w-full text-left">
                <thead>
                  <tr
                    className="font-mono text-[9.5px] uppercase tracking-[0.12em]"
                    style={{ color: "rgba(242,241,236,0.4)" }}
                  >
                    <th className="px-4 py-2.5 font-normal">Field</th>
                    <th className="px-3 py-2.5 font-normal">Self</th>
                    <th className="px-3 py-2.5 font-normal">Organiser</th>
                    <th className="px-3 py-2.5 font-normal">Counterparty</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Name", true, true, true],
                    ["Role & focus", true, true, true],
                    ["Company", true, true, false],
                    ["Contact channel", true, false, false],
                    ["Evaluation notes", true, false, false],
                  ].map((row) => (
                    <tr
                      key={String(row[0])}
                      className="border-t"
                      style={{ borderColor: "rgba(242,241,236,0.07)" }}
                    >
                      <td className="px-4 py-2.5 text-[13px]" style={{ color: "rgba(242,241,236,0.86)" }}>
                        {row[0] as string}
                      </td>
                      {row.slice(1).map((on, i) => (
                        <td key={i} className="px-3 py-2.5">
                          {on ? (
                            <span
                              className="inline-block h-1.5 w-1.5 rounded-full"
                              style={{ background: SIGNAL }}
                              aria-label="visible"
                            />
                          ) : (
                            <span
                              className="inline-block h-px w-2.5"
                              style={{ background: "rgba(242,241,236,0.22)" }}
                              aria-label="hidden"
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p
                className="border-t px-4 py-3 text-[11px] leading-relaxed"
                style={{ borderColor: "rgba(242,241,236,0.1)", color: "rgba(242,241,236,0.4)" }}
              >
                Illustrative map. Values live in each intent&apos;s disclosure table — defaults are
                never written back on save.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── INTEROP ── */}
      <section id="interop" className="mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
          <div>
            <Eyebrow>Machine-readable</Eyebrow>
            <h2 className="mt-3 font-display text-[1.9rem] font-bold leading-[1.1] tracking-[-0.025em] sm:text-[2.3rem]">
              Discovery is public.
              <br />
              Collaboration is authorised.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed" style={{ color: MUTED }}>
              An external agent can see what the server offers before it has any permission.
              Touching data requires a session, a tenant and a capability — checked per tool, not
              per route.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {["MCP 2025-06-18", "A2A", "REST v1", "OpenAPI"].map((t) => (
                <span
                  key={t}
                  className="rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-wide"
                  style={{ borderColor: "rgba(11,14,17,0.16)", color: MUTED }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: "rgba(11,14,17,0.12)" }}>
            <div
              className="flex items-center gap-1.5 border-b px-4 py-2.5"
              style={{ borderColor: "rgba(11,14,17,0.08)" }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: "rgba(11,14,17,0.14)" }} aria-hidden />
              <span className="h-2 w-2 rounded-full" style={{ background: "rgba(11,14,17,0.14)" }} aria-hidden />
              <span className="h-2 w-2 rounded-full" style={{ background: "rgba(11,14,17,0.14)" }} aria-hidden />
              <span className="ml-2 font-mono text-[10px]" style={{ color: FAINT }}>
                lokfeel-connection-os
              </span>
            </div>
            <pre
              className="overflow-x-auto px-4 py-4 font-mono text-[11.5px] leading-[1.85]"
              style={{ color: MUTED }}
            >
              {`MCP   initialize · tools/list · tools/call
      ├ list_missions      ├ list_bridges
      ├ bridge_discovery   ├ list_outcomes
      └ report_outcome

A2A   GET  /.well-known/agent-card.json
      POST /api/v1/a2a/tasks

REST  /api/v1/missions · /intents · /connections
      /workflow/jobs · /outcomes · /bridges
      /billing/usage · /org · /members`}
            </pre>
            <div
              className="border-t px-4 py-3 text-[11px]"
              style={{ borderColor: "rgba(11,14,17,0.08)", color: FAINT }}
            >
              Unauthenticated calls return <span className="font-mono" style={{ color: INK }}>401</span>.
              Insufficient capability fails at the tool level, not the protocol level.
            </div>
          </div>
        </div>
      </section>

      {/* ── GOVERNANCE ── */}
      <section className="mx-auto max-w-6xl px-5 pb-16 sm:px-6 sm:pb-20">
        <div
          className="grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-3"
          style={{ borderColor: "rgba(11,14,17,0.12)", background: "rgba(11,14,17,0.12)" }}
        >
          {[
            {
              t: "Tenant isolation",
              d: "Every query is scoped by organisation first. The client never supplies the tenant — it is resolved from the session.",
            },
            {
              t: "Audit, not logs",
              d: "Security events and business actions are recorded separately, with soft references that survive account deletion.",
            },
            {
              t: "Metered, not guessed",
              d: "Usage is collected, reconciled and billed per event. Captured sandbox deliveries are never counted as sent.",
            },
          ].map((c) => (
            <div key={c.t} className="bg-white p-6">
              <h3 className="font-display text-[15.5px] font-bold">{c.t}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: MUTED }}>
                {c.d}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl px-6 py-12 sm:px-12 sm:py-14" style={{ background: INK }}>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(600px 240px at 85% 10%, rgba(184,134,63,0.22), transparent 70%)",
            }}
          />
          <div className="relative flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
            <div>
              <Eyebrow dark>Start with one real goal</Eyebrow>
              <h2 className="mt-3 max-w-xl font-display text-[1.9rem] font-bold leading-[1.08] tracking-[-0.025em] text-[#f2f1ec] sm:text-[2.5rem]">
                Bring the outcome you are actually chasing.
              </h2>
              <p className="mt-3 max-w-md text-[14.5px] leading-relaxed" style={{ color: "rgba(242,241,236,0.6)" }}>
                Compile it, invite your team, and watch the pipeline run — with every disclosure and
                every outcome on the record.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={openWorkspace}
                className="cursor-pointer rounded-full px-5 py-3 text-[14.5px] font-medium text-[#0b0e11] transition-transform duration-200 hover:-translate-y-px"
                style={{ background: "#f2f1ec" }}
              >
                Open workspace
              </button>
              <button
                onClick={() => setSignupOpen(true)}
                className="cursor-pointer rounded-full border px-5 py-3 text-[14.5px] font-medium transition-colors"
                style={{ borderColor: "rgba(242,241,236,0.22)", color: "#f2f1ec" }}
              >
                Create account
              </button>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />

      <QuickSignupModal isOpen={signupOpen} onClose={() => setSignupOpen(false)} />
    </div>
  );
}

/* ─────────────────────────── 5. 浅色页脚（与纸面底同源） ─────────────────────────── */

const FOOTER_COLUMNS: Array<{ title: string; links: Array<[string, string]> }> = [
  {
    title: "Product",
    links: [
      ["Living Workspace", "/workspace"],
      ["Console", "/console"],
      ["Log in", "/login"],
      ["Create account", "/register"],
    ],
  },
  {
    title: "Developers",
    links: [
      ["Agent card", "/.well-known/agent-card.json"],
      ["OpenAPI contract", "https://github.com/aoshuang99-netizen/lokfeel.com/blob/main/contracts/connection.openapi.yaml"],
      ["MCP server route", "https://github.com/aoshuang99-netizen/lokfeel.com/blob/main/src/app/api/mcp/route.ts"],
      ["SDK examples", "https://github.com/aoshuang99-netizen/lokfeel.com/tree/main/examples/sdk"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About", "/about"],
      ["Careers", "/careers"],
      ["Press", "/press"],
      ["Contact", "/contact"],
    ],
  },
  {
    title: "Trust & legal",
    links: [
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Cookies", "/cookies"],
      ["Security", "/security"],
      ["DMCA", "/dmca"],
      ["Sub-processors", "/sub-processors"],
    ],
  },
];

function SiteFooter() {
  return (
    <footer className="border-t" style={{ borderColor: "rgba(11,14,17,0.1)" }}>
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.2fr_repeat(4,1fr)]">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="grid h-6 w-6 place-items-center rounded font-display text-[11px] font-bold text-white"
                style={{ background: INK }}
              >
                L
              </span>
              <span className="font-display text-[14px] font-bold">LOKFEEL</span>
            </div>
            <p className="mt-3 max-w-[220px] text-[12px] leading-relaxed" style={{ color: FAINT }}>
              Connection OS for AI-native teams. Compile a goal into a workspace that runs it.
            </p>
          </div>

          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <h4
                className="font-mono text-[9.5px] uppercase tracking-[0.16em]"
                style={{ color: FAINT }}
              >
                {col.title}
              </h4>
              <ul className="mt-3 space-y-2">
                {col.links.map(([label, href]) => (
                  <li key={href}>
                    {href.startsWith("http") ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12.5px] transition-colors hover:opacity-60"
                        style={{ color: MUTED }}
                      >
                        {label}
                      </a>
                    ) : (
                      <Link
                        href={href}
                        className="text-[12.5px] transition-colors hover:opacity-60"
                        style={{ color: MUTED }}
                      >
                        {label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          className="mt-10 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: "rgba(11,14,17,0.08)" }}
        >
          <p className="font-mono text-[10px]" style={{ color: FAINT }}>
            © {new Date().getFullYear()} LokFeel · Connection OS
          </p>
          <p className="font-mono text-[10px]" style={{ color: FAINT }}>
            MCP 2025-06-18 · A2A · REST v1 · tenant-isolated
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────── 5. 产品面卡片 ─────────────────────────── */

function SurfaceCard({
  tag,
  title,
  items,
  primary = false,
}: {
  tag: string;
  title: string;
  items: string[];
  primary?: boolean;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="rounded-2xl border p-6 transition-all duration-500"
      style={{
        borderColor: primary ? "rgba(11,14,17,0.2)" : "rgba(11,14,17,0.12)",
        background: primary ? "#ffffff" : "rgba(255,255,255,0.55)",
        opacity: inView ? 1 : 0,
        transform: inView ? "none" : "translateY(10px)",
      }}
    >
      <span className="font-mono text-[9.5px] uppercase tracking-[0.18em]" style={{ color: SIGNAL }}>
        {tag}
      </span>
      <h3 className="mt-2 font-display text-[18px] font-bold leading-snug">{title}</h3>
      <ul className="mt-4 space-y-2">
        {items.map((t) => (
          <li key={t} className="flex gap-2 text-[13px] leading-relaxed" style={{ color: MUTED }}>
            <span
              className="mt-[7px] h-1 w-1 shrink-0 rounded-full"
              style={{ background: "rgba(11,14,17,0.3)" }}
              aria-hidden
            />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}
