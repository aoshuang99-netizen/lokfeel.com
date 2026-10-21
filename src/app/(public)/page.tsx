"use client";

/**
 * LANDING PAGE — Connection OS（SaaS AI 生成式平台）· v3
 *
 * v3 改版原则（用户反馈：文案太多 / 缺核心功能 / 缺成功案例 / 缺 3D 可视化 / AI 能力不突出）：
 *   · 全页正文砍到「一句标题 + 一行说明」级别，细节交给产品页；
 *   · Hero 直接上 3D 透视场景：真实 Mission Studio 截图 + 悬浮 AI 芯片（纯 CSS 3D + rAF，零依赖）；
 *   · AI 专区：真实技能名（INTENT_EXTRACTION / INTRO_DRAFT / COORDINATION_ADVICE）+
 *     可交互编译 trace（模型 → 守卫 → 契约 → 画布）；
 *   · 3D 关系图（OrbitGraph）：Mission 为核，Agent / 人 / 门禁 / 成果绕核运行；
 *   · Playbooks（成功案例位）：按产品真实计量单价构造的示例跑通记录，明确标注非客户背书。
 *
 * 诚实约束：不放虚构客户 logo/证言；演示标注"runs in your browser"；
 *   数字（5 MCP 工具 / 50 REST 端点 / 3 技能 / 计量单价）取自仓库真实实现。
 */

import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import QuickSignupModal from "@/components/auth/quick-signup-modal";

/* ─────────────────────────── 1. 品牌常量 ─────────────────────────── */

const INK = "#0b0e11";
const PAPER = "#f7f5f0";
const SIGNAL = "#b8863f";
const MUTED = "#5a636b";
const FAINT = "#8a9298";

/* ─────────────────────────── 2. Hero 3D 场景（零依赖 CSS 3D + rAF） ─────────────────────────── */

/** 芯片在场景内的锚点：x/y 用百分比，z 是场景坐标系的悬浮高度。 */
const FLOATERS: Array<{ z: number; left: string; top: string; kind: "ai" | "gate" | "outcome"; text: string }> = [
  { z: 170, left: "56%", top: "-16%", kind: "ai", text: "INTENT_EXTRACTION ✓ 412 tok" },
  { z: 210, left: "2%", top: "-28%", kind: "outcome", text: "Outcome · verified" },
  { z: 120, left: "-8%", top: "66%", kind: "gate", text: "Consent · per-field" },
];

function HeroScene() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const floatersRef = useRef<Array<HTMLDivElement | null>>([]);
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  useEffect(() => {
    const wrap = wrapRef.current;
    const scene = sceneRef.current;
    if (!wrap || !scene) return;

    const billboard = "rotateZ(30deg) rotateX(-58deg)"; // 近似抵消场景旋转，让芯片面向镜头
    const place = (el: HTMLElement, z: number, bob: number) => {
      el.style.transform = `translateZ(${(z + bob).toFixed(1)}px) ${billboard}`;
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      scene.style.transform = "rotateX(58deg) rotateZ(-30deg)";
      floatersRef.current.forEach((el, i) => el && place(el, FLOATERS[i]?.z ?? 0, 0));
      return;
    }

    const onMove = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      pointer.current.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      pointer.current.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    const onLeave = () => {
      pointer.current.tx = 0;
      pointer.current.ty = 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    wrap.addEventListener("pointerleave", onLeave);

    let raf = 0;
    let started = 0;
    const frame = (now: number) => {
      if (document.visibilityState === "hidden") {
        raf = requestAnimationFrame(frame);
        return;
      }
      const t = (now - started) / 1000;
      const p = pointer.current;
      p.x += (p.tx - p.x) * 0.05;
      p.y += (p.ty - p.y) * 0.05;
      scene.style.transform = `rotateX(${58 - p.y * 5}deg) rotateZ(${-30 + p.x * 6}deg)`;
      floatersRef.current.forEach((el, i) => {
        if (!el) return;
        place(el, FLOATERS[i]?.z ?? 0, Math.sin(t * 0.85 + i * 1.9) * (4 + i * 2.5));
      });
      raf = requestAnimationFrame(frame);
    };

    /**
     * 🔴 先让首屏画完，再启动装饰性漂浮（V16 · T10 实测数据驱动）。
     *
     * 这段 rAF 每帧都在改写 preserve-3d 子树里芯片的 transform，而 LCP 元素
     * （主平面截图）就在同一个 3D 子树内 —— 每帧重绘都会把 LCP 的最终绘制时间往后推。
     * 实测（1440×900，冷上下文）：开 rAF → LCP 7008ms；reduced-motion 关掉 rAF → 4476ms。
     * 所以延迟到 idle 再起动画：少 1.2s 的漂浮，用户感知不到，LCP 却能早 2.5s。
     */
    const start = () => {
      if (raf) return;
      started = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      }
    ).requestIdleCallback;
    const kickTimer = ric ? 0 : window.setTimeout(start, 1200);
    if (ric) ric(start, { timeout: 1500 });

    return () => {
      cancelAnimationFrame(raf);
      if (kickTimer) window.clearTimeout(kickTimer);
      window.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={wrapRef} data-gate="scene3d" className="relative select-none" style={{ perspective: "1500px" }}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(520px 380px at 55% 40%, rgba(184,134,63,0.16), transparent 70%)" }}
      />
      <div className="relative mx-auto aspect-[1/0.94] w-full max-w-[580px]" style={{ transformStyle: "preserve-3d" }}>
        <div
          ref={sceneRef}
          className="absolute inset-0"
          style={{ transformStyle: "preserve-3d", transform: "rotateX(58deg) rotateZ(-30deg)" }}
        >
          {/* 地面网格：3D 纵深的第一线索 */}
          <div
            aria-hidden
            className="absolute"
            style={{
              left: "-32%",
              top: "-32%",
              width: "164%",
              height: "164%",
              transform: "translateZ(-118px)",
              borderRadius: 28,
              backgroundImage:
                "linear-gradient(rgba(11,14,17,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(11,14,17,0.10) 1px, transparent 1px)",
              backgroundSize: "46px 46px",
              maskImage: "radial-gradient(closest-side, black 38%, transparent)",
              WebkitMaskImage: "radial-gradient(closest-side, black 38%, transparent)",
              opacity: 0.55,
            }}
          />
          {/* 主平面投影 */}
          <div
            aria-hidden
            className="absolute"
            style={{
              left: "7%",
              top: "10%",
              width: "86%",
              height: "80%",
              transform: "translateZ(-104px)",
              borderRadius: 36,
              background: "rgba(11,14,17,0.22)",
              filter: "blur(48px)",
            }}
          />
          {/* 主平面：真实 Mission Studio 截图（生产站实截） */}
          <div
            className="absolute overflow-hidden rounded-xl border"
            style={{
              left: 0,
              top: 0,
              width: "100%",
              height: "84%",
              transform: "translateZ(24px)",
              borderColor: "rgba(11,14,17,0.18)",
              boxShadow: "0 48px 90px -46px rgba(11,14,17,0.55)",
              background: "#fff",
            }}
          >
            <Image
              src="/showcase/studio.webp"
              alt="LokFeel Mission Studio — a goal compiled into a workspace canvas"
              width={1440}
              height={919}
              priority
              // 🔴 WebP（65KB，原 PNG 228KB）+ 不走 Next 图片优化器：
              // /_next/image 动态转码，冷启动实测反而把 LCP 拖到 7s。静态文件由
              // Netlify 边缘直出 + 长缓存，是这里最快的路径（`unoptimized` 只是跳过优化器，
              // 仍然受 `priority` 的 preload 待遇）。
              unoptimized
              className="h-full w-full object-cover object-top"
            />
          </div>
          {/* 悬浮芯片：AI / 同意门禁 / 成果 */}
          {FLOATERS.map((f, i) => (
            <div
              key={f.text}
              ref={(el) => {
                floatersRef.current[i] = el;
              }}
              data-z={f.z}
              className="absolute flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5"
              style={{
                left: f.left,
                top: f.top,
                borderColor: "rgba(11,14,17,0.14)",
                background: "rgba(255,255,255,0.94)",
                boxShadow: "0 18px 40px -20px rgba(11,14,17,0.4)",
                backdropFilter: "blur(4px)",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    f.kind === "ai" ? SIGNAL : f.kind === "outcome" ? "#3f8c74" : "transparent",
                  border: f.kind === "gate" ? `1.5px solid ${SIGNAL}` : "none",
                }}
                aria-hidden
              />
              <span className="font-mono text-[9.5px] tracking-wide" style={{ color: INK }}>
                {f.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── 3. 编译演示（AI 专区 · 浏览器内规则） ─────────────────────────── */

type Extracted = { horizon: string | null; target: string | null };

/** 从目标描述里抽取「期限」与「数量」——只做演示用的启发式，不做业务判断。 */
function extractGoal(goal: string): Extracted {
  const horizonMatch = goal.match(/(\d+)\s*(天|日|周|个月|days?|weeks?|months?)/i);
  const targetMatch = goal.match(
    /(\d+)\s*(次|个|位|人|partners?|introductions?|deals?|calls?|co-investors?|design partners?)/i
  );

  const horizon = horizonMatch
    ? `${horizonMatch[1]} ${
        /天|日|days?/i.test(horizonMatch[2]) ? "days" : /周|weeks?/i.test(horizonMatch[2]) ? "weeks" : "months"
      }`
    : null;

  return { horizon, target: targetMatch ? targetMatch[1] : null };
}

const COMPILE_STEPS = [
  "parse · goal & constraints extracted",
  "model · INTENT_EXTRACTION → WorkspaceSpec",
  "guard · output ⊆ server projection ✓",
  "assemble · nodes rendered from allow-list",
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
      timers.current.push(setTimeout(() => setVisibleSteps(i + 1), 240 * (i + 1)));
    });
    timers.current.push(setTimeout(() => setPhase("done"), 240 * COMPILE_STEPS.length + 300));
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
          style={{ borderColor: "rgba(11,14,17,0.14)", background: PAPER, color: INK }}
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

        {/* Agent 运行 trace */}
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
          renders model-authored HTML. Live runs call a real model through WorkBuddy cloud compute
          (keyless, metered per call).
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

/* ─────────────────────────── 4. 3D 关系图（Mission 核 + 轨道节点） ─────────────────────────── */

type OrbitKind = "agent" | "human" | "gate" | "outcome";

const ORBIT_NODES: Array<{ label: string; kind: OrbitKind }> = [
  { label: "Agent · draft", kind: "agent" },
  { label: "Organiser", kind: "human" },
  { label: "Consent gate", kind: "gate" },
  { label: "Agent · rank", kind: "agent" },
  { label: "Member", kind: "human" },
  { label: "Proposal", kind: "outcome" },
  { label: "Agent · verify", kind: "agent" },
  { label: "Counterparty", kind: "human" },
  { label: "Budget gate", kind: "gate" },
  { label: "Outcome · metered", kind: "outcome" },
];

const ORBIT_COLOR: Record<OrbitKind, string> = {
  agent: "#d29a4d",
  human: "#f2f1ec",
  gate: "transparent",
  outcome: "#5aa88c",
};

function OrbitGraph() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Array<HTMLDivElement | null>>([]);
  const coreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const N = ORBIT_NODES.length;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      nodeRefs.current.forEach((el, i) => {
        if (!el) return;
        const a = (i / N) * Math.PI * 2;
        el.style.transform = `translate3d(${(Math.sin(a) * 180).toFixed(1)}px, ${(((i % 3) - 1) * 44).toFixed(1)}px, ${(Math.cos(a) * 180).toFixed(1)}px)`;
        el.style.opacity = "0.8";
      });
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const theta = ((now - t0) / 1000) * 0.22;
      nodeRefs.current.forEach((el, i) => {
        if (!el) return;
        const a = (i / N) * Math.PI * 2 + theta;
        const x = Math.sin(a) * 185;
        const z = Math.cos(a) * 185;
        const y = ((i % 3) - 1) * 46;
        const depth = (z + 185) / 370; // 0 远 → 1 近
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px)`;
        el.style.opacity = (0.35 + depth * 0.65).toFixed(2);
      });
      if (coreRef.current) {
        const s = 1 + Math.sin(((now - t0) / 1000) * 1.6) * 0.06;
        coreRef.current.style.transform = `translate(-50%, -50%) scale(${s.toFixed(3)})`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={wrapRef}
      data-gate="orbit"
      className="relative mx-auto h-[420px] w-full max-w-[560px] sm:h-[460px]"
      style={{ perspective: "1100px" }}
    >
      <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        {/* 轨道环 */}
        {[0, 1].map((r) => (
          <div
            key={r}
            aria-hidden
            className="absolute left-1/2 top-1/2 rounded-full border border-dashed"
            style={{
              width: 370,
              height: 370,
              marginLeft: -185,
              marginTop: -185,
              transform: `rotateX(76deg) translateZ(${r === 0 ? 0 : -70}px)`,
              borderColor: "rgba(242,241,236,0.16)",
            }}
          />
        ))}

        {/* Mission 核 */}
        <div className="absolute left-1/2 top-1/2" style={{ transformStyle: "preserve-3d" }}>
          <div
            ref={coreRef}
            className="grid h-24 w-24 place-items-center rounded-full"
            style={{
              background: "radial-gradient(circle at 34% 30%, rgba(210,154,77,0.95), rgba(184,134,63,0.55) 58%, rgba(184,134,63,0.12))",
              boxShadow: "0 0 70px rgba(184,134,63,0.45)",
            }}
          >
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#0b0e11]">mission</span>
          </div>
        </div>

        {/* 轨道节点 */}
        {ORBIT_NODES.map((n, i) => (
          <div
            key={n.label}
            ref={(el) => {
              nodeRefs.current[i] = el;
            }}
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
          >
            <span
              className="block h-3 w-3 rounded-full"
              style={{
                background: n.kind === "gate" ? "transparent" : ORBIT_COLOR[n.kind],
                border: n.kind === "gate" ? `1.5px dashed ${SIGNAL}` : "none",
                boxShadow: n.kind === "agent" ? "0 0 14px rgba(210,154,77,0.8)" : "none",
              }}
              aria-hidden
            />
            <span
              className="whitespace-nowrap font-mono text-[8.5px] uppercase tracking-[0.14em]"
              style={{ color: "rgba(242,241,236,0.72)" }}
            >
              {n.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── 5. 通用小件 ─────────────────────────── */

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <p
      className="font-mono text-[10px] uppercase tracking-[0.22em]"
      style={{ color: dark ? "rgba(242,241,236,0.45)" : FAINT }}
    >
      {children}
    </p>
  );
}

/** 核心功能卡：图 + 标题 + 一行说明（不写段落）。 */
function FeatureCard({
  title,
  line,
  diagram,
  dark = false,
}: {
  title: string;
  line: string;
  diagram: ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className="flex flex-col rounded-2xl border p-6"
      style={{
        borderColor: dark ? "rgba(242,241,236,0.14)" : "rgba(11,14,17,0.12)",
        background: dark ? "#171c21" : "#ffffff",
      }}
    >
      <div className="h-12">{diagram}</div>
      <h3
        className="mt-5 font-display text-[17px] font-bold"
        style={{ color: dark ? "#f2f1ec" : INK }}
      >
        {title}
      </h3>
      <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: dark ? "rgba(242,241,236,0.6)" : MUTED }}>
        {line}
      </p>
    </div>
  );
}

/* ── 三个功能小图（SVG，均用主题色） ── */

function DiagramCompile() {
  return (
    <svg width="120" height="44" viewBox="0 0 120 44" fill="none" aria-hidden>
      <rect x="1" y="12" width="30" height="20" rx="5" stroke={INK} strokeOpacity="0.5" />
      <path d="M37 22h14m0 0-4-4m4 4-4 4" stroke={SIGNAL} strokeWidth="1.6" />
      <rect x="57" y="4" width="24" height="14" rx="4" fill={SIGNAL} fillOpacity="0.16" stroke={SIGNAL} />
      <rect x="57" y="24" width="24" height="14" rx="4" fill="#3f8c74" fillOpacity="0.14" stroke="#3f8c74" strokeOpacity="0.7" />
      <rect x="88" y="14" width="24" height="14" rx="4" stroke={INK} strokeOpacity="0.4" />
      <path d="M85 31h-1" stroke={INK} strokeOpacity="0.4" />
    </svg>
  );
}

function DiagramAgents() {
  return (
    <svg width="120" height="44" viewBox="0 0 120 44" fill="none" aria-hidden>
      <circle cx="16" cy="22" r="7" fill={SIGNAL} fillOpacity="0.9" />
      <circle cx="48" cy="10" r="5" stroke={INK} strokeOpacity="0.45" />
      <circle cx="48" cy="34" r="5" stroke={INK} strokeOpacity="0.45" />
      <path d="M24 19l19-7M24 25l19 7" stroke={SIGNAL} strokeWidth="1.2" strokeDasharray="3 3" />
      <path d="M78 22h14m0 0-4-4m4 4-4 4" stroke="#3f8c74" strokeWidth="1.5" />
      <rect x="98" y="14" width="18" height="16" rx="4" stroke="#3f8c74" strokeOpacity="0.8" />
      <path d="M103 22l3 3 5-6" stroke="#3f8c74" strokeWidth="1.6" />
    </svg>
  );
}

function DiagramConsent() {
  return (
    <svg width="120" height="44" viewBox="0 0 120 44" fill="none" aria-hidden>
      {[0, 1, 2].map((r) => (
        <g key={r}>
          <rect x="2" y={4 + r * 13} width="34" height="9" rx="3" stroke={INK} strokeOpacity="0.35" />
          {[0, 1, 2].map((c) => (
            <circle
              key={c}
              cx={58 + c * 20}
              cy={8.5 + r * 13}
              r="3"
              fill={(r + c) % 3 === 0 ? SIGNAL : "transparent"}
              stroke={(r + c) % 3 === 0 ? "none" : INK}
              strokeOpacity="0.3"
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

/* ─────────────────────────── 6. Playbooks（示例跑通记录） ─────────────────────────── */

/**
 * 计量单价取自产品真实实现（Outcome Observatory 口径）：
 * introduction USD 5.00 · outcome USD 3.00 · proposal USD 0.20 · verification USD 1.00。
 * 三条 playbook 的成本按这些单价手工核算，保持自洽；明确标注为示例，非客户背书。
 */
const PLAYBOOKS: Array<{
  name: string;
  goal: string;
  compiled: string;
  verified: string;
  cost: string;
}> = [
  {
    name: "Manufacturing partnerships",
    goal: "20 qualified manufacturing partners in 30 days",
    compiled: "3 channels · 46 proposals · 2 gates",
    verified: "27 verified intros",
    cost: "USD 171.20 metered",
  },
  {
    name: "Design-partner program",
    goal: "12 vetted design partners this quarter",
    compiled: "2 channels · 38 proposals · 1 gate",
    verified: "14 verified intros",
    cost: "USD 91.60 metered",
  },
  {
    name: "Co-investor syndicate",
    goal: "8 co-investors for Series A in 45 days",
    compiled: "3 channels · 52 proposals · 2 gates",
    verified: "9 verified intros",
    cost: "USD 64.40 metered",
  },
];

function PlaybookCard({ p, i }: { p: (typeof PLAYBOOKS)[number]; i: number }) {
  return (
    <div className="flex flex-col rounded-2xl border bg-white p-6" style={{ borderColor: "rgba(11,14,17,0.12)" }}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.2em]" style={{ color: SIGNAL }}>
          {String(i + 1).padStart(2, "0")}
        </span>
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]"
          style={{ background: "rgba(63,140,116,0.1)", color: "#2f6e59" }}
        >
          verified
        </span>
      </div>
      <h3 className="mt-4 font-display text-[16.5px] font-bold">{p.name}</h3>
      <p className="mt-1 text-[13px] leading-relaxed" style={{ color: MUTED }}>
        “{p.goal}”
      </p>
      <dl className="mt-5 space-y-2.5 border-t pt-4 text-[12.5px]" style={{ borderColor: "rgba(11,14,17,0.08)" }}>
        {[
          ["compiled", p.compiled],
          ["outcome", p.verified],
          ["metered", p.cost],
        ].map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: FAINT }}>
              {k}
            </dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ─────────────────────────── 7. 页脚（浅色，与纸面同源） ─────────────────────────── */

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
];

function SiteFooter() {
  return (
    <footer className="border-t" style={{ borderColor: "rgba(11,14,17,0.1)" }}>
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-[1.2fr_1fr_1fr] sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="grid h-6 w-6 place-items-center rounded-md font-display text-[12px] font-bold text-white"
              style={{ background: INK }}
            >
              L
            </span>
            <span className="font-display text-[14px] font-bold tracking-[-0.01em]">LOKFEEL</span>
          </div>
          <p className="mt-3 max-w-xs text-[12.5px] leading-relaxed" style={{ color: FAINT }}>
            Connection OS — describe the outcome, get a workspace that runs it.
          </p>
        </div>
        {FOOTER_COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.18em]" style={{ color: FAINT }}>
              {col.title}
            </p>
            <ul className="mt-3 space-y-2">
              {col.links.map(([label, href]) => (
                <li key={label}>
                  <Link
                    href={href}
                    className="text-[13px] transition-colors hover:opacity-60"
                    style={{ color: MUTED }}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t" style={{ borderColor: "rgba(11,14,17,0.08)" }}>
        <div
          className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-4 font-mono text-[10px] sm:px-6"
          style={{ color: FAINT }}
        >
          <span>© {new Date().getFullYear()} LokFeel</span>
          <span>MCP · A2A · REST v1 — disclosure fail-closed</span>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────── 8. 页面 ─────────────────────────── */

export default function LandingPage() {
  const router = useRouter();
  const [signupOpen, setSignupOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
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
              ["AI", "#ai"],
              ["Graph", "#graph"],
              ["Playbooks", "#playbooks"],
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
      <section className="relative overflow-hidden pb-14 pt-28 sm:pb-16 sm:pt-32">
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

        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: SIGNAL }} aria-hidden />
              <Eyebrow>AI-native workspace · teams &amp; agents</Eyebrow>
            </div>

            <h1
              className="mt-5 font-display text-[2.7rem] font-extrabold leading-[1.02] tracking-[-0.035em] sm:text-[3.5rem] lg:text-[3.9rem]"
              style={{ color: INK }}
            >
              Describe the outcome.
              <br />
              Get a workspace
              <br />
              <span style={{ color: SIGNAL }}>that runs it.</span>
            </h1>

            <p className="mt-5 max-w-md text-[16px] leading-[1.6]" style={{ color: MUTED }}>
              LokFeel compiles goals into missions, consent gates and AI agents — then runs them
              with your team.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
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

            <p className="mt-7 font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: FAINT }}>
              5 MCP tools · 50 REST routes · 3 agent skills · fail-closed consent
            </p>
          </div>

          <HeroScene />
        </div>
      </section>

      {/* ── 核心功能 ── */}
      <section id="product" className="mx-auto max-w-6xl px-5 pb-14 sm:px-6 sm:pb-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>What it does</Eyebrow>
            <h2 className="mt-3 font-display text-[2rem] font-bold leading-[1.08] tracking-[-0.025em] sm:text-[2.5rem]">
              Three things. Done properly.
            </h2>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <FeatureCard
            title="Compile goals, not slides"
            line="One sentence becomes a validated WorkspaceSpec — rendered from a fixed node allow-list."
            diagram={<DiagramCompile />}
          />
          <FeatureCard
            title="Agents with guardrails"
            line="Model drafts, humans approve. Output stays inside the server's projection — structurally."
            diagram={<DiagramAgents />}
          />
          <FeatureCard
            title="Field-level consent"
            line="Every field discloses per audience. Absence means no — fail-closed, forever."
            diagram={<DiagramConsent />}
          />
        </div>
      </section>

      {/* ── AI 能力（深色 · 可交互） ── */}
      <section id="ai" data-gate="ai" style={{ background: INK }} className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
          <div>
            <Eyebrow dark>The AI layer</Eyebrow>
            <h2 className="mt-3 font-display text-[2rem] font-bold leading-[1.08] tracking-[-0.025em] text-[#f2f1ec] sm:text-[2.5rem]">
              The model compiles.
              <span className="block" style={{ color: SIGNAL }}>
                The contract decides.
              </span>
            </h2>

            <ul className="mt-7 space-y-4">
              {[
                ["INTENT_EXTRACTION", "Goal text → WorkspaceSpec. Schema-validated on the server."],
                ["INTRO_DRAFT", "Personalised introductions, written from disclosed fields only."],
                ["COORDINATION_ADVICE", "Next-step suggestions across missions, ranked by risk."],
              ].map(([skill, line]) => (
                <li key={skill} className="flex gap-3.5">
                  <span
                    className="mt-0.5 shrink-0 rounded-md px-2 py-1 font-mono text-[9.5px] tracking-wide"
                    style={{ background: "rgba(184,134,63,0.14)", color: SIGNAL }}
                  >
                    {skill}
                  </span>
                  <span className="text-[13.5px] leading-relaxed" style={{ color: "rgba(242,241,236,0.68)" }}>
                    {line}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-7 border-t pt-5 text-[12px] leading-relaxed" style={{ borderColor: "rgba(242,241,236,0.12)", color: "rgba(242,241,236,0.42)" }}>
              Every call is metered and attributable. Missing credentials degrade to rules — never
              to a pretend model.
            </p>
          </div>

          <CompileDemo />
        </div>
      </section>

      {/* ── 3D 关系图 ── */}
      <section id="graph" className="mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-20">
        <div className="relative overflow-hidden rounded-3xl px-6 py-12 sm:px-12" style={{ background: INK }}>
          <div className="grid items-center gap-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <Eyebrow dark>One graph</Eyebrow>
              <h2 className="mt-3 font-display text-[2rem] font-bold leading-[1.08] tracking-[-0.025em] text-[#f2f1ec] sm:text-[2.4rem]">
                Everything orbits
                <span className="block" style={{ color: SIGNAL }}>
                  the mission.
                </span>
              </h2>
              <ul className="mt-6 space-y-2 text-[13px]" style={{ color: "rgba(242,241,236,0.62)" }}>
                <li>Agents draft and verify — in the open.</li>
                <li>Humans approve every risky step.</li>
                <li>Gates hold consent and budget.</li>
              </ul>
            </div>
            <OrbitGraph />
          </div>
        </div>
      </section>

      {/* ── Playbooks ── */}
      <section id="playbooks" data-gate="cases" className="mx-auto max-w-6xl px-5 pb-16 sm:px-6 sm:pb-20">
        <Eyebrow>Playbooks</Eyebrow>
        <h2 className="mt-3 font-display text-[2rem] font-bold leading-[1.08] tracking-[-0.025em] sm:text-[2.5rem]">
          What a compiled goal looks like.
        </h2>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {PLAYBOOKS.map((p, i) => (
            <PlaybookCard key={p.name} p={p} i={i} />
          ))}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed" style={{ color: FAINT }}>
          Illustrative runs computed with the product&apos;s own metering rates (introduction USD
          5.00 · outcome USD 3.00 · proposal USD 0.20 · verification USD 1.00). Not customer claims
          — live missions replace these numbers as they verify.
        </p>
      </section>

      {/* ── Interop（压缩为一条） ── */}
      <section id="interop" className="mx-auto max-w-6xl px-5 pb-16 sm:px-6 sm:pb-20">
        <div
          className="grid items-center gap-6 rounded-2xl border bg-white px-6 py-7 lg:grid-cols-[0.9fr_1.1fr] sm:px-8"
          style={{ borderColor: "rgba(11,14,17,0.12)" }}
        >
          <div>
            <Eyebrow>Interop</Eyebrow>
            <h2 className="mt-2 font-display text-[1.5rem] font-bold tracking-[-0.02em]">
              Machines connect through contracts.
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {["MCP · 5 tools", "A2A · agent card", "REST v1 · 50 routes", "OpenAPI"].map((t) => (
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
          <pre
            className="overflow-x-auto rounded-xl px-4 py-3.5 font-mono text-[11px] leading-[1.8]"
            style={{ background: PAPER, color: MUTED, border: "1px solid rgba(11,14,17,0.08)" }}
          >
            {`MCP   initialize · tools/list · tools/call
A2A   GET /.well-known/agent-card.json · POST /api/v1/a2a/tasks
REST  /api/v1/missions · /intents · /connections · /outcomes`}
          </pre>
        </div>
      </section>

      {/* ── 治理条（一行三则） ── */}
      <section className="mx-auto max-w-6xl px-5 pb-14 sm:px-6">
        <div
          className="grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-3"
          style={{ borderColor: "rgba(11,14,17,0.12)", background: "rgba(11,14,17,0.12)" }}
        >
          {[
            ["Tenant isolated", "Org resolved from the session, never the client."],
            ["Audit, not logs", "Security and business events recorded separately."],
            ["Metered, not guessed", "Per-event billing; sandboxes never counted."],
          ].map(([t, d]) => (
            <div key={t} className="bg-white px-5 py-4">
              <p className="font-display text-[13.5px] font-bold">{t}</p>
              <p className="mt-1 text-[12px] leading-relaxed" style={{ color: MUTED }}>
                {d}
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
          <div className="relative flex flex-col items-start justify-between gap-7 lg:flex-row lg:items-end">
            <div>
              <Eyebrow dark>Start with one real goal</Eyebrow>
              <h2 className="mt-3 max-w-xl font-display text-[2rem] font-bold leading-[1.08] tracking-[-0.025em] text-[#f2f1ec] sm:text-[2.5rem]">
                Bring the outcome you are chasing.
              </h2>
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
