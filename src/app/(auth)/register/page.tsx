"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  Mail,
  CheckCircle2,
} from "lucide-react";
import { signIn } from "next-auth/react";

// ─── MINIMAL BLACK & WHITE STYLE CONSTANTS ───────────────────────────────
const colors = {
  bg: "rgba(255,255,255,0.03)",
  border: "rgba(255,255,255,0.08)",
  text: "#fff",
  textMuted: "rgba(255,255,255,0.5)",
  textSecondary: "rgba(255,255,255,0.7)",
  input: "rgba(255,255,255,0.05)",
  inputBorder: "rgba(255,255,255,0.1)",
  inputFocus: "rgba(255,255,255,0.3)",
  primary: "#fff", // Black & white: white primary
  primaryBg: "#fff",
  primaryText: "#000",
  card: "rgba(255,255,255,0.03)",
  cardBorder: "rgba(255,255,255,0.08)",
  error: "#fca5a5",
  errorBg: "rgba(239,68,68,0.1)",
  errorBorder: "rgba(239,68,68,0.2)",
};

// ─── Registration State Persistence ───
const REG_STATE_KEY = 'lokfeel_register_state';
interface RegState {
  step: string;
  formData: Record<string, string | boolean>;
  sentInfo: { maskedIdentifier?: string; devMode?: boolean; code?: string };
  savedAt: number;
}

function saveRegState(step: string, formData: Record<string, string | boolean>, sentInfo: any) {
  if (typeof window === 'undefined') return;
  try {
    const state: RegState = { step, formData, sentInfo: sentInfo || {}, savedAt: Date.now() };
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

// ─── Gender & Sexuality Options (Simplified) ───
const genderOptions = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "non-binary", label: "Non-binary" },
];

const sexualityOptions = [
  { value: "straight", label: "Straight" },
  { value: "gay", label: "Gay" },
  { value: "lesbian", label: "Lesbian" },
  { value: "bisexual", label: "Bisexual" },
  { value: "pansexual", label: "Pansexual" },
  { value: "queer", label: "Queer" },
  { value: "demisexual", label: "Demisexual" },
  { value: "questioning", label: "Not sure" },
];

// Only Google + Discord OAuth providers
const oauthProviders = [
  { provider: "google" as const, label: "Google", svg: <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> },
  { provider: "discord" as const, label: "Discord", svg: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg> },
];

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<"info" | "verify">("info");
  // ─── SIMPLIFIED FORM: Only name, email, password, gender, sexuality ───
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
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

  // ─── Restore registration state on mount ───
  useEffect(() => {
    // Check for reset parameter in URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('reset')) {
      clearRegState();
      return;
    }
    
    const saved = loadRegState();
    if (saved && saved.step === 'verify' && saved.formData.email) {
      setStep('verify');
      setFormData(prev => ({ ...prev, ...saved.formData }));
      if (saved.sentInfo) setSentInfo(saved.sentInfo);
    } else if (saved && saved.step === 'info' && saved.formData.email) {
      setFormData(prev => ({ ...prev, ...saved.formData }));
    }
  }, []);

  // Auto-save on state changes
  const saveState = useCallback(() => {
    saveRegState(step, formData as any, sentInfo);
  }, [step, formData, sentInfo]);

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

  const handleSendCode = async () => {
    if (!formData.name) { setError("Please enter your name"); return; }
    if (!formData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setError("Please enter a valid email address");
      return;
    }
    if (!formData.gender) { setError("Please select your gender"); return; }
    if (!formData.sexuality) { setError("Please select who you're interested in"); return; }
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!formData.agreeToTerms) {
      setError("Please agree to the Terms of Service");
      return;
    }

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
          gender: formData.gender,
          sexuality: formData.sexuality,
          verifyMethod: "email",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to send verification code");
      }

      setSentInfo({
        maskedIdentifier: data.maskedIdentifier,
        devMode: data.devMode,
        code: data.code,
      });

      setStep("verify");
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
        body: JSON.stringify({
          email: formData.email,
          name: formData.name,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to resend");
      
      if (data.devMode) {
        setSentInfo(prev => ({ ...prev, code: data.code }));
      }
      
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
      const nextInput = document.getElementById(`code-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !verificationCode[index] && index > 0) {
      const prevInput = document.getElementById(`code-${index - 1}`);
      prevInput?.focus();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      handleVerifyAndCreate();
    }
  };

  const handleVerifyAndCreate = async () => {
    const code = verificationCode.join("");
    if (code.length !== 6) {
      setError("Please enter the complete 6-digit code");
      return;
    }

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
          gender: formData.gender,
          sexuality: formData.sexuality,
          code,
          verifyMethod: "email",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Registration failed");
      }

      if (data.autoLoginToken) {
        try {
          const autoLoginRes = await fetch("/api/auth/auto-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: data.autoLoginToken,
              email: formData.email,
            }),
          });

          if (autoLoginRes.ok) {
            const signInResult = await signIn("credentials", {
              email: formData.email,
              password: formData.password,
              redirect: false,
            });

            if ((signInResult as any)?.ok) {
              clearRegState();
              // Use window.location for full page reload to ensure session is set
              window.location.href = data.redirectTo || "/dashboard/onboarding";
              return;
            }
          }
        } catch (error) {
          console.error("Auto-login failed:", error);
        }
      }

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

  // ══════════════════════════════════════
  // VERIFICATION STEP - Black & White Style
  // ══════════════════════════════════════
  if (step === "verify") {
    return (
      <div style={{
        maxWidth: "420px",
        margin: "0 auto",
        padding: "40px 32px",
        background: colors.bg,
        backdropFilter: "blur(20px)",
        borderRadius: "24px",
        border: `1px solid ${colors.border}`,
      }}>
        <div className="text-center mb-8">
          {/* Logo - Black & White */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-black flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </div>
            <span style={{ fontSize: "24px", fontWeight: "bold", color: colors.text }}>LokFeel</span>
          </div>

          <h1 style={{ fontSize: "24px", fontWeight: "bold", color: colors.text, marginBottom: "8px" }}>
            Verify Your Email
          </h1>
          <p style={{ color: colors.textMuted, fontSize: "14px" }}>
            We sent a 6-digit code to{' '}
            <span style={{ color: colors.text, fontWeight: "500" }}>{sentInfo.maskedIdentifier || formData.email}</span>
          </p>

          {sentInfo.devMode && (
            <div className="mt-4 p-4 rounded-xl" style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${colors.border}` }}>
              <p style={{ color: colors.textMuted, fontSize: "12px", marginBottom: "8px" }}>Dev Mode — Your verification code:</p>
              <div className="flex items-center justify-center gap-2">
                {sentInfo.code && sentInfo.code.split('').map((digit, i) => (
                  <span key={i} className="w-10 h-12 flex items-center justify-center rounded-lg text-2xl font-bold font-mono" 
                    style={{ background: "rgba(255,255,255,0.1)", color: colors.text, border: `1px solid ${colors.border}` }}>
                    {digit}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => sentInfo.code && navigator.clipboard.writeText(sentInfo.code)}
                className="mt-3 text-xs transition-colors cursor-pointer"
                style={{ color: colors.textMuted, background: "none", border: "none" }}
              >
                Click to copy
              </button>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-xl" style={{ background: colors.errorBg, border: `1px solid ${colors.errorBorder}`, color: colors.error, fontSize: "14px" }}>
            {error}
          </div>
        )}

        {/* Code inputs */}
        <div className="flex justify-center gap-3 mb-6">
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
              className="w-12 h-14 text-center text-2xl font-bold rounded-xl"
              style={{ 
                background: colors.input, 
                border: `1px solid ${colors.inputBorder}`, 
                color: colors.text,
                outline: "none",
              }}
              disabled={isLoading}
              autoFocus={index === 0}
            />
          ))}
        </div>

        {/* Verify button - Black & White */}
        <button
          onClick={handleVerifyAndCreate}
          disabled={isLoading}
          style={{
            width: "100%",
            padding: "14px",
            background: isLoading ? "rgba(255,255,255,0.3)" : colors.primaryBg,
            border: "none",
            borderRadius: "12px",
            color: colors.primaryText,
            fontSize: "16px",
            fontWeight: "600",
            cursor: isLoading ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            marginBottom: "16px",
          }}
        >
          {isLoading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Creating account...
            </>
          ) : (
            <>
              <CheckCircle2 size={18} />
              Verify & Create Account
            </>
          )}
        </button>

        {/* Resend */}
        <div className="text-center mb-4">
          <button
            onClick={handleResendCode}
            disabled={countdown > 0 || isSendingCode}
            style={{
              background: "none",
              border: "none",
              color: countdown > 0 ? colors.textMuted : colors.text,
              fontSize: "14px",
              cursor: countdown > 0 || isSendingCode ? "not-allowed" : "pointer",
              opacity: countdown > 0 ? 0.5 : 1,
            }}
          >
            {isSendingCode
              ? "Sending..."
              : countdown > 0
              ? `Resend code in ${countdown}s`
              : "Didn't receive it? Resend"}
          </button>
        </div>

        {/* Back */}
        <button
          onClick={() => setStep("info")}
          className="w-full text-sm transition-colors cursor-pointer"
          style={{ background: "none", border: "none", color: colors.textMuted }}
        >
          ← Back to registration
        </button>
      </div>
    );
  }

  // ══════════════════════════════════════
  // REGISTRATION INFO STEP - Black & White Style, Simplified Form
  // ══════════════════════════════════════
  return (
    <div style={{
      maxWidth: "420px",
      margin: "0 auto",
      padding: "40px 32px",
      background: colors.bg,
      backdropFilter: "blur(20px)",
      borderRadius: "24px",
      border: `1px solid ${colors.border}`,
      maxHeight: "90vh",
      overflowY: "auto",
    }}>
      <div className="text-center mb-8">
        {/* Logo - Black & White */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-black flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          </div>
          <span style={{ fontSize: "24px", fontWeight: "bold", color: colors.text }}>LokFeel</span>
        </div>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", color: colors.text, marginBottom: "8px" }}>
          Create Your Account
        </h1>
        <p style={{ color: colors.textMuted, fontSize: "14px" }}>
          Start your journey to meaningful connection
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl" style={{ background: colors.errorBg, border: `1px solid ${colors.errorBorder}`, color: colors.error, fontSize: "14px" }}>
          {error}
        </div>
      )}

      {/* ─── SIMPLIFIED FORM ─── */}
      <form onSubmit={(e) => { e.preventDefault(); handleSendCode(); }} style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "24px" }}>
        {/* Name */}
        <div>
          <label htmlFor="reg-name" style={{ display: "block", fontSize: "14px", fontWeight: "500", color: colors.textSecondary, marginBottom: "8px" }}>
            Full Name <span style={{ color: colors.error }}>*</span>
          </label>
          <input
            id="reg-name"
            name="name"
            type="text"
            value={formData.name}
            onChange={handleChange}
            autoComplete="name"
            required
            style={{
              width: "100%",
              padding: "12px 16px",
              background: colors.input,
              border: `1px solid ${colors.inputBorder}`,
              borderRadius: "12px",
              color: colors.text,
              fontSize: "15px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Email */}
        <div>
          <label htmlFor="reg-email" style={{ display: "block", fontSize: "14px", fontWeight: "500", color: colors.textSecondary, marginBottom: "8px" }}>
            Email <span style={{ color: colors.error }}>*</span>
          </label>
          <div style={{ position: "relative" }}>
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(255,255,255,0.3)" }} />
            <input
              id="reg-email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              autoComplete="email"
              required
              style={{
                width: "100%",
                padding: "12px 16px 12px 40px",
                background: colors.input,
                border: `1px solid ${colors.inputBorder}`,
                borderRadius: "12px",
                color: colors.text,
                fontSize: "15px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        {/* Gender & Sexuality - Side by side */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <label htmlFor="reg-gender" style={{ display: "block", fontSize: "14px", fontWeight: "500", color: colors.textSecondary, marginBottom: "8px" }}>
              I am <span style={{ color: colors.error }}>*</span>
            </label>
            <select
              id="reg-gender"
              name="gender"
              value={formData.gender}
              onChange={handleChange}
              required
              style={{
                width: "100%",
                padding: "12px 16px",
                background: colors.input,
                border: `1px solid ${colors.inputBorder}`,
                borderRadius: "12px",
                color: colors.text,
                fontSize: "14px",
                outline: "none",
                boxSizing: "border-box",
                colorScheme: "dark",
              }}
            >
              <option value="" style={{ color: "rgba(255,255,255,0.3)" }}>Choose...</option>
              {genderOptions.map((opt) => (
                <option key={opt.value} value={opt.value} style={{ color: colors.text }}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="reg-sexuality" style={{ display: "block", fontSize: "14px", fontWeight: "500", color: colors.textSecondary, marginBottom: "8px" }}>
              Interested in <span style={{ color: colors.error }}>*</span>
            </label>
            <select
              id="reg-sexuality"
              name="sexuality"
              value={formData.sexuality}
              onChange={handleChange}
              required
              style={{
                width: "100%",
                padding: "12px 16px",
                background: colors.input,
                border: `1px solid ${colors.inputBorder}`,
                borderRadius: "12px",
                color: colors.text,
                fontSize: "14px",
                outline: "none",
                boxSizing: "border-box",
                colorScheme: "dark",
              }}
            >
              <option value="" style={{ color: "rgba(255,255,255,0.3)" }}>Choose...</option>
              {sexualityOptions.map((opt) => (
                <option key={opt.value} value={opt.value} style={{ color: colors.text }}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Password */}
        <div>
          <label htmlFor="reg-password" style={{ display: "block", fontSize: "14px", fontWeight: "500", color: colors.textSecondary, marginBottom: "8px" }}>
            Password <span style={{ color: colors.error }}>*</span>
          </label>
          <input
            id="reg-password"
            name="password"
            type="password"
            value={formData.password}
            onChange={handleChange}
            autoComplete="new-password"
            minLength={8}
            required
            style={{
              width: "100%",
              padding: "12px 16px",
              background: colors.input,
              border: `1px solid ${colors.inputBorder}`,
              borderRadius: "12px",
              color: colors.text,
              fontSize: "15px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="reg-confirm-pwd" style={{ display: "block", fontSize: "14px", fontWeight: "500", color: colors.textSecondary, marginBottom: "8px" }}>
            Confirm Password <span style={{ color: colors.error }}>*</span>
          </label>
          <input
            id="reg-confirm-pwd"
            name="confirmPassword"
            type="password"
            value={formData.confirmPassword}
            onChange={handleChange}
            autoComplete="new-password"
            required
            style={{
              width: "100%",
              padding: "12px 16px",
              background: colors.input,
              border: `1px solid ${colors.inputBorder}`,
              borderRadius: "12px",
              color: colors.text,
              fontSize: "15px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Terms - Compact */}
        <div className="flex items-start gap-3 pt-2">
          <input
            id="agreeToTerms"
            name="agreeToTerms"
            type="checkbox"
            checked={formData.agreeToTerms}
            onChange={handleChange}
            required
            style={{
              marginTop: "2px",
              width: "16px",
              height: "16px",
              borderRadius: "4px",
              accentColor: colors.text,
            }}
          />
          <label htmlFor="agreeToTerms" style={{ fontSize: "13px", color: colors.textMuted, lineHeight: "1.5" }}>
            I agree to the{" "}
            <Link href="/terms" style={{ color: colors.text, textDecoration: "underline" }}>Terms</Link>
            {" "}and{" "}
            <Link href="/privacy" style={{ color: colors.text, textDecoration: "underline" }}>Privacy Policy</Link>.
            A verification code will be sent to your email.
          </label>
        </div>

        {/* Submit Button - Black & White */}
        <button
          type="submit"
          disabled={isSendingCode}
          style={{
            width: "100%",
            padding: "14px",
            background: isSendingCode ? "rgba(255,255,255,0.3)" : colors.primaryBg,
            border: "none",
            borderRadius: "12px",
            color: colors.primaryText,
            fontSize: "16px",
            fontWeight: "600",
            cursor: isSendingCode ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            marginTop: "8px",
          }}
        >
          {isSendingCode ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Sending code...
            </>
          ) : (
            <>
              Send Verification Code
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", margin: "24px 0", color: colors.textMuted, fontSize: "13px" }}>
        <div style={{ flex: 1, height: "1px", background: colors.border }} />
        or sign up with
        <div style={{ flex: 1, height: "1px", background: colors.border }} />
      </div>

      {/* OAuth Buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        {oauthProviders.map(({ provider, label, svg }) => (
          <button
            key={provider}
            onClick={() => handleOAuthRegister(provider)}
            disabled={isLoading}
            style={{
              padding: "12px 16px",
              background: colors.input,
              border: `1px solid ${colors.inputBorder}`,
              borderRadius: "12px",
              color: colors.text,
              fontSize: "14px",
              cursor: isLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            {svg}
            {label}
          </button>
        ))}
      </div>

      {/* ─── Already have account link (ENHANCED) ─── */}
      <div className="mt-8 pt-6" style={{ borderTop: `1px solid ${colors.border}` }}>
        <p style={{ textAlign: "center", color: colors.textMuted, fontSize: "14px" }}>
          Already have an account?{" "}
          <Link 
            href="/login" 
            style={{ 
              color: colors.text, 
              fontWeight: "600",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
            }}
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
