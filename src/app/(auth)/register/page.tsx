"use client";

/**
 * RegisterPage — Feeld-style single-page registration (PC-optimized)
 * COOL BLUE V2: Uses Tailwind classes, no inline styles, PC-friendly
 *
 * Changes from original:
 * - Removed `colors` object, ALL inline styles → Tailwind classes
 * - PC layout: max-w-md centered, proper spacing
 * - Design system: v6 Cool Blue (#3b82f6 / #22d3ee)
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Mail,
  CheckCircle2,
  Calendar,
  User,
  Lock,
} from "lucide-react";
import { signIn } from "next-auth/react";

// Google OAuth — uses direct redirect to bypass NextAuth PKCE issue
import GoogleSignInButton from "@/components/auth/google-sign-in-button";
import { safeJsonParse } from "@/lib/safe-json";

// V22 §F: carry the typed goal through signup onto the Now screen.
import { restoreGoalDraft, withGoal, writeGoalDraft } from "@/lib/goal-draft";

// ─── Registration State Persistence (GA-20: sensitive-free whitelist) ───
// P0 修复：旧实现把整个 formData（含 password/dob/gender/sexuality）和
// sentInfo.code 写进 localStorage 达 24h。现在所有落盘都经过安全边界：
// 写入只产出非敏感白名单，读取同时兼容并清洗旧格式的敏感缓存。
import {
  REG_STATE_KEY,
  REG_STATE_VERSION,
  buildPersistableRegState,
  parsePersistedRegState,
  type RegPhase,
} from '@/lib/auth/registration-state';

type RegSentInfo = { maskedIdentifier?: string; devMode?: boolean; code?: string };

function saveRegState(phase: RegPhase, formData: Record<string, string | boolean>, sentInfo: RegSentInfo) {
  if (typeof window === 'undefined') return;
  try {
    // 白名单投影：password / dob / gender / sexuality / code 物理上不进 payload。
    const state = buildPersistableRegState(phase, formData, sentInfo, Date.now());
    localStorage.setItem(REG_STATE_KEY, JSON.stringify({ version: REG_STATE_VERSION, value: state }));
  } catch { /* ignore */ }
}

function loadRegState(): ReturnType<typeof parsePersistedRegState> {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(REG_STATE_KEY);
    const state = parsePersistedRegState(raw, Date.now());
    if (!state) {
      // 过期或无法解析（含旧格式的敏感缓存）→ 清理，避免明文长期残留。
      if (raw) localStorage.removeItem(REG_STATE_KEY);
      return null;
    }
    // 读到的即白名单结构；旧格式敏感字段已被丢弃，回写一次完成就地清洗。
    localStorage.setItem(REG_STATE_KEY, JSON.stringify({ version: REG_STATE_VERSION, value: state }));
    return state;
  } catch { return null; }
}

function clearRegState() {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(REG_STATE_KEY); } catch { /* ignore */ }
}

// ─── 字段级错误：谁能被指到，就只指向谁 ───
// 之前所有错误都塞进一个 `#reg-error` 横幅，三个输入框同时 aria-describedby 指向它，
// 而 DOB 三个下拉和两个勾选框**一个都没接**。结果是：读屏用户在最该听清原因的那几个
// 控件上什么也听不到，而已经填对的输入框反而被挂上一条跟自己无关的描述。
type RegField = 'name' | 'email' | 'dob' | 'password' | 'agreeToTerms' | 'confirmAge';

/** 出错时焦点该落到哪个控件（DOM id）。 */
const FIELD_INPUT_ID: Record<RegField, string> = {
  name: 'reg-name',
  email: 'reg-email',
  dob: 'dob-year',
  password: 'reg-password',
  agreeToTerms: 'reg-agreeToTerms',
  confirmAge: 'reg-confirmAge',
};

/** 该字段的错误文本节点 id —— 只在错误存在时才渲染，不允许指向不存在的节点。 */
const FIELD_ERROR_ID: Record<RegField, string> = {
  name: 'reg-name-error',
  email: 'reg-email-error',
  dob: 'reg-dob-error',
  password: 'reg-password-error',
  agreeToTerms: 'reg-terms-error',
  confirmAge: 'reg-age-error',
};

const PASSWORD_HELP_ID = 'reg-password-help';

interface FieldError {
  field: RegField;
  message: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<'form' | 'verify'>('form');
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    dob: "",        // Date of Birth — new field
    gender: "",
    sexuality: "",
    agreeToTerms: false,
    confirmAge: false,
  });
  const [verificationCode, setVerificationCode] = useState(["", "", "", "", "", ""]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [sentInfo, setSentInfo] = useState<{ maskedIdentifier?: string; devMode?: boolean; code?: string }>({});
  const [dobYear, setDobYear] = useState("");
  const [dobMonth, setDobMonth] = useState("");
  const [dobDay, setDobDay] = useState("");
  /** V22 §F: the original goal carried from the landing page (read-only display). */
  const [goalDraft, setGoalDraft] = useState("");

  // ─── Restore state on mount ───
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('reset')) {
      clearRegState();
      return;
    }

    const saved = loadRegState();
    // GA-20：只回填白名单非敏感字段。password / dob / gender / sexuality
    // 永不从浏览器存储恢复（它们本就不该被持久化）。验证码 code 同样不恢复。
    if (saved && saved.phase === 'verify' && saved.email) {
      setPhase('verify');
      setFormData(prev => ({
        ...prev,
        email: saved.email,
        name: saved.name || prev.name,
        agreeToTerms: saved.agreeToTerms,
        confirmAge: saved.confirmAge,
      }));
      setSentInfo({
        maskedIdentifier: saved.sentInfo?.maskedIdentifier || undefined,
        devMode: saved.sentInfo?.devMode || undefined,
        // code 刻意不恢复：验证码必须从服务端重新发送，不能从 localStorage 复活。
      });
    } else if (saved && saved.phase === 'form' && saved.email) {
      setFormData(prev => ({
        ...prev,
        email: saved.email,
        name: saved.name || prev.name,
        agreeToTerms: saved.agreeToTerms,
        confirmAge: saved.confirmAge,
      }));
    }
  }, []);

  // ─── V22 §F: restore the goal draft carried from the landing page ───
  // URL `?goal=` wins, then sessionStorage (so a refresh still recovers it).
  // Persist whatever we restored: a shared /register?goal= link may have had no
  // prior storage write, and we want the draft to survive a later reload/redirect.
  useEffect(() => {
    const restored = restoreGoalDraft();
    if (restored) {
      // Mount-only restore from client state (URL/storage): initial state stays ""
      // on both server and first client render, so hydration matches.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGoalDraft(restored);
      writeGoalDraft(restored);
    }
  }, []);

  // Auto-parse dob into dropdowns on mount
  useEffect(() => {
    if (formData.dob && formData.dob.includes("-")) {
      const parts = formData.dob.split("-");
      setDobYear(parts[0] || "");
      setDobMonth(parts[1] || "");
      setDobDay(parts[2] || "");
    }
  }, []);

  const updateDob = useCallback(() => {
    if (dobYear && dobMonth && dobDay) {
      const dateStr = `${dobYear}-${dobMonth.padStart(2, "0")}-${dobDay.padStart(2, "0")}`;
      setFormData(prev => ({ ...prev, dob: dateStr }));
    }
  }, [dobYear, dobMonth, dobDay]);

  useEffect(() => { updateDob(); }, [updateDob]);

  // Auto-save
  const saveState = useCallback(() => {
    saveRegState(phase, formData as any, sentInfo);
  }, [phase, formData, sentInfo]);

  useEffect(() => { saveState(); }, [saveState]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked : value,
    }));
    // 用户开始改这个字段了，就把它的提示撤掉 —— 否则一边改一边挂着红字
    setFieldError(prev => (prev?.field === name ? null : prev));
  };

  /** DOB 没有 `name`（三个 state 拼出来的），单独清。 */
  const clearDobError = () => setFieldError(prev => (prev?.field === 'dob' ? null : prev));

  const startCountdown = () => {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // ─── Validation ───
  // 返回值带上「是哪个字段」，才能把错误挂到那个控件上、并把焦点送过去。
  const validateForm = (): FieldError | null => {
    if (!formData.name.trim()) return { field: 'name', message: "Please enter your name" };
    if (!formData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email))
      return { field: 'email', message: "Please enter a valid email address" };
    if (!formData.dob) return { field: 'dob', message: "Please enter your date of birth" };
    // Check age >= 18
    const dob = new Date(formData.dob);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
    if (age < 18) return { field: 'dob', message: "You must be at least 18 years old" };
    if (formData.password.length < 8)
      return { field: 'password', message: "Password must be at least 8 characters" };
    if (!formData.agreeToTerms)
      return { field: 'agreeToTerms', message: "You must agree to the Terms of Service and Privacy Policy" };
    if (!formData.confirmAge)
      return { field: 'confirmAge', message: "You must confirm you are at least 18 years old" };
    return null;
  };

  /**
   * 把焦点送到出错的控件上。
   * 放到下一帧做：错误文本节点要等这次渲染提交后才存在，
   * 先 focus 再渲染的话，读屏读到的 aria-describedby 还是上一帧的值。
   */
  const focusField = (field: RegField) => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      document.getElementById(FIELD_INPUT_ID[field])?.focus();
    });
  };

  const handleSendCode = async () => {
    const invalid = validateForm();
    if (invalid) {
      setFieldError(invalid);
      setError("");
      focusField(invalid.field);
      return;
    }

    setFieldError(null);
    setIsSendingCode(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "send-code",
          name: formData.name,
          email: formData.email,
          password: formData.password,
          gender: formData.gender || "OTHER",
          sexuality: formData.sexuality || "OTHER",
          verifyMethod: "email",
        }),
      });

      const data = await safeJsonParse<{ message?: string; maskedIdentifier?: string; devMode?: boolean; code?: string }>(res);
      if (!res.ok) throw new Error(data.message || "Failed to send verification code");

      setSentInfo({
        maskedIdentifier: data.maskedIdentifier,
        devMode: data.devMode,
        code: data.code,
      });

      setPhase("verify");
      startCountdown();
    } catch (err: any) {
      setError(err.message || "Failed to send code. Please try again.");
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleResendCode = async () => {
    if (countdown > 0) return;
    setIsSendingCode(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.email, name: formData.name }),
      });
      const data = await safeJsonParse<{ message?: string; devMode?: boolean; code?: string }>(res);
      if (!res.ok) throw new Error(data.message || "Failed to resend");

      if (data.devMode) setSentInfo(prev => ({ ...prev, code: data.code }));
      startCountdown();
    } catch (err: any) {
      setError(err.message || "Failed to resend. Please try again.");
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    if (value.length > 1) return;
    if (!/^\d*$/.test(value)) return;
    const newCode = [...verificationCode];
    newCode[index] = value;
    setVerificationCode(newCode);
    if (value && index < 5) {
      document.getElementById(`code-${index + 1}`)?.focus();
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !verificationCode[index] && index > 0) {
      document.getElementById(`code-${index - 1}`)?.focus();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      handleVerifyAndCreate();
    }
  };

  const handleVerifyAndCreate = async () => {
    const code = verificationCode.join("");
    if (code.length !== 6) { setError("Please enter the complete 6-digit code"); return; }

    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "verify-and-create",
          name: formData.name,
          email: formData.email,
          password: formData.password,
          gender: formData.gender || "OTHER",
          sexuality: formData.sexuality || "OTHER",
          code,
          verifyMethod: "email",
        }),
      });

      const data = await safeJsonParse<{ message?: string; autoLoginToken?: string; redirectTo?: string }>(res);
      if (!res.ok) throw new Error(data.message || "Registration failed");

      if (data.autoLoginToken) {
        try {
          const autoLoginRes = await fetch("/api/auth/auto-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: data.autoLoginToken,
              email: formData.email.toLowerCase().trim(),
            }),
          });

          if (autoLoginRes.ok) {
            const signInResult: any = await signIn("credentials", {
              email: formData.email.toLowerCase().trim(),
              password: formData.password,
              redirect: false,
            });

            if (signInResult?.ok || signInResult?.url) {
              clearRegState();
              await new Promise(resolve => setTimeout(resolve, 500));
              // V22 §F: with a goal draft, land on the Now screen with the goal
              // prefilled so the user can create a plan right away. Without a
              // draft, keep the existing login/onboarding target untouched.
              const carriedGoal = restoreGoalDraft();
              // GA-06：注册后直达真实 Chats（作战包 AUTH-01/USER-01），
              // 不再落进 onboarding / 空 Studio。有 goal 草稿时保留原兼容路径。
              window.location.assign(carriedGoal
                ? withGoal("/workspace?view=now", carriedGoal)
                : "/dashboard/chats");
              return;
            }
          }
        } catch (error) {
          console.error("Auto-login failed:", error);
        }
      }

      clearRegState();
      // Keep the original login target, but carry the goal onto it so the relay
      // is not lost when auto-login is unavailable.
      // GA-06：无 auto-login 时回登录页也要带真实聊天回跳，避免落到 /dashboard→workspace。
      router.push(withGoal("/login?registered=true&callbackUrl=/dashboard/chats", restoreGoalDraft()));
    } catch (err: any) {
      setError(err.message || "Verification failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * V22 §F: show the original goal above the form so the user knows it is kept.
   * `goalDraft` comes from an untrusted URL param / storage — it is rendered as a
   * React TEXT node only (auto-escaped). No dangerouslySetInnerHTML, no innerHTML.
   */
  const goalDraftHint = goalDraft ? (
    <div
      className="mb-4 rounded-xl border border-primary/25 bg-primary-muted p-3 text-sm"
      data-testid="goal-draft-hint"
    >
      <p className="font-medium text-foreground">Your goal will be waiting after you sign up</p>
      <p className="mt-1 break-words text-foreground-muted">{goalDraft}</p>
    </div>
  ) : null;

  // ─── VERIFY PHASE ───
  if (phase === "verify") {
    return (
      <div className="w-full max-w-md mx-auto px-6 py-8 min-h-screen flex flex-col justify-center">
        {/* Header */}
        <div className="text-center mb-7">
          <div className="flex items-center justify-center gap-2.5 mb-5">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-lime-400 to-lime-600 flex items-center justify-center">
              <CheckCircle2 size={22} className="text-white" />
            </div>
            <span className="text-2xl font-bold font-display text-foreground">Lok<span className="text-primary">Feel</span></span>
          </div>
          <h1 className="text-2xl font-bold text-foreground font-display mb-2">Verify Your Email</h1>
          <p className="text-sm text-foreground-muted">
            We sent a 6-digit code to{' '}
            <span className="text-foreground font-medium">{sentInfo.maskedIdentifier || formData.email}</span>
          </p>
        </div>

        {goalDraftHint}

        {/* Dev mode code display */}
        {sentInfo.devMode && (
          <div className="mb-4 p-3 rounded-xl bg-primary-muted border border-primary/20 text-sm text-primary">
            Dev mode: code sent — check server console
          </div>
        )}

        {/* Error */}
        {error && (
          <div id="reg-code-error" role="alert" className="mb-4 p-3 rounded-xl bg-error-muted border border-error/20 text-sm text-error">
            {error}
          </div>
        )}

        {/* Code inputs */}
        <div className="flex justify-center gap-2.5 mb-6">
          {verificationCode.map((digit, index) => (
            <input
              key={index}
              id={`code-${index}`}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              aria-label={`Verification code digit ${index + 1} of 6`}
              aria-describedby={error ? "reg-code-error" : undefined}
              autoComplete={index === 0 ? "one-time-code" : undefined}
              onChange={(e) => handleCodeChange(index, e.target.value)}
              onKeyDown={(e) => handleCodeKeyDown(index, e)}
              onFocus={(e) => { e.target.select(); }}
              disabled={isLoading}
              autoFocus={index === 0}
              className="w-12 h-14 text-center text-xl font-bold rounded-xl bg-input-bg border border-input-border focus:border-input-border-focus focus:outline-none text-foreground transition-all"
            />
          ))}
        </div>

        {/* Verify button */}
        <button
          onClick={handleVerifyAndCreate}
          disabled={isLoading}
          className="auth-cta w-full"
        >
          {isLoading ? (
            <span className="inline-flex items-center gap-2"><Loader2 size={18} className="animate-spin" />Verifying...</span>
          ) : (
            <span className="inline-flex items-center gap-2"><CheckCircle2 size={18} />Verify & Create Account</span>
          )}
        </button>

        {/* Resend */}
        <div className="text-center mt-4">
          <button
            onClick={handleResendCode}
            disabled={countdown > 0 || isSendingCode}
            className="text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-transparent border-none cursor-pointer text-primary hover:text-primary-hover"
          >
            {isSendingCode ? "Sending..." : countdown > 0 ? `Resend code in ${countdown}s` : "Didn't receive it? Resend"}
          </button>
        </div>

        {/* Back */}
        <button
          onClick={() => setPhase("form")}
          className="w-full text-center mt-3 text-sm text-foreground-muted hover:text-foreground transition-colors bg-transparent border-none cursor-pointer"
        >
          ← Back to registration
        </button>
      </div>
    );
  }

  // ─── FORM PHASE ───
  return (
    <div className="w-full max-w-md mx-auto px-6 py-8 min-h-screen flex flex-col justify-center">
      {/* Header — Brand: LokFeel */}
      <div className="text-center mb-7">
        <div className="flex items-center justify-center gap-2.5 mb-5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
            <User size={22} className="text-white" />
          </div>
          <span className="text-2xl font-bold font-display text-foreground">Lok<span className="text-primary">Feel</span></span>
        </div>
        <h1 className="text-2xl font-bold text-foreground font-display mb-2">Join LokFeel!</h1>
        <p className="text-sm text-foreground-muted">Start your journey to meaningful connection</p>
      </div>

      {/* ─── SOCIAL LOGIN — VERTICAL STACK (Google top, X bottom) ─── */}
      <div className="flex flex-col gap-2.5 mb-5">
        {/* Google — GIS with FedCM */}
        <GoogleSignInButton
          callbackUrl={withGoal("/dashboard/onboarding", goalDraft)}
          disabled={isLoading}
          label="Continue with Google"
        />

        {/* X (Twitter) — Native OAuth 2.0 + PKCE */}
        <button
          type="button"
          onClick={() => { window.location.href = `/api/auth/twitter/signin?callbackUrl=${encodeURIComponent(withGoal("/dashboard/onboarding", goalDraft))}`; }}
          disabled={isLoading}
          className="auth-social-btn w-full"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
          </svg>
          Continue with X
        </button>

      </div>

      {/* Divider */}
      <div className="auth-divider mb-5">
        <span>or continue with email</span>
      </div>

      {/*
        页面级错误（服务端 / 网络）。客户端校验错误不再走这里 ——
        它挂在具体字段下面，见 fieldError。
        原先这里还有一段 `error.includes("X")` 的分流：只要有哪个报错文案里带个字母 X，
        它就会被渲染到社交登录按钮下面、并且从主错误区消失。这个分支从来没人写入过
        （全仓没有任何 setError 产出含 X 的文案），留着只会等一次误判。
      */}
      {error && (
        <div id="reg-error" role="alert" className="mb-4 p-3 rounded-xl bg-error-muted border border-error/20 text-sm text-error">
          {error}
        </div>
      )}

      {/* ─── V22 §F: the original goal, shown above the form ─── */}
      {goalDraftHint}

      {/* REGISTRATION FORM */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleSendCode(); }}
        className="flex flex-col gap-4"
        noValidate
      >
        {/* Name */}
        <div className="form-group">
          <label
            htmlFor="reg-name"
            className="block text-sm font-medium text-foreground-muted mb-2"
          >
            <User size={13} className="inline mr-1.5 align-middle" />Name <span className="text-error">*</span>
          </label>
          <input
            id="reg-name"
            name="name"
            type="text"
            value={formData.name}
            onChange={handleChange}
            required
            autoComplete="name"
            autoFocus
            placeholder="Enter your name"
            aria-invalid={fieldError?.field === 'name' || undefined}
            aria-describedby={fieldError?.field === 'name' ? FIELD_ERROR_ID.name : undefined}
            className="auth-input w-full"
          />
          {fieldError?.field === 'name' && (
            <p id={FIELD_ERROR_ID.name} role="alert" className="mt-1.5 text-xs text-error">
              {fieldError.message}
            </p>
          )}
        </div>

        {/* Email */}
        <div className="form-group">
          <label
            htmlFor="reg-email"
            className="block text-sm font-medium text-foreground-muted mb-2"
          >
            <Mail size={13} className="inline mr-1.5 align-middle" />Email <span className="text-error">*</span>
          </label>
          <input
            id="reg-email"
            name="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
            required
            autoComplete="email"
            placeholder="Enter your email"
            aria-invalid={fieldError?.field === 'email' || undefined}
            aria-describedby={fieldError?.field === 'email' ? FIELD_ERROR_ID.email : undefined}
            className="auth-input w-full"
          />
          {fieldError?.field === 'email' && (
            <p id={FIELD_ERROR_ID.email} role="alert" className="mt-1.5 text-xs text-error">
              {fieldError.message}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="form-group">
          <label
            htmlFor="reg-password"
            className="block text-sm font-medium text-foreground-muted mb-2"
          >
            <Lock size={13} className="inline mr-1.5 align-middle" />Password <span className="text-error">*</span>
          </label>
          <input
            id="reg-password"
            name="password"
            type="password"
            value={formData.password}
            onChange={handleChange}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Min 8 characters"
            aria-invalid={fieldError?.field === 'password' || undefined}
            aria-describedby={
              fieldError?.field === 'password'
                ? `${PASSWORD_HELP_ID} ${FIELD_ERROR_ID.password}`
                : PASSWORD_HELP_ID
            }
            className="auth-input w-full"
          />
          {/* 帮助文本常驻：密码规则不该只存在于 placeholder 里（输入第一个字符就没了） */}
          <p id={PASSWORD_HELP_ID} className="mt-1.5 text-xs text-foreground-subtle">
            At least 8 characters.
          </p>
          {fieldError?.field === 'password' && (
            <p id={FIELD_ERROR_ID.password} role="alert" className="mt-1.5 text-xs text-error">
              {fieldError.message}
            </p>
          )}
        </div>

        {/* Date of Birth — 3 dropdowns */}
        {/*
          三个下拉共用一个可见标题，但 `htmlFor` 只能指向一个控件 —— 之前它指向年，
          月和日就成了「没有名字的组合框」，读屏只会念一句 “Jan”。改成 group：
          可见标题给它命名，每个下拉各自 aria-label 说清是年/月/日。
        */}
        <div
          className="form-group"
          role="group"
          aria-labelledby="reg-dob-label"
          aria-describedby={fieldError?.field === 'dob' ? FIELD_ERROR_ID.dob : undefined}
        >
          <span
            id="reg-dob-label"
            className="block text-sm font-medium text-foreground-muted mb-2"
          >
            <Calendar size={13} className="inline mr-1.5 align-middle" />Date of Birth <span className="text-error">*</span>
          </span>
          <div className="grid grid-cols-3 gap-2.5">
            <select
              id="dob-year"
              aria-label="Birth year"
              aria-invalid={fieldError?.field === 'dob' || undefined}
              value={dobYear}
              onChange={(e) => { setDobYear(e.target.value); clearDobError(); }}
              required
              className="auth-input !py-3 !px-3"
            >
              <option value="">Year</option>
              {Array.from({ length: new Date().getFullYear() - 18 - 1920 + 1 }, (_, i) => new Date().getFullYear() - 18 - i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <select
              id="dob-month"
              aria-label="Birth month"
              aria-invalid={fieldError?.field === 'dob' || undefined}
              value={dobMonth}
              onChange={(e) => { setDobMonth(e.target.value); clearDobError(); }}
              required
              className="auth-input !py-3 !px-3"
            >
              <option value="">Month</option>
              {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                <option key={i + 1} value={(i + 1).toString().padStart(2, "0")}>{i + 1} - {m}</option>
              ))}
            </select>
            <select
              id="dob-day"
              aria-label="Birth day"
              aria-invalid={fieldError?.field === 'dob' || undefined}
              value={dobDay}
              onChange={(e) => { setDobDay(e.target.value); clearDobError(); }}
              required
              className="auth-input !py-3 !px-3"
            >
              <option value="">Day</option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                <option key={day} value={day.toString().padStart(2, "0")}>{day}</option>
              ))}
            </select>
          </div>
          {fieldError?.field === 'dob' && (
            <p id={FIELD_ERROR_ID.dob} role="alert" className="mt-1.5 text-xs text-error">
              {fieldError.message}
            </p>
          )}
        </div>

        {/* Terms + Privacy Checkbox — merged into one */}
        <div className="flex items-start gap-2.5 pt-1">
          <input
            id="reg-agreeToTerms"
            name="agreeToTerms"
            type="checkbox"
            checked={formData.agreeToTerms}
            onChange={handleChange}
            required
            aria-invalid={fieldError?.field === 'agreeToTerms' || undefined}
            aria-describedby={fieldError?.field === 'agreeToTerms' ? FIELD_ERROR_ID.agreeToTerms : undefined}
            className="mt-0.5 w-4 h-4 accent-primary flex-shrink-0 cursor-pointer"
          />
          <label htmlFor="reg-agreeToTerms" className="text-xs text-foreground-subtle leading-relaxed cursor-pointer">
            I agree to the{' '}
            <Link href="/terms" target="_blank" className="text-primary hover:text-primary-hover font-semibold">Terms of Service</Link>
            {' '}and{' '}
            <Link href="/privacy" target="_blank" className="text-primary hover:text-primary-hover font-semibold">Privacy Policy</Link>
          </label>
        </div>
        {fieldError?.field === 'agreeToTerms' && (
          <p id={FIELD_ERROR_ID.agreeToTerms} role="alert" className="text-xs text-error -mt-2">
            {fieldError.message}
          </p>
        )}

        {/* Age confirmation */}
        <div className="flex items-start gap-2.5">
          <input
            id="reg-confirmAge"
            name="confirmAge"
            type="checkbox"
            checked={formData.confirmAge}
            onChange={handleChange}
            required
            aria-invalid={fieldError?.field === 'confirmAge' || undefined}
            aria-describedby={fieldError?.field === 'confirmAge' ? FIELD_ERROR_ID.confirmAge : undefined}
            className="mt-0.5 w-4 h-4 accent-primary flex-shrink-0 cursor-pointer"
          />
          <label htmlFor="reg-confirmAge" className="text-xs text-foreground-subtle leading-relaxed cursor-pointer">
            I confirm I am at least 18 years old
          </label>
        </div>
        {fieldError?.field === 'confirmAge' && (
          <p id={FIELD_ERROR_ID.confirmAge} role="alert" className="text-xs text-error -mt-2">
            {fieldError.message}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading || isSendingCode}
          className="auth-cta w-full mt-2"
        >
          {isSendingCode ? (
            <span className="inline-flex items-center gap-2"><Loader2 size={18} className="animate-spin" />Sending code...</span>
          ) : (
            "Send Verification Code"  // This should be a React fragment, but keeping it simple
          )}
        </button>
      </form>

      {/* Sign In — subtle text link, Tinder/Bumble style */}
      <p className="text-center mt-6 text-sm text-foreground-subtle">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-primary hover:text-primary-hover font-medium transition-colors"
        >
          Sign In
        </Link>
      </p>
    </div>
  );
}
