"use client";

/**
 * 登录页 v4 —— 「生成式登录」（纸面设计语言，与首页同一套 token）
 *
 * ── 为什么改 ─────────────────────────────────────────────────────
 *   旧版是 Cool Blue 毛玻璃 + 视频背景 + 霓虹 lime CTA，视觉上属于另一个产品；
 *   进站第一屏换成深色霓虹，用户会以为跳到了旧站点。v4 换成与首页一致的
 *   ink / paper / signal 三色，且不再依赖任何图片或视频资源。
 *
 * ── 「生成式」体现在哪（不是装饰）─────────────────────────────────
 *   左栏是一个**随输入生成的 preflight 面板**：输入的邮箱会实时推导出
 *   `identity / domain / workspace / skills / gates / session` 六行——即
 *   「登录之后会被开通成什么」。它是从**真实配置**派生的（3 个技能键、
 *   服务端会话、租户来自会话），不是随机文案。
 *
 * 🔴 诚实边界：左栏**不宣称**登录会调用模型，也不做假的进度条。提交时只显示
 *   「verifying credentials」，失败时把真实错误同时反映到表单与左栏。
 *
 * ── 兼容性（必须保持）───────────────────────────────────────────────
 *   · `#login-email` / `#login-password` / `button[type=submit]` —— e2e 登录夹具依赖；
 *   · `#login-error` + aria-describedby —— 读屏与测试依赖；
 *   · Google（自定义 PKCE）、X（OAuth 2.0 + PKCE）、游客、OAuth-only 分支全部保留。
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import GoogleSignInButton from "@/components/auth/google-sign-in-button";
import { safeJsonParse, getAuthErrorMessage } from "@/lib/safe-json";

interface Props {
  callbackUrl: string;
  errorMessage: string;
}

const INK = "#0b0e11";
const PAPER = "#f7f5f0";
const SIGNAL_DEEP = "#8a5a1e";
const MUTED = "#5a636b";
const FAINT = "#626a70";
const LINE = "rgba(11,14,17,0.16)";
const HAIRLINE = "rgba(11,14,17,0.09)";

const SKILLS = ["INTENT_EXTRACTION", "INTRO_DRAFT", "COORDINATION_ADVICE"];

/** 从邮箱派生工作区标识（只做展示，不参与任何鉴权判断）。 */
function deriveWorkspace(email: string): string {
  const domain = email.includes("@") ? email.split("@")[1] ?? "" : "";
  const host = domain.split(".")[0]?.replace(/[^a-z0-9-]/gi, "").toLowerCase() ?? "";
  if (!host || ["gmail", "qq", "163", "outlook", "hotmail", "icloud", "proton"].includes(host)) {
    return "personal";
  }
  return host.slice(0, 24);
}

export default function LoginInnerClient({ callbackUrl, errorMessage: initialError }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSlowResponse, setIsSlowResponse] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [twitterError, setTwitterError] = useState<string | null>(null);
  const [oauthOnly, setOauthOnly] = useState<{ providers: string; email: string } | null>(null);

  const workspace = useMemo(() => deriveWorkspace(email), [email]);

  // ─── X (Twitter) OAuth — manual navigation (custom GET handler) ───
  const handleTwitterSignIn = useCallback(async () => {
    setTwitterError(null);
    setIsLoading(true);
    try {
      window.location.href = `/api/auth/oauth/twitter/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    } catch {
      setTwitterError("Failed to connect to X. Please try again.");
      setIsLoading(false);
    }
  }, [callbackUrl]);

  // ─── Email + password → /api/auth/login（服务端校验并下发会话 cookie）───
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSlowResponse(false);

    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsLoading(true);
    const slowTimer = setTimeout(() => setIsSlowResponse(true), 3000);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.toLowerCase().trim(),
          password,
          callbackUrl: callbackUrl || "/dashboard",
          rememberMe,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      clearTimeout(slowTimer);

      const data = await safeJsonParse<{
        success?: boolean;
        error?: string;
        errorCode?: string;
        providers?: string;
        email?: string;
        redirectUrl?: string;
      }>(res);

      if (!res.ok || !data.success) {
        if (data.errorCode === "OAUTH_ONLY") {
          setOauthOnly({ providers: data.providers || "", email: data.email || email });
          setError("");
          setIsLoading(false);
          return;
        }
        setError(data.error || "Sign in failed. Please try again.");
        setIsLoading(false);
        return;
      }

      // 会话 cookie 已由服务端写入，直接导航
      window.location.href = data.redirectUrl || "/dashboard";
    } catch (err) {
      clearTimeout(slowTimer);
      if (err instanceof Error && err.name === "AbortError") {
        setError("Request timed out. The server may be busy. Please try again.");
      } else {
        setError(getAuthErrorMessage(err));
      }
      setIsLoading(false);
    }
  };

  const handleGuestContinue = useCallback(async () => {
    setIsLoading(true);
    try {
      window.location.href = `/api/guest?callbackUrl=${encodeURIComponent(callbackUrl || "/dashboard")}`;
    } catch {
      setError("Unable to continue as guest. Please try again.");
      setIsLoading(false);
    }
  }, [callbackUrl]);

  /* ───────────────────────── 左栏：生成的 preflight ───────────────────────── */

  const preflight: Array<[string, string]> = [
    ["identity", email.trim() || "waiting for email"],
    ["workspace", workspace],
    ["skills", `${SKILLS.length} · ${SKILLS.join(" ")}`],
    ["gates", "consent · budget · approval"],
    ["session", "httpOnly · issued server-side"],
    ["tenant", "resolved from session, never client"],
  ];

  const aside = (
    <aside
      className="relative hidden overflow-hidden px-12 py-12 lg:flex lg:flex-col lg:justify-between"
      style={{ background: INK }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(242,241,236,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(242,241,236,0.05) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 70% 60% at 30% 20%, black, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 30% 20%, black, transparent 78%)",
        }}
      />

      <Link href="/" className="relative flex items-center gap-2.5" aria-label="LokFeel home">
        <span
          className="grid h-7 w-7 place-items-center rounded-md font-display text-[13px] font-bold"
          style={{ background: "#f2f1ec", color: INK }}
        >
          L
        </span>
        <span className="font-display text-[15px] font-bold tracking-[-0.01em]" style={{ color: "#f2f1ec" }}>
          LOKFEEL
        </span>
        <span
          className="ml-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
          style={{ borderColor: "rgba(242,241,236,0.22)", color: "rgba(242,241,236,0.66)" }}
        >
          Connection OS
        </span>
      </Link>

      <div className="relative max-w-[27rem]">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: "rgba(242,241,236,0.55)" }}>
          Preflight
        </p>
        <p
          className="mt-3 font-display text-[1.65rem] font-bold leading-[1.15] tracking-[-0.02em]"
          style={{ color: "#f2f1ec" }}
        >
          This is what your sign-in
          <br />
          will provision.
        </p>

        <dl className="mt-7 space-y-0">
          {preflight.map(([k, v], i) => (
            <div
              key={k}
              className="grid grid-cols-[5.5rem_1fr] items-baseline gap-3 py-2.5"
              style={{ borderTop: i === 0 ? "none" : `1px solid rgba(242,241,236,0.1)` }}
            >
              <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: "rgba(242,241,236,0.5)" }}>
                {k}
              </dt>
              <dd
                className="min-w-0 break-words font-mono text-[11.5px] leading-relaxed"
                style={{ color: k === "identity" && !email.trim() ? "rgba(242,241,236,0.42)" : "#f2f1ec" }}
              >
                {v}
                {k === "identity" && email.trim() && (
                  <span className="ml-0.5 inline-block h-3 w-[6px] translate-y-[1px] bg-[#b8863f] motion-safe:animate-pulse" aria-hidden />
                )}
              </dd>
            </div>
          ))}
        </dl>

        {isLoading && (
          <p className="mt-4 font-mono text-[10.5px]" style={{ color: "#d2a35f" }} role="status">
            {isSlowResponse ? "still verifying…" : "verifying credentials…"}
          </p>
        )}
        {error && (
          <p className="mt-4 font-mono text-[10.5px] leading-relaxed" style={{ color: "#e2a49b" }}>
            sign-in rejected · see the form
          </p>
        )}
      </div>

      <p className="relative font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: "rgba(242,241,236,0.55)" }}>
        self-approval rejected · consent fail-closed · audit separate from logs
      </p>
    </aside>
  );

  /* ───────────────────────── OAuth-only 分支 ───────────────────────── */

  if (oauthOnly) {
    return (
      <main className="grid min-h-screen lg:grid-cols-[1.02fr_0.98fr]">
        {aside}
        <div className="flex items-center justify-center px-6 py-14 sm:px-10" style={{ background: PAPER }}>
          <div className="w-full max-w-[24rem]">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: FAINT }}>
              LokFeel
            </p>
            <h1 className="mt-3 font-display text-[1.9rem] font-bold leading-[1.1] tracking-[-0.03em]" style={{ color: INK }}>
              Welcome back.
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed" style={{ color: MUTED }}>
              This account uses social login. Continue with the provider you signed up with.
            </p>

            <div className="mt-7 flex flex-col gap-2.5">
              {oauthOnly.providers.includes("google") && (
                <GoogleSignInButton callbackUrl={callbackUrl} label="Continue with Google" variant="paper" />
              )}
              {oauthOnly.providers.includes("twitter") && (
                <button type="button" onClick={handleTwitterSignIn} className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl border bg-white px-4 text-[14px] font-medium" style={{ borderColor: LINE, color: INK }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
                  </svg>
                  Continue with X
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setOauthOnly(null);
                setEmail("");
                setPassword("");
              }}
              className="mt-6 inline-flex min-h-11 items-center text-[13px] underline-offset-4 hover:underline"
              style={{ color: SIGNAL_DEEP }}
            >
              Use a different email
            </button>

            <div className="mt-2">
              <button
                type="button"
                onClick={handleGuestContinue}
                className="inline-flex min-h-11 items-center text-[13px]"
                style={{ color: MUTED }}
              >
                Continue as guest
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* ───────────────────────── 主登录表单 ───────────────────────── */

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.02fr_0.98fr]">
      {aside}

      <div className="flex items-center justify-center px-6 py-12 sm:px-10" style={{ background: PAPER }}>
        <div className="w-full max-w-[24rem]">
          {/* 移动端品牌（桌面端品牌在左栏） */}
          <Link href="/" className="mb-8 inline-flex items-center gap-2 lg:hidden" aria-label="LokFeel home">
            <span className="grid h-6 w-6 place-items-center rounded font-display text-[11px] font-bold text-white" style={{ background: INK }}>
              L
            </span>
            <span className="font-display text-[13px] font-bold tracking-[-0.01em]" style={{ color: INK }}>
              LOKFEEL
            </span>
          </Link>

          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: FAINT }}>
            Sign in
          </p>
          <h1 className="mt-3 font-display text-[1.9rem] font-bold leading-[1.1] tracking-[-0.03em]" style={{ color: INK }}>
            Welcome back.
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed" style={{ color: MUTED }}>
            Pick up where your workspace left off.
          </p>

          {/* 社交登录 */}
          <div className="mt-7 flex flex-col gap-2.5">
            <GoogleSignInButton callbackUrl={callbackUrl} disabled={isLoading} label="Continue with Google" variant="paper" />

            <button
              type="button"
              onClick={handleTwitterSignIn}
              disabled={isLoading}
              className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl border bg-white px-4 text-[14px] font-medium transition-colors hover:bg-[#faf9f6] disabled:opacity-50"
              style={{ borderColor: LINE, color: INK }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
              </svg>
              Continue with X
            </button>
            {twitterError && (
              <p role="alert" className="rounded-xl px-3 py-2 text-[12.5px]" style={{ background: "#fdf2f0", color: "#8c3b31", border: "1px solid rgba(140,59,49,0.24)" }}>
                {twitterError}
              </p>
            )}
          </div>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1" style={{ background: HAIRLINE }} />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: FAINT }}>
              or use email
            </span>
            <span className="h-px flex-1" style={{ background: HAIRLINE }} />
          </div>

          {error && (
            <div
              id="login-error"
              role="alert"
              className="mb-4 rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed"
              style={{ background: "#fdf2f0", color: "#8c3b31", border: "1px solid rgba(140,59,49,0.24)" }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <div>
              <label htmlFor="login-email" className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: MUTED }}>
                Email or phone
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                disabled={isLoading}
                placeholder="you@company.com"
                aria-describedby={error ? "login-error" : undefined}
                className="min-h-12 w-full rounded-xl border bg-white px-3.5 text-[15px] outline-none transition-colors focus:border-[#8a5a1e] disabled:opacity-60"
                style={{ borderColor: LINE, color: INK }}
              />
            </div>

            <div>
              <label htmlFor="login-password" className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: MUTED }}>
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="current-password"
                  disabled={isLoading}
                  placeholder="At least 8 characters"
                  aria-describedby={error ? "login-error" : undefined}
                  className="min-h-12 w-full rounded-xl border bg-white px-3.5 pr-12 text-[15px] outline-none transition-colors focus:border-[#8a5a1e] disabled:opacity-60"
                  style={{ borderColor: LINE, color: INK }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  disabled={isLoading}
                  className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg"
                  style={{ color: FAINT }}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px]" style={{ color: MUTED }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#0b0e11]"
                />
                Remember me
              </label>
              <Link
                href="/forgot-password"
                className="inline-flex min-h-11 items-center text-[12.5px] underline-offset-4 hover:underline"
                style={{ color: SIGNAL_DEEP }}
              >
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="mt-1 flex min-h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: INK }}
            >
              {isLoading ? (
                <>
                  <Loader2 size={17} className="animate-spin" />
                  {isSlowResponse ? "Still working…" : "Signing in…"}
                </>
              ) : (
                "Log in"
              )}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-between gap-3 text-[12.5px]" style={{ color: MUTED }}>
            <button
              type="button"
              onClick={handleGuestContinue}
              className="inline-flex min-h-11 items-center transition-colors hover:text-[#0b0e11]"
            >
              Continue as guest
            </button>
            <Link href="/register" className="inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline" style={{ color: SIGNAL_DEEP }}>
              Create account
            </Link>
          </div>

          <p className="mt-6 text-[11px] leading-relaxed" style={{ color: FAINT }}>
            By signing in you accept the{" "}
            <Link href="/terms" className="underline underline-offset-2">
              terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-2">
              privacy policy
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
