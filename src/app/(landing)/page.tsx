"use client";

/**
 * LANDING PAGE — Connection OS · v4（极简 + 活数据）
 *
 * v4 改版依据（用户反馈）：
 *   1. 「文案太 AI、没有突出重点」⇒ 全页正文压到一句标题 + 一行说明；
 *      删掉 v3 的七段式叙事（AI 专区 / Interop / 治理条 / Playbooks 全部并入三行）。
 *   2. 「模型图都是静态没有数据」⇒ 删掉纯装饰的 3D 截图与轨道球；
 *      改为两块**取自真实端点**的数据面：
 *        · 编译面板用的是服务端真实编排阶段名（QUOTA_CHECK / MODEL_CALL /
 *          SCHEMA_VALIDATE / PERSISTED），不是"模型 → 守卫 → 契约"这种编造流程；
 *        · Live ledger 的每个数字来自 `/api/v1/public/pulse`（跨租户 30 天聚合）。
 *   3. 「简约」⇒ 配色只有 ink / paper / 一个信号色；无渐变霓虹、无毛玻璃堆叠。
 *
 * 🔴 诚实约束（沿用 v3，不放宽）：
 *   · 端点不可用时显示「—」，**不显示 0、也不填示例数字**；
 *   · 演示面板标注 "rules in your browser"，不冒充真实模型调用；
 *   · 不放虚构客户 logo / 证言。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PublicPulse } from "@/lib/public/pulse-shape";

/* ─────────────────────────── 1. 设计令牌 ─────────────────────────── */

const INK = "#0b0e11";
const PAPER = "#f7f5f0";
/** 信号色：只用于**大字号**与线条；小字一律用 SIGNAL_DEEP（对比度达标）。 */
const SIGNAL = "#b8863f";
const SIGNAL_DEEP = "#8a5a1e";
const MUTED = "#5a636b";
const FAINT = "#626a70";

const CONTRACT_VERSION = "1.2";

/* ─────────────────────────── 2. 活数据 ─────────────────────────── */

type PulseStatus = "idle" | "loading" | "ready" | "unavailable";

/**
 * 首屏之后才取数：这段请求不参与 LCP/TBT（G15 实测口径下，首屏任何 fetch
 * 都会挤进同一个长任务窗口）。idle 回调 + 2s 兜底，与 SW 注册同一策略。
 */
function usePulse(): { status: PulseStatus; data: PublicPulse | null } {
  const [state, setState] = useState<{ status: PulseStatus; data: PublicPulse | null }>({
    status: "idle",
    data: null,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (cancelled) return;
      setState((s) => (s.status === "idle" ? { status: "loading", data: null } : s));
      try {
        const res = await fetch("/api/v1/public/pulse", { headers: { accept: "application/json" } });
        const json = (await res.json()) as { success?: boolean; data?: PublicPulse };
        if (cancelled) return;
        if (json?.success && json.data) setState({ status: "ready", data: json.data });
        else setState({ status: "unavailable", data: null });
      } catch {
        if (!cancelled) setState({ status: "unavailable", data: null });
      }
    };

    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(load, { timeout: 2000 });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(id);
      };
    }
    const timer = window.setTimeout(load, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return state;
}

/** 数字递增一次（数据到达时）。reduced-motion 直接给终值。 */
function useCountUp(value: number | null, durationMs = 700): number | null {
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    if (value === null) return;

    // 先落到「一帧之后」再 setState：effect 内同步 setState 会触发
    // React Compiler 的 cascading-render 规则；rAF 回调里赋值不受此限，
    // 且顺带保证首帧仍渲染「—」，不会出现 0 → 目标值 的闪跳。
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce || value === 0) {
      const id = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(id);
    }

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return shown;
}

/** 数字 → 「—」安全格式化（`null` 表示该项不可得，不是 0）。 */
function fmt(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString("en-US") : "—";
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint?: string;
}) {
  const shown = useCountUp(value);
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: FAINT }}>
        {label}
      </p>
      <p
        className="mt-1 font-display text-[1.75rem] font-bold leading-none tabular-nums"
        style={{ color: INK }}
      >
        {shown === null ? "—" : shown.toLocaleString("en-US")}
      </p>
      {hint && (
        <p className="mt-1.5 text-[11.5px] leading-snug" style={{ color: MUTED }}>
          {hint}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────── 3. 编译面板（交互） ─────────────────────────── */

type Extracted = { horizon: string | null; target: string | null };

/** 演示用启发式：只认「期限」与「数量」，不做业务判断。 */
function extractGoal(goal: string): Extracted {
  const horizonMatch = goal.match(/(\d+)\s*(天|日|周|个月|days?|weeks?|months?)/i);
  const targetMatch = goal.match(
    /(\d+)\s*(次|个|位|人|partners?|introductions?|deals?|calls?|co-investors?|design partners?)/i,
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

/**
 * 这四步是**服务端真实编排阶段**（`src/lib/agents/stage-events.ts`），
 * 不是为了好看编的流程。演示在前端按同样的顺序与名字重放。
 */
const PIPE_STEPS: Array<{ stage: string; line: string }> = [
  { stage: "QUOTA_CHECK", line: "budget & quota" },
  { stage: "MODEL_CALL", line: "INTENT_EXTRACTION" },
  { stage: "SCHEMA_VALIDATE", line: `WorkspaceSpec v${CONTRACT_VERSION}` },
  { stage: "PERSISTED", line: "run recorded" },
];

const SAMPLES = [
  "20 qualified manufacturing partners in 30 days",
  "12 design partners this quarter",
  "8 co-investors within 45 days",
];

function CompilePanel() {
  const [goal, setGoal] = useState(SAMPLES[0]);
  const [phase, setPhase] = useState<"idle" | "compiling" | "done">("idle");
  const [step, setStep] = useState(0);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  const parsed = useMemo(() => extractGoal(goal), [goal]);
  const reset = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("idle");
    setStep(0);
  }, []);

  const compile = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("compiling");
    setStep(0);
    PIPE_STEPS.forEach((_, i) => {
      timers.current.push(setTimeout(() => setStep(i + 1), 220 * (i + 1)));
    });
    timers.current.push(setTimeout(() => setPhase("done"), 220 * PIPE_STEPS.length + 260));
  }, []);

  return (
    <div
      className="rounded-2xl border bg-white"
      style={{ borderColor: "rgba(11,14,17,0.12)", boxShadow: "0 24px 60px -40px rgba(11,14,17,0.42)" }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b px-4 py-2.5"
        style={{ borderColor: "rgba(11,14,17,0.08)" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: MUTED }}>
          Mission studio
        </span>
        <span className="font-mono text-[10px]" style={{ color: FAINT }}>
          rules in your browser
        </span>
      </div>

      <div className="p-4 sm:p-5">
        <label
          htmlFor="goal-input"
          className="font-mono text-[10px] uppercase tracking-[0.16em]"
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
          className="mt-2 w-full resize-none rounded-xl border px-3.5 py-2.5 text-[15px] leading-relaxed outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#8a5a1e]"
          style={{ borderColor: "rgba(11,14,17,0.16)", background: PAPER, color: INK }}
          placeholder="e.g. 20 manufacturing partners in 30 days"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={compile}
            disabled={phase === "compiling" || goal.trim().length < 8}
            className="cursor-pointer rounded-full px-4 py-2 text-[13.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: INK }}
          >
            {phase === "compiling" ? "Compiling…" : phase === "done" ? "Compile again" : "Compile"}
          </button>
          {SAMPLES.slice(1).map((s, i) => (
            <button
              key={s}
              onClick={() => {
                setGoal(s);
                reset();
              }}
              className="cursor-pointer rounded-full border px-2.5 py-1.5 font-mono text-[10.5px] transition-colors hover:bg-black/[0.03]"
              style={{ borderColor: "rgba(11,14,17,0.14)", color: MUTED }}
            >
              sample {i + 2}
            </button>
          ))}
        </div>

        {/* 真实阶段名重放 */}
        <ol className="mt-4 space-y-1.5" aria-live="polite">
          {PIPE_STEPS.map((s, i) => {
            const on = step > i;
            return (
              <li
                key={s.stage}
                className="flex items-baseline gap-2 font-mono text-[10.5px] transition-opacity duration-200"
                style={{ opacity: on ? 1 : 0.28, color: MUTED }}
              >
                <span style={{ color: on ? "#2f6e59" : FAINT }} aria-hidden>
                  {on ? "✓" : "·"}
                </span>
                <span style={{ color: on ? INK : FAINT }}>{s.stage}</span>
                <span className="truncate">{s.line}</span>
              </li>
            );
          })}
        </ol>

        {/* 编译结果：三列事实，不是营销文案 */}
        {phase === "done" && (
          <dl className="mt-4 grid gap-px overflow-hidden rounded-xl border sm:grid-cols-3" style={{ borderColor: "rgba(11,14,17,0.1)", background: "rgba(11,14,17,0.1)" }}>
            {[
              ["goal", parsed.target ? `${parsed.target} connected` : "needs a number"],
              ["horizon", parsed.horizon ?? "not stated"],
              ["gates", "consent · budget"],
              ["agents", "3 skills"],
              ["approval", "second person"],
              ["proof", "counterparty confirms"],
            ].map(([k, v]) => (
              <div key={k} className="bg-white px-2.5 py-2">
                <dt className="font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: FAINT }}>
                  {k}
                </dt>
                <dd className="mt-0.5 text-[11.5px] leading-tight" style={{ color: INK }}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <p className="mt-3.5 text-[11px] leading-relaxed" style={{ color: FAINT }}>
          Same stage names as the server pipeline. A live run calls the model server-side and
          stores the result — nothing is rendered from model-authored HTML.
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────── 4. Live ledger（真数据） ─────────────────────────── */

function Ledger({ pulse }: { pulse: ReturnType<typeof usePulse> }) {
  const { status, data } = pulse;
  const activity = data?.activity ?? null;
  const stages = data?.stages ?? [];
  const max = stages.reduce((m, s) => Math.max(m, s.count), 0);
  const quiet =
    activity !== null &&
    activity.missions === 0 &&
    activity.runs === 0 &&
    activity.decisions === 0 &&
    activity.verifiedOutcomes === 0;

  // 直接派生（不用 useMemo）：依赖是字符串字段，react-compiler 无法保留
  // 手动 memo 的依赖集（它推断的是整个 `data`），会报 preserve-manual-memoization。
  const asOf = (() => {
    if (!data?.asOf) return null;
    const d = new Date(data.asOf);
    if (Number.isNaN(d.getTime())) return null;
    return (
      d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC"
    );
  })();

  return (
    <div className="rounded-2xl border bg-white" style={{ borderColor: "rgba(11,14,17,0.12)" }}>
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3"
        style={{ borderColor: "rgba(11,14,17,0.08)" }}
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-70 motion-safe:animate-ping"
              style={{ background: "#2f6e59" }}
            />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "#2f6e59" }} />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: MUTED }}>
            Live ledger · last {data?.windowDays ?? 30} days
          </span>
        </div>
        <span className="font-mono text-[10px]" style={{ color: FAINT }}>
          {status === "ready"
            ? activity
              ? `aggregated · ${asOf ?? "—"}`
              : "aggregate unavailable"
            : status === "unavailable"
              ? "aggregate unavailable"
              : "loading…"}
        </span>
      </div>

      <div className="grid gap-6 p-5 sm:grid-cols-[1.15fr_1fr] sm:gap-8">
        <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-4">
          <Stat label="Missions" value={activity?.missions ?? null} />
          <Stat label="Agent runs" value={activity?.runs ?? null} />
          <Stat label="Decisions" value={activity?.decisions ?? null} />
          <Stat label="Verified" value={activity?.verifiedOutcomes ?? null} />
          {quiet && (
            <p className="col-span-2 text-[11.5px] leading-relaxed sm:col-span-4" style={{ color: FAINT }}>
              Nothing in this window yet — the first compiled goal will show up here.
            </p>
          )}
        </div>

        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: FAINT }}>
            Orchestration stages
          </p>
          {stages.length === 0 ? (
            <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: MUTED }}>
              {status === "ready"
                ? data?.note === "stage_events_unavailable"
                  ? "Per-stage detail isn't available on this deployment yet — counts stay hidden rather than shown as zero."
                  : "No stage events in this window yet."
                : status === "unavailable"
                  ? "The aggregate endpoint is unreachable from this browser."
                  : "Waiting for the aggregate."}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {stages.map((s) => (
                <li key={s.stage} className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-2">
                  <span className="truncate font-mono text-[10px]" style={{ color: MUTED }}>
                    {s.stage}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(11,14,17,0.08)" }}>
                    <span
                      className="block h-full rounded-full transition-[width] duration-700 ease-out"
                      style={{
                        width: `${Math.max(3, max > 0 ? Math.round((s.count / max) * 100) : 3)}%`,
                        background: s.stage === "DEGRADED" ? "#b4544a" : SIGNAL,
                      }}
                    />
                  </span>
                  <span className="text-right font-mono text-[10px] tabular-nums" style={{ color: INK }}>
                    {s.count.toLocaleString("en-US")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] leading-relaxed" style={{ color: FAINT }}>
            Cross-workspace counts. No tenant, user or mission content leaves the server.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── 5. 页面 ─────────────────────────── */

export default function LandingPage() {
  const router = useRouter();
  const pulse = usePulse();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const activity = pulse.data?.activity ?? null;
  const cap = pulse.data?.capabilities;

  return (
    <div style={{ background: PAPER, color: INK }} className="min-h-screen antialiased">
      {/* ── NAV ── */}
      <header
        className="fixed inset-x-0 top-0 z-40 transition-colors duration-300"
        style={{
          background: scrolled ? "rgba(247,245,240,0.9)" : "transparent",
          backdropFilter: scrolled ? "blur(10px)" : undefined,
          borderBottom: `1px solid ${scrolled ? "rgba(11,14,17,0.08)" : "transparent"}`,
        }}
      >
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="LokFeel home">
            <span
              className="grid h-7 w-7 place-items-center rounded-md font-display text-[13px] font-bold text-white"
              style={{ background: INK }}
            >
              L
            </span>
            <span className="font-display text-[15px] font-bold tracking-[-0.01em]">LOKFEEL</span>
          </Link>

          <div className="hidden items-center gap-7 md:flex">
            {[
              ["How it runs", "#how"],
              ["Live ledger", "#ledger"],
              ["Pricing", "/pricing"],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="inline-flex min-h-6 items-center text-[13.5px] transition-opacity hover:opacity-60"
                style={{ color: MUTED }}
              >
                {label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden rounded-full px-3.5 py-2 text-[13.5px] transition-colors hover:bg-black/[0.04] sm:block"
              style={{ color: MUTED }}
            >
              Log in
            </Link>
            <button
              onClick={() => router.push("/register")}
              className="cursor-pointer rounded-full px-4 py-2 text-[13.5px] font-medium text-white transition-opacity hover:opacity-90"
              style={{ background: INK }}
            >
              Start free
            </button>
          </div>
        </nav>
      </header>

      <main>
        {/* ── HERO ── */}
        <section className="relative overflow-hidden pb-14 pt-28 sm:pt-32">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(rgba(11,14,17,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(11,14,17,0.04) 1px, transparent 1px)",
              backgroundSize: "80px 80px",
              maskImage: "radial-gradient(ellipse 65% 55% at 40% 0%, black, transparent 75%)",
              WebkitMaskImage: "radial-gradient(ellipse 65% 55% at 40% 0%, black, transparent 75%)",
            }}
          />

          <div className="relative mx-auto grid max-w-6xl items-start gap-10 px-5 sm:px-6 lg:grid-cols-[1.02fr_1fr] lg:gap-14">
            <div className="lg:pt-6">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: SIGNAL }} aria-hidden />
                <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: FAINT }}>
                  Connection OS
                </p>
              </div>

              <h1
                className="mt-5 font-display text-[2.15rem] font-extrabold leading-[1] tracking-[-0.04em] sm:text-[3.1rem] lg:text-[3.3rem]"
                style={{ color: INK }}
              >
                One goal in.
                <br />
                <span style={{ color: SIGNAL_DEEP }}>A workspace out.</span>
              </h1>

              <p className="mt-5 max-w-[30rem] text-[16.5px] leading-[1.55]" style={{ color: MUTED }}>
                A sentence becomes missions, consent gates and agents. Every step is recorded, and
                only the counterparty can mark a result done.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  href="/register"
                  className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14.5px] font-medium text-white transition-opacity hover:opacity-90"
                  style={{ background: INK }}
                >
                  Start with a goal
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </Link>
                <a
                  href="#ledger"
                  className="rounded-full border px-5 py-3 text-[14.5px] font-medium transition-colors hover:bg-black/[0.03]"
                  style={{ borderColor: "rgba(11,14,17,0.16)", color: INK }}
                >
                  See what ran
                </a>
              </div>

              {/* 能力事实：取自代码，不是文案 */}
              <p className="mt-7 font-mono text-[10.5px] uppercase tracking-[0.14em]" style={{ color: FAINT }}>
                {cap
                  ? `${cap.skills} skills · ${cap.mcpTools} MCP tools · spec v${cap.specVersion} · fail-closed consent`
                  : "3 skills · 5 MCP tools · spec v1.2 · fail-closed consent"}
              </p>
            </div>

            <CompilePanel />
          </div>
        </section>

        {/* ── HOW IT RUNS（三行，每行一个真实数字） ── */}
        <section id="how" className="mx-auto max-w-6xl px-5 pb-16 sm:px-6 sm:pb-20">
          <h2 className="font-display text-[1.6rem] font-bold tracking-[-0.02em] sm:text-[2rem]">
            Three steps. Each one leaves evidence.
          </h2>

          <div className="mt-7 divide-y" style={{ borderColor: "rgba(11,14,17,0.12)" }}>
            {[
              {
                k: "01",
                t: "Goal becomes spec",
                d: "The model proposes a WorkspaceSpec. The server validates it; the canvas renders only allowed nodes.",
                n: activity && activity.missions !== null ? `${fmt(activity.missions)} missions · 30 d` : "—",
              },
              {
                k: "02",
                t: "Agent becomes a draft",
                d: "Three skills draft. A different person approves. Self-approval is rejected by the server, not by policy text.",
                n:
                  activity && activity.runs !== null
                    ? `${fmt(activity.runs)} runs · ${fmt(activity.decisions)} decisions`
                    : "—",
              },
              {
                k: "03",
                t: "Outcome becomes proof",
                d: "A result counts only after the counterparty confirms it. Self-reported stays unverified.",
                n:
                  activity && activity.verifiedOutcomes !== null
                    ? `${fmt(activity.verifiedOutcomes)} verified · 30 d`
                    : "—",
              },
            ].map((row) => (
              <div key={row.k} className="grid gap-2 py-6 sm:grid-cols-[3rem_1fr_auto] sm:items-baseline sm:gap-6" style={{ borderTop: "1px solid rgba(11,14,17,0.1)" }}>
                <span className="font-mono text-[11px] tracking-[0.2em]" style={{ color: SIGNAL_DEEP }}>
                  {row.k}
                </span>
                <div>
                  <h3 className="font-display text-[16.5px] font-bold">{row.t}</h3>
                  <p className="mt-1.5 max-w-[38rem] text-[13.5px] leading-relaxed" style={{ color: MUTED }}>
                    {row.d}
                  </p>
                </div>
                <span className="font-mono text-[10.5px] tabular-nums sm:text-right" style={{ color: FAINT }}>
                  {row.n}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── LIVE LEDGER ── */}
        <section id="ledger" className="mx-auto max-w-6xl px-5 pb-16 sm:px-6 sm:pb-20">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-[1.6rem] font-bold tracking-[-0.02em] sm:text-[2rem]">
                What actually ran.
              </h2>
              <p className="mt-2 max-w-[36rem] text-[13.5px] leading-relaxed" style={{ color: MUTED }}>
                Aggregated on the server from the same tables the product reads. Numbers move as
                real runs happen; missing data shows a dash.
              </p>
            </div>
          </div>
          <div className="mt-6">
            <Ledger pulse={pulse} />
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl px-6 py-11 sm:px-10" style={{ background: INK }}>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: "radial-gradient(520px 220px at 82% 0%, rgba(184,134,63,0.2), transparent 70%)",
              }}
            />
            <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: "rgba(242,241,236,0.62)" }}>
                  No setup
                </p>
                <h2 className="mt-3 font-display text-[1.8rem] font-bold leading-[1.06] tracking-[-0.025em] text-[#f2f1ec] sm:text-[2.2rem]">
                  Bring one real goal.
                </h2>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/register"
                  className="rounded-full px-5 py-3 text-[14.5px] font-medium text-[#0b0e11] transition-opacity hover:opacity-90"
                  style={{ background: "#f2f1ec" }}
                >
                  Start free
                </Link>
                <Link
                  href="/pricing"
                  className="rounded-full border px-5 py-3 text-[14.5px] font-medium transition-colors hover:bg-white/[0.06]"
                  style={{ borderColor: "rgba(242,241,236,0.22)", color: "#f2f1ec" }}
                >
                  Pricing
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t" style={{ borderColor: "rgba(11,14,17,0.1)" }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 sm:px-6">
          <div className="flex items-center gap-2">
            <span
              className="grid h-6 w-6 place-items-center rounded-md font-display text-[12px] font-bold text-white"
              style={{ background: INK }}
            >
              L
            </span>
            <span className="font-display text-[13px] font-bold tracking-[-0.01em]">LOKFEEL</span>
          </div>
          <nav className="flex flex-wrap items-center gap-5 text-[12.5px]" style={{ color: MUTED }}>
            {[
              ["Product", "/product"],
              ["Pricing", "/pricing"],
              ["Help", "/help"],
              ["Log in", "/login"],
              ["Agent card", "/.well-known/agent-card.json"],
            ].map(([label, href]) => (
              <Link key={label} href={href} className="inline-flex min-h-6 items-center hover:opacity-60">
                {label}
              </Link>
            ))}
          </nav>
          <p className="font-mono text-[10px]" style={{ color: FAINT }}>
            © {new Date().getFullYear()} LokFeel · MCP · A2A · REST v1
          </p>
        </div>
      </footer>
    </div>
  );
}
