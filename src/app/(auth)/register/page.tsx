"use client";

/**
 * RegisterPage — Feeld-style single-page registration
 * DATRASY DARK: Unified with landing page
 *
 * Changes from original:
 * - Merged 2-step into 1 page with inline OTP
 * - Removed confirmPassword field
 * - Social login (Google/X) promoted ABOVE email form
 * - Feeld-style progress indicator
 * - DOB field added
 * - Brand: LokFee! (not LokFeel)
 * - Mobile: social login vertical stack (Google top, X bottom)
 * - PC: optimized layout like a real app
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

// Use NextAuth Google OAuth redirect flow — most reliable, no JS SDK needed
import GoogleSignInButton from "@/components/auth/google-sign-in-button";

// X (Twitter) — Native OAuth 2.0 + PKCE redirect (bypasses Firebase)
// Redirects to /api/auth/twitter/signin → Twitter authorize → callback → auto-sign-in

// ─── COOL BLUE V2 THEME CONSTANTS ─────────────────────────────
const colors = {
  bg: "transparent", // video bg from layout
  cardBg: "rgba(15,15,35,0.80)",
  border: "rgba(255,255,255,0.18)",
  borderStrong: "rgba(96,165,250,0.5)",
  text: "#ffffff",
  textMuted: "rgba(255,255,255,0.40)",
  textSecondary: "rgba(255,255,255,0.65)",
  input: "rgba(255,255,255,0.08)",
  inputBorder: "rgba(255,255,255,0.15)",
  inputFocus: "rgba(59,130,246,0.5)",
  inputPlaceholder: "rgba(255,255,255,0.4)",
  primary: "#3b82f6",
  primaryBg: "#3b82f6",
  primaryText: "#ffffff",
  purple: "#60a5fa",
  purpleBg: "rgba(59,130,246,0.1)",
  error: "#fb7185",
  errorBg: "rgba(251,113,133,0.08)",
  errorBorder: "rgba(251,113,133,0.2)",
};

// ─── Registration State Persistence ───
const REG_STATE_KEY = 'lokfee_register_state';
interface RegState {
  phase: string; // 'form' | 'verify'
  formData: Record<string, string | boolean>;
  sentInfo: { maskedIdentifier?: string; devMode?: boolean; code?: string };
  savedAt: number;
}

function saveRegState(phase: string, formData: Record<string, string | boolean>, sentInfo: any) {
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
  const [phase, setPhase] = useState<"form" | "verify">("form");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    dob: "",       // Date of Birth — new field
    gender: "",
    sexuality: "",
    agreeToTerms: false,
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
      setFormData((prev) => ({ ...prev, dob: dateStr }));
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
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const startCountdown = () => {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((prev) => {
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
    if (!formData.agreeToTerms) return "Please agree to the Terms of Service";
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

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to send verification code");

      setSentInfo({
        maskedIdentifier: data.maskedIdentifier,
        devMode: data.devMode,
        code: data.code,
      });

      setPhase("verify");
      startCountdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to resend");
      if (data.devMode) setSentInfo(prev => ({ ...prev, code: data.code }));
      startCountdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
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

      const data = await res.json();
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
            const signInResult = await signIn("credentials", {
              email: formData.email.toLowerCase().trim(),
              password: formData.password,
              redirect: false,
            });

            if ((signInResult as any)?.ok || (signInResult as any)?.url) {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuthRegister = async (provider: "google" | "twitter") => {
    setIsLoading(true);
    try {
      await signIn(provider, { callbackUrl: "/dashboard/onboarding" });
    } catch {
      setError("Failed to sign in. Please try again.");
      setIsLoading(false);
    }
  };

  // ─── Shared Styles ───
  const inputStyle = (extraPadding?: string): React.CSSProperties => ({
    width: "100%",
    padding: extraPadding || "14px 16px",
    background: colors.input,
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: "12px",
    color: colors.text,
    fontSize: "15px",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.2s, box-shadow 0.2s",
  });

  const inputFocusStyle: React.CSSProperties = {
    borderColor: "rgba(59,130,246,0.5)",
    boxShadow: "0 0 0 3px rgba(59,130,246,0.2)",
  };

  const selectStyle: React.CSSProperties = {
    width: "100%",
    padding: "13px 10px",
    background: colors.input,
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: "10px",
    fontSize: "15px",
    color: colors.text,
    fontFamily: "'Inter', sans-serif",
    appearance: "none",
    WebkitAppearance: "none" as any,
    cursor: "pointer",
    textAlign: "center",
    outline: "none",
    transition: "border-color 0.2s, box-shadow 0.2s",
  };

  const selectFocusStyle: React.CSSProperties = {
    borderColor: "rgba(59,130,246,0.5)",
    boxShadow: "0 0 0 3px rgba(59,130,246,0.2)",
  };

  // ─── Progress Indicator (Feeld-style) ───
  const progressPercent = phase === "form" ? 60 : 95;

  // ═════════════════════════════════════
  // VERIFY PHASE
  // ═════════════════════════════════════
  if (phase === "verify") {
    return (
      <div style={{
        maxWidth: "440px",
        margin: "0 auto",
        padding: "24px 16px",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}>
        <div style={{
          background: colors.cardBg,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: "24px",
          border: `1px solid ${colors.border}`,
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.4)",
          padding: "40px 36px",
        }}>
          {/* Progress bar */}
          <div style={{ marginBottom: "28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "12px", color: colors.textMuted, fontWeight: "500" }}>Almost there</span>
              <span style={{ fontSize: "12px", color: colors.primary, fontWeight: "600" }}>{progressPercent}%</span>
            </div>
            <div style={{ height: "3px", background: "rgba(255,255,255,0.06)", borderRadius: "4px", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                background: `linear-gradient(90deg, #3b82f6, #60a5fa)`,
                borderRadius: "4px",
                transition: "width 0.5s ease",
                width: `${progressPercent}%`,
              }} />
            </div>
          </div>

          <div className="text-center" style={{ marginBottom: "28px" }}>
            {/* Logo - Brand: LokFee! */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "20px" }}>
              <div style={{
                width: "44px", height: "44px", borderRadius: "12px",
                background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
              </div>
              <span style={{ fontSize: "22px", fontWeight: "bold", color: colors.text, fontFamily: "'Outfit', sans-serif" }}>Lok<span style={{ color: "#60a5fa" }}>Fee!</span></span>
            </div>
            <h1 style={{ fontSize: "22px", fontWeight: "700", color: colors.text, marginBottom: "8px", fontFamily: "'Outfit', sans-serif" }}>
              Verify Your Email
            </h1>
            <p style={{ color: colors.textMuted, fontSize: "14px" }}>
              We sent a 6-digit code to{' '}
              <span style={{ color: colors.text, fontWeight: "500" }}>{sentInfo.maskedIdentifier || formData.email}</span>
            </p>

            {sentInfo.devMode && (
              <div style={{ marginTop: "12px", padding: "8px 12px", borderRadius: "8px", background: colors.purpleBg, border: `1px solid ${colors.borderStrong}` }}>
                <p style={{ color: colors.textMuted, fontSize: "11px" }}>
                  Dev mode: code sent — check server console
                </p>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{ marginBottom: "24px", padding: "12px 16px", borderRadius: "12px", background: colors.errorBg, border: `1px solid ${colors.errorBorder}`, color: colors.error, fontSize: "14px" }}>
              {error}
            </div>
          )}

          {/* Code inputs */}
          <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginBottom: "24px" }}>
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
                onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                onBlur={(e) => { e.target.style.borderColor = colors.inputBorder; e.target.style.boxShadow = "none"; }}
                style={{
                  width: "48px", height: "56px", textAlign: "center", fontSize: "22px", fontWeight: "700",
                  background: colors.input, border: `1px solid ${colors.inputBorder}`,
                  color: colors.text, outline: "none", borderRadius: "12px",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                }}
                disabled={isLoading}
                autoFocus={index === 0}
              />
            ))}
          </div>

          {/* Verify button */}
          <button
            onClick={handleVerifyAndCreate}
            disabled={isLoading}
            style={{
              width: "100%", padding: "14px",
              background: isLoading ? "rgba(59,130,246,0.5)" : "linear-gradient(135deg, #3b82f6, #6366f1)",
              border: "none", borderRadius: "12px",
              color: "#ffffff", fontSize: "16px", fontWeight: "600",
              cursor: isLoading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              marginBottom: "12px", fontFamily: "'Inter', sans-serif",
              boxShadow: isLoading ? "none" : "0 4px 20px rgba(59,130,246,0.35)",
            }}
          >
            {isLoading ? (
              <><Loader2 size={18} className="animate-spin" />Creating account...</>
            ) : (
              <><CheckCircle2 size={18} />Verify & Create Account</>
            )}
          </button>

          {/* Resend */}
          <div style={{ textAlign: "center", marginBottom: "16px" }}>
            <button
              onClick={handleResendCode}
              disabled={countdown > 0 || isSendingCode}
              style={{
                background: "none", border: "none",
                color: countdown > 0 ? colors.textMuted : colors.primary,
                fontSize: "14px", cursor: countdown > 0 || isSendingCode ? "not-allowed" : "pointer",
                opacity: countdown > 0 ? 0.5 : 1, fontWeight: "500",
              }}
            >
              {isSendingCode ? "Sending..." : countdown > 0 ? `Resend code in ${countdown}s` : "Didn't receive it? Resend"}
            </button>
          </div>

          {/* Back */}
          <button
            onClick={() => setPhase("form")}
            style={{ background: "none", border: "none", color: colors.textMuted, fontSize: "13px", cursor: "pointer", width: "100%" }}
          >
            ← Back to registration
          </button>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════
  // FORM PHASE — Feeld-style single page
  // ═════════════════════════════════════
  return (
    <div style={{
      maxWidth: "440px",
      margin: "0 auto",
      padding: "24px 16px",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
    }}>
      <div style={{
        background: colors.cardBg,
        borderRadius: "24px",
        border: `1px solid ${colors.border}`,
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        padding: "40px 36px",
      }}>
        {/* Progress bar */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", color: colors.textMuted, fontWeight: "500" }}>Create your account</span>
            <span style={{ fontSize: "12px", color: colors.primary, fontWeight: "600" }}>{progressPercent}%</span>
          </div>
          <div style={{ height: "3px", background: "rgba(255,255,255,0.06)", borderRadius: "4px", overflow: "hidden" }}>
            <div style={{
              height: "100%",
              background: `linear-gradient(90deg, #4c1d95, ${colors.primary})`,
              borderRadius: "4px",
              transition: "width 0.5s ease",
              width: `${progressPercent}%`,
            }} />
          </div>
        </div>

        {/* Header - Brand: LokFee! */}
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "16px" }}>
            <div style={{
              width: "44px", height: "44px", borderRadius: "12px",
              background: "linear-gradient(135deg, #4c1d95, #8b5cf6)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </div>
            <span style={{ fontSize: "22px", fontWeight: "bold", color: colors.text, fontFamily: "'Outfit', sans-serif" }}>Lok<span style={{ color: "#60a5fa" }}>Fee!</span></span>
          </div>
          <h1 style={{ fontSize: "20px", fontWeight: "700", color: colors.text, marginBottom: "6px", fontFamily: "'Outfit', sans-serif" }}>
            Join LokFee!
          </h1>
          <p style={{ color: colors.textMuted, fontSize: "13px" }}>
            Start your journey to meaningful connection
          </p>
        </div>

        {/* ─── SOCIAL LOGIN — VERTICAL STACK (Google top, X bottom) ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
          {/* Google — GIS (Google Identity Services) with FedCM + account chooser */}
          <GoogleSignInButton
            callbackUrl="/dashboard/onboarding"
            disabled={isLoading}
            label="Continue with Google"
          />
          {/* X (Twitter) — Native OAuth 2.0 + PKCE redirect */}
          <button
            type="button"
            onClick={() => { window.location.href = `/api/auth/twitter/signin?callbackUrl=${encodeURIComponent("/dashboard/onboarding")}`; }}
            disabled={isLoading}
            style={{
              padding: "13px 16px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "12px",
              color: isLoading ? "rgba(255,255,255,0.5)" : "#ffffff",
              fontSize: "14px",
              fontWeight: "500",
              cursor: isLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              opacity: isLoading ? 0.5 : 1,
              transition: "all 0.2s",
              fontFamily: "'Inter', sans-serif",
              width: "100%",
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                e.currentTarget.style.background = "rgba(255,255,255,0.14)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            Continue with X
          </button>
        </div>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px", color: colors.textMuted, fontSize: "12px" }}>
          <div style={{ flex: 1, height: "1px", background: colors.border }} />
          or continue with email
          <div style={{ flex: 1, height: "1px", background: colors.border }} />
        </div>

        {/* Error */}
        {error && (
          <div style={{ marginBottom: "16px", padding: "12px 16px", borderRadius: "12px", background: colors.errorBg, border: `1px solid ${colors.errorBorder}`, color: colors.error, fontSize: "14px" }}>
            {error}
          </div>
        )}

        {/* ─── EMAIL FORM ─── */}
        <form onSubmit={(e) => { e.preventDefault(); handleSendCode(); }} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* Name */}
          <div>
            <label htmlFor="reg-name" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "500", color: colors.textSecondary, marginBottom: "6px" }}>
              <User size={13} /> Name <span style={{ color: colors.error }}>*</span>
            </label>
            <input
              id="reg-name" name="name" type="text"
              value={formData.name} onChange={handleChange}
              autoComplete="name" required placeholder=" "
              style={inputStyle()}
              onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
              onBlur={(e) => { e.target.style.borderColor = colors.inputBorder; e.target.style.boxShadow = "none"; }}
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="reg-email" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "500", color: colors.textSecondary, marginBottom: "6px" }}>
              <Mail size={13} /> Email <span style={{ color: colors.error }}>*</span>
            </label>
            <div style={{ position: "relative" }}>
            <input
              id="reg-email" name="email" type="email"
              value={formData.email} onChange={handleChange}
              autoComplete="email" required placeholder=" "
              style={inputStyle("14px 16px 14px 40px")}
              onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
              onBlur={(e) => { e.target.style.borderColor = colors.inputBorder; e.target.style.boxShadow = "none"; }}
            />
              <Mail size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: colors.inputPlaceholder, pointerEvents: "none" }} />
            </div>
          </div>

          {/* Date of Birth - 3 dropdowns */}
          <div>
            <label htmlFor="dob-year" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "500", color: colors.textSecondary, marginBottom: "6px" }}>
              <Calendar size={13} /> Date of Birth <span style={{ color: colors.error }}>*</span>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
              <select
                id="dob-year" required
                value={dobYear} onChange={(e) => setDobYear(e.target.value)}
                onFocus={(e) => Object.assign(e.target.style, selectFocusStyle)}
                onBlur={(e) => { e.target.style.borderColor = colors.inputBorder; e.target.style.boxShadow = "none"; }}
                style={selectStyle}
              >
                <option value="" disabled>Year</option>
                {Array.from({ length: new Date().getFullYear() - 18 - 1920 + 1 }, (_, i) => new Date().getFullYear() - 18 - i).map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
              <select
                id="dob-month" required
                value={dobMonth} onChange={(e) => setDobMonth(e.target.value)}
                onFocus={(e) => Object.assign(e.target.style, selectFocusStyle)}
                onBlur={(e) => { e.target.style.borderColor = colors.inputBorder; e.target.style.boxShadow = "none"; }}
                style={selectStyle}
              >
                <option value="" disabled>Month</option>
                {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                  <option key={i + 1} value={(i + 1).toString().padStart(2, "0")}>{i + 1} - {m}</option>
                ))}
              </select>
              <select
                id="dob-day" required
                value={dobDay} onChange={(e) => setDobDay(e.target.value)}
                onFocus={(e) => Object.assign(e.target.style, selectFocusStyle)}
                onBlur={(e) => { e.target.style.borderColor = colors.inputBorder; e.target.style.boxShadow = "none"; }}
                style={selectStyle}
              >
                <option value="" disabled>Day</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                  <option key={day} value={day.toString().padStart(2, "0")}>{day}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Password — NO confirmPassword */}
          <div>
            <label htmlFor="reg-password" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "500", color: colors.textSecondary, marginBottom: "6px" }}>
              <Lock size={13} /> Password <span style={{ color: colors.error }}>*</span>
            </label>
            <input
              id="reg-password" name="password" type="password"
              value={formData.password} onChange={handleChange}
              autoComplete="new-password" minLength={8} required placeholder=" "
              style={inputStyle()}
              onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
              onBlur={(e) => { e.target.style.borderColor = colors.inputBorder; e.target.style.boxShadow = "none"; }}
            />
          </div>

          {/* Hidden gender/sexuality defaults */}
          <input type="hidden" name="gender" value="woman" />
          <input type="hidden" name="sexuality" value="straight" />

          {/* Terms */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", paddingTop: "4px" }}>
            <input
                id="agreeToTerms" name="agreeToTerms" type="checkbox"
                checked={formData.agreeToTerms} onChange={handleChange} required
                style={{ marginTop: "3px", width: "16px", height: "16px", borderRadius: "4px", accentColor: colors.primary, flexShrink: 0 }}
              />
              <label htmlFor="agreeToTerms" style={{ fontSize: "12px", color: colors.textMuted, lineHeight: "1.5" }}>
                I agree to the{' '}
                <Link href="/terms" style={{ color: colors.purple, textDecoration: "none", fontWeight: "500" }}>Terms</Link>
                {' '}and{' '}
                <Link href="/privacy" style={{ color: colors.purple, textDecoration: "none", fontWeight: "500" }}>Privacy Policy</Link>.
                A verification code will be sent to your email.
              </label>
          </div>

          {/* Submit */}
          <button
            type="submit" disabled={isSendingCode}
            style={{
              width: "100%", padding: "14px",
              background: isSendingCode ? "rgba(59,130,246,0.5)" : "linear-gradient(135deg, #3b82f6, #6366f1)",
              border: "none", borderRadius: "12px",
              color: "#ffffff", fontSize: "16px", fontWeight: "600",
              cursor: isSendingCode ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              marginTop: "4px", fontFamily: "'Inter', sans-serif",
              boxShadow: isSendingCode ? "none" : "0 4px 20px rgba(59,130,246,0.35)",
            }}
          >
            {isSendingCode ? (
              <><Loader2 size={18} className="animate-spin" />Sending code...</>
            ) : (
              <>Send Verification Code <ArrowRight size={18} /></>
            )}
          </button>
        </form>

        {/* Already have account — simplified, no duplication with Login page */}
        <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: `1px solid ${colors.border}`, textAlign: "center" }}>
          <p style={{ color: colors.textMuted, fontSize: "13px" }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: colors.primary, fontWeight: "600", textDecoration: "none" }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
