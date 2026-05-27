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
  ArrowRight,
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
import { safeJsonParse, getAuthErrorMessage } from "@/lib/safe-json";

// X (Twitter) — Native OAuth 2.0 + PKCE redirect
import { useSearchParams } from "next/navigation";

// ─── Registration State Persistence ───
const REG_STATE_KEY = 'lokfeel_register_state';
interface RegState {
  phase: 'form' | 'verify';
  formData: Record<string, string | boolean>;
  sentInfo: { maskedIdentifier?: string; devMode?: boolean; code?: string };
  savedAt: number;
}

function saveRegState(phase: 'form' | 'verify', formData: Record<string, string | boolean>, sentInfo: any) {
  if (typeof window === 'undefined') return;
  try {
    const state: RegState = { phase, formData, sentInfo: sentInfo || {}, savedAt: Date.now() };
    localStorage.setItem(REG_STATE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

function loadRegState(): RegState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(REG_STATE_KEY);
    if (!raw) return null;
    const state: RegState = JSON.parse(raw);
    if (Date.now() - state.savedAt > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(REG_STATE_KEY);
      return null;
    }
    return state;
  } catch { return null; }
}

function clearRegState() {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(REG_STATE_KEY); } catch { /* ignore */ }
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
  const [countdown, setCountdown] = useState(0);
  const [sentInfo, setSentInfo] = useState<{ maskedIdentifier?: string; devMode?: boolean; code?: string }>({});
  const [dobYear, setDobYear] = useState("");
  const [dobMonth, setDobMonth] = useState("");
  const [dobDay, setDobDay] = useState("");

  // ─── Restore state on mount ───
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('reset')) {
      clearRegState();
      return;
    }

    const saved = loadRegState();
    if (saved && saved.phase === 'verify' && saved.formData.email) {
      setPhase('verify');
      setFormData(prev => ({ ...prev, ...saved.formData }));
      if (saved.sentInfo) setSentInfo(saved.sentInfo);
    } else if (saved && saved.phase === 'form' && saved.formData.email) {
      setFormData(prev => ({ ...prev, ...saved.formData }));
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
  };

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
  const validateForm = (): string | null => {
    if (!formData.name.trim()) return "Please enter your name";
    if (!formData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email))
      return "Please enter a valid email address";
    if (!formData.dob) return "Please enter your date of birth";
    // Check age >= 18
    const dob = new Date(formData.dob);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
    if (age < 18) return "You must be at least 18 years old";
    if (formData.password.length < 8) return "Password must be at least 8 characters";
    if (!formData.agreeToTerms) return "You must agree to the Terms of Service and Privacy Policy";
    if (!formData.confirmAge) return "You must confirm you are at least 18 years old";
    return null;
  };

  const handleSendCode = async () => {
    const validationError = validateForm();
    if (validationError) { setError(validationError); return; }

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
              window.location.href = data.redirectTo || "/dashboard/onboarding";
              return;
            }
          }
        } catch (error) {
          console.error("Auto-login failed:", error);
        }
      }

      clearRegState();
      router.push("/login?registered=true");
    } catch (err: any) {
      setError(err.message || "Verification failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

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
            <span className="text-2xl font-bold font-display text-foreground">Lok<span className="text-primary">Fee!</span></span>
          </div>
          <h1 className="text-2xl font-bold text-foreground font-display mb-2">Verify Your Email</h1>
          <p className="text-sm text-foreground-muted">
            We sent a 6-digit code to{' '}
            <span className="text-foreground font-medium">{sentInfo.maskedIdentifier || formData.email}</span>
          </p>
        </div>

        {/* Dev mode code display */}
        {sentInfo.devMode && (
          <div className="mb-4 p-3 rounded-xl bg-primary-muted border border-primary/20 text-sm text-primary">
            Dev mode: code sent — check server console
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-error-muted border border-error/20 text-sm text-error">
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
          <span className="text-2xl font-bold font-display text-foreground">Lok<span className="text-primary">Fee!</span></span>
        </div>
        <h1 className="text-2xl font-bold text-foreground font-display mb-2">Join LokFeel!</h1>
        <p className="text-sm text-foreground-muted">Start your journey to meaningful connection</p>
      </div>

      {/* ─── SOCIAL LOGIN — VERTICAL STACK (Google top, X bottom) ─── */}
      <div className="flex flex-col gap-2.5 mb-5">
        {/* Google — GIS with FedCM */}
        <GoogleSignInButton
          callbackUrl="/dashboard/onboarding"
          disabled={isLoading}
          label="Continue with Google"
        />

        {/* X (Twitter) — Native OAuth 2.0 + PKCE */}
        <button
          type="button"
          onClick={() => { window.location.href = `/api/auth/twitter/signin?callbackUrl=${encodeURIComponent("/dashboard/onboarding")}`; }}
          disabled={isLoading}
          className="auth-social-btn w-full"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
          </svg>
          Continue with X
        </button>

        {/* Twitter error */}
        {error && error.includes("X") && (
          <div className="mt-2 p-2.5 rounded-lg bg-error-muted border border-error/20 text-xs text-error">
            {error}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="auth-divider mb-5">
        <span>or continue with email</span>
      </div>

      {/* Error (non-Twitter) */}
      {error && !error.includes("X") && (
        <div className="mb-4 p-3 rounded-xl bg-error-muted border border-error/20 text-sm text-error">
          {error}
        </div>
      )}

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
            className="auth-input w-full"
          />
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
            className="auth-input w-full"
          />
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
            className="auth-input w-full"
          />
        </div>

        {/* Date of Birth — 3 dropdowns */}
        <div className="form-group">
          <label
            htmlFor="dob-year"
            className="block text-sm font-medium text-foreground-muted mb-2"
          >
            <Calendar size={13} className="inline mr-1.5 align-middle" />Date of Birth <span className="text-error">*</span>
          </label>
          <div className="grid grid-cols-3 gap-2.5">
            <select
              id="dob-year"
              value={dobYear}
              onChange={(e) => setDobYear(e.target.value)}
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
              value={dobMonth}
              onChange={(e) => setDobMonth(e.target.value)}
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
              value={dobDay}
              onChange={(e) => setDobDay(e.target.value)}
              required
              className="auth-input !py-3 !px-3"
            >
              <option value="">Day</option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                <option key={day} value={day.toString().padStart(2, "0")}>{day}</option>
              ))}
            </select>
          </div>
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
            className="mt-0.5 w-4 h-4 accent-primary flex-shrink-0 cursor-pointer"
          />
          <label htmlFor="reg-agreeToTerms" className="text-xs text-foreground-subtle leading-relaxed cursor-pointer">
            I agree to the{' '}
            <Link href="/terms" target="_blank" className="text-primary hover:text-primary-hover font-semibold">Terms of Service</Link>
            {' '}and{' '}
            <Link href="/privacy" target="_blank" className="text-primary hover:text-primary-hover font-semibold">Privacy Policy</Link>
          </label>
        </div>

        {/* Age confirmation */}
        <div className="flex items-start gap-2.5">
          <input
            id="reg-confirmAge"
            name="confirmAge"
            type="checkbox"
            checked={formData.confirmAge}
            onChange={handleChange}
            required
            className="mt-0.5 w-4 h-4 accent-primary flex-shrink-0 cursor-pointer"
          />
          <label htmlFor="reg-confirmAge" className="text-xs text-foreground-subtle leading-relaxed cursor-pointer">
            I confirm I am at least 18 years old
          </label>
        </div>

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
