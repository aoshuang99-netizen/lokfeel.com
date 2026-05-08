"use client";

/**
 * RegisterPage — Feeld-style single-page registration
 * DATEASY DARK: Unified with landing page
 *
 * Changes from original:
 * - Merged 2-step into 1 page with inline OTP
 * - Removed confirmPassword field
 * - Social login (Google/Discord) promoted ABOVE email form
 * - Feeld-style progress indicator
 * - DOB field added
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

// ─── DATEASY DARK THEME CONSTANTS ───────────────────────────────
const colors = {
  bg: "#0a0a0a",
  cardBg: "#111111",
  border: "rgba(76, 29, 149, 0.15)",
  borderStrong: "rgba(76, 29, 149, 0.3)",
  text: "#ffffff",
  textMuted: "rgba(255,255,255,0.40)",
  textSecondary: "rgba(255,255,255,0.65)",
  input: "rgba(26, 26, 26, 0.8)",
  inputBorder: "rgba(85, 85, 85, 0.3)",
  inputFocus: "rgba(76, 29, 149, 0.5)",
  inputPlaceholder: "rgba(255,255,255,0.25)",
  primary: "#a3e635",
  primaryBg: "#a3e635",
  primaryText: "#0a0a0a",
  purple: "#a78bfa",
  purpleBg: "rgba(76, 29, 149, 0.08)",
  error: "#fb7185",
  errorBg: "rgba(251,113,133,0.08)",
  errorBorder: "rgba(251,113,133,0.2)",
};

// ─── Registration State Persistence ───
const REG_STATE_KEY = 'lokfeel_register_state';
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

// ─── OAuth Providers ───
const oauthProviders = [
  {
    provider: "google" as const,
    label: "Continue with Google",
    svg: <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>,
  },
  {
    provider: "discord" as const,
    label: "Continue with Discord",
    svg: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#5865F2"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>,
  },
];

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
          gender: "woman",
          sexuality: "straight",
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
          gender: "woman",
          sexuality: "straight",
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

  const handleOAuthRegister = async (provider: "google" | "discord") => {
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
    borderColor: colors.inputFocus,
    boxShadow: "0 0 0 3px rgba(76, 29, 149, 0.15)",
  };

  // ─── Progress Indicator (Feeld-style) ───
  const progressPercent = phase === "form" ? 60 : 95;

  // ══════════════════════════════════════
  // VERIFY PHASE
  // ══════════════════════════════════════
  if (phase === "verify") {
    return (
      <div style={{
        maxWidth: "420px",
        margin: "0 auto",
        padding: "32px 24px",
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
          padding: "40px 32px",
        }}>
          {/* Progress bar */}
          <div style={{ marginBottom: "32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "12px", color: colors.textMuted, fontWeight: "500" }}>Almost there</span>
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

          <div className="text-center" style={{ marginBottom: "32px" }}>
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", marginBottom: "24px" }}>
              <div style={{
                width: "48px", height: "48px", borderRadius: "14px",
                background: "linear-gradient(135deg, #4c1d95, #8b5cf6)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
              </div>
              <span style={{ fontSize: "24px", fontWeight: "bold", color: colors.text, fontFamily: "'Outfit', sans-serif" }}>LokFeel</span>
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
              background: isLoading ? "rgba(163,230,53,0.5)" : colors.primaryBg,
              border: "none", borderRadius: "12px",
              color: colors.primaryText, fontSize: "16px", fontWeight: "600",
              cursor: isLoading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              marginBottom: "12px", fontFamily: "'Outfit', sans-serif",
              boxShadow: isLoading ? "none" : "0 0 20px -5px rgba(163, 230, 53, 0.3)",
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

  // ══════════════════════════════════════
  // FORM PHASE — Feeld-style single page
  // ══════════════════════════════════════
  return (
    <div style={{
      maxWidth: "420px",
      margin: "0 auto",
      padding: "32px 24px",
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
        padding: "40px 32px",
      }}>
        {/* Progress bar */}
        <div style={{ marginBottom: "28px" }}>
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

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", marginBottom: "20px" }}>
            <div style={{
              width: "48px", height: "48px", borderRadius: "14px",
              background: "linear-gradient(135deg, #4c1d95, #8b5cf6)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </div>
            <span style={{ fontSize: "24px", fontWeight: "bold", color: colors.text, fontFamily: "'Outfit', sans-serif" }}>LokFeel</span>
          </div>
          <h1 style={{ fontSize: "22px", fontWeight: "700", color: colors.text, marginBottom: "6px", fontFamily: "'Outfit', sans-serif" }}>
            Join LokFeel
          </h1>
          <p style={{ color: colors.textMuted, fontSize: "14px" }}>
            Start your journey to meaningful connection
          </p>
        </div>

        {/* ─── SOCIAL LOGIN — PROMINENT, ABOVE FORM ─── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "24px" }}>
          {oauthProviders.map(({ provider, label, svg }) => (
            <button
              key={provider}
              onClick={() => handleOAuthRegister(provider)}
              disabled={isLoading}
              style={{
                padding: "13px 16px",
                background: "rgba(26, 26, 26, 0.9)",
                border: `1px solid ${colors.inputBorder}`,
                borderRadius: "12px",
                color: colors.text,
                fontSize: "14px",
                fontWeight: "500",
                cursor: isLoading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                opacity: isLoading ? 0.5 : 1,
                transition: "all 0.2s",
                fontFamily: "'Outfit', sans-serif",
              }}
              onMouseEnter={(e) => { if (!isLoading) e.currentTarget.style.borderColor = colors.borderStrong; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = colors.inputBorder; }}
            >
              {svg}
              <span style={{ fontSize: "13px" }}>{label}</span>
            </button>
          ))}
        </div>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "24px", color: colors.textMuted, fontSize: "12px" }}>
          <div style={{ flex: 1, height: "1px", background: colors.border }} />
          or continue with email
          <div style={{ flex: 1, height: "1px", background: colors.border }} />
        </div>

        {/* Error */}
        {error && (
          <div style={{ marginBottom: "20px", padding: "12px 16px", borderRadius: "12px", background: colors.errorBg, border: `1px solid ${colors.errorBorder}`, color: colors.error, fontSize: "14px" }}>
            {error}
          </div>
        )}

        {/* ─── EMAIL FORM ─── */}
        <form onSubmit={(e) => { e.preventDefault(); handleSendCode(); }} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* Name */}
          <div>
            <label htmlFor="reg-name" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "500", color: colors.textSecondary, marginBottom: "6px" }}>
              <User size={13} /> Full Name <span style={{ color: colors.error }}>*</span>
            </label>
            <input
              id="reg-name" name="name" type="text"
              value={formData.name} onChange={handleChange}
              autoComplete="name" required placeholder="Your name"
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
                autoComplete="email" required placeholder="you@example.com"
                style={inputStyle("14px 16px 14px 40px")}
                onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                onBlur={(e) => { e.target.style.borderColor = colors.inputBorder; e.target.style.boxShadow = "none"; }}
              />
              <Mail size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: colors.inputPlaceholder, pointerEvents: "none" }} />
            </div>
          </div>

          {/* Date of Birth */}
          <div>
            <label htmlFor="reg-dob" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "500", color: colors.textSecondary, marginBottom: "6px" }}>
              <Calendar size={13} /> Date of Birth <span style={{ color: colors.error }}>*</span>
            </label>
            <input
              id="reg-dob" name="dob" type="date"
              value={formData.dob} onChange={handleChange}
              required
              max={new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
              style={{
                ...inputStyle(),
                colorScheme: "dark",
              }}
              onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
              onBlur={(e) => { e.target.style.borderColor = colors.inputBorder; e.target.style.boxShadow = "none"; }}
            />
          </div>

          {/* Password — NO confirmPassword */}
          <div>
            <label htmlFor="reg-password" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "500", color: colors.textSecondary, marginBottom: "6px" }}>
              <Lock size={13} /> Password <span style={{ color: colors.error }}>*</span>
            </label>
            <input
              id="reg-password" name="password" type="password"
              value={formData.password} onChange={handleChange}
              autoComplete="new-password" minLength={8} required placeholder="Min 8 characters"
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
              background: isSendingCode ? "rgba(163,230,53,0.5)" : colors.primaryBg,
              border: "none", borderRadius: "12px",
              color: colors.primaryText, fontSize: "16px", fontWeight: "600",
              cursor: isSendingCode ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              marginTop: "4px", fontFamily: "'Outfit', sans-serif",
              boxShadow: isSendingCode ? "none" : "0 0 20px -5px rgba(163, 230, 53, 0.3)",
            }}
          >
            {isSendingCode ? (
              <><Loader2 size={18} className="animate-spin" />Sending code...</>
            ) : (
              <>Send Verification Code <ArrowRight size={18} /></>
            )}
          </button>
        </form>

        {/* Already have account */}
        <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: `1px solid ${colors.border}`, textAlign: "center" }}>
          <p style={{ color: colors.textMuted, fontSize: "14px" }}>
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
