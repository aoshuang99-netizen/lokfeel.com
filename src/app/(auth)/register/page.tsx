"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  Mail,
  Phone,
  CheckCircle2,
} from "lucide-react";
import { signIn } from "next-auth/react";

// ─── Registration State Persistence ───
const REG_STATE_KEY = 'lokfeel_register_state';
interface RegState {
  step: string;
  formData: Record<string, string | boolean>;
  verifyMethod: string;
  sentInfo: { maskedIdentifier?: string; devMode?: boolean; code?: string };
  savedAt: number;
}

function saveRegState(step: string, formData: Record<string, string | boolean>, verifyMethod: string, sentInfo: any) {
  if (typeof window === 'undefined') return;
  try {
    const state: RegState = { step, formData, verifyMethod, sentInfo: sentInfo || {}, savedAt: Date.now() };
    localStorage.setItem(REG_STATE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

function loadRegState(): RegState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(REG_STATE_KEY);
    if (!raw) return null;
    const state: RegState = JSON.parse(raw);
    // Expire after 24 hours
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

const genderOptions = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "non-binary", label: "Non-binary" },
  { value: "other", label: "Other" },
];

const sexualityOptions = [
  { value: "straight", label: "Straight" },
  { value: "gay", label: "Gay" },
  { value: "lesbian", label: "Lesbian" },
  { value: "bisexual", label: "Bisexual" },
  { value: "pansexual", label: "Pansexual" },
  { value: "queer", label: "Queer" },
  { value: "asexual", label: "Asexual" },
  { value: "questioning", label: "Questioning" },
];

const countryCodes = [
  { code: "+1", country: "US/CA", flag: "🇺🇸" },
  { code: "+44", country: "UK", flag: "🇬🇧" },
  { code: "+86", country: "China", flag: "🇨🇳" },
  { code: "+81", country: "Japan", flag: "🇯🇵" },
  { code: "+82", country: "Korea", flag: "🇰🇷" },
  { code: "+61", country: "Australia", flag: "🇦🇺" },
  { code: "+49", country: "Germany", flag: "🇩🇪" },
  { code: "+33", country: "France", flag: "🇫🇷" },
  { code: "+39", country: "Italy", flag: "🇮🇹" },
  { code: "+55", country: "Brazil", flag: "🇧🇷" },
  { code: "+91", country: "India", flag: "🇮🇳" },
  { code: "+852", country: "HK", flag: "🇭🇰" },
  { code: "+886", country: "Taiwan", flag: "🇹🇼" },
  { code: "+65", country: "Singapore", flag: "🇸🇬" },
];

// Only Google + Discord OAuth providers
const oauthProviders = [
  { provider: "google" as const, label: "Google", svg: <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> },
  { provider: "discord" as const, label: "Discord", svg: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg> },
];

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<"info" | "verify">("info");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    gender: "",
    sexuality: "",
    phone: "",
    countryCode: "+1",
    agreeToTerms: false,
  });
  // Verification method: 'email' or 'sms'
  const [verifyMethod, setVerifyMethod] = useState<"email" | "sms">("email");
  const [verificationCode, setVerificationCode] = useState(["", "", "", "", "", ""]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [sentInfo, setSentInfo] = useState<{ maskedIdentifier?: string; devMode?: boolean; code?: string }>({});
  const [restoredFromSession, setRestoredFromSession] = useState(false);

  // ─── Restore registration state on mount ───
  useEffect(() => {
    const saved = loadRegState();
    if (saved && saved.step === 'verify' && saved.formData.email) {
      // Restore to verify step
      setStep('verify');
      setFormData(prev => ({ ...prev, ...saved.formData }));
      setVerifyMethod(saved.verifyMethod as any);
      if (saved.sentInfo) setSentInfo(saved.sentInfo);
      setRestoredFromSession(true);
    } else if (saved && saved.step === 'info' && saved.formData.email) {
      // Restore to info step (user was filling form)
      setFormData(prev => ({ ...prev, ...saved.formData }));
      setVerifyMethod(saved.verifyMethod as any);
      setRestoredFromSession(true);
    }
  }, []);

  // Auto-save on state changes
  const saveState = useCallback(() => {
    saveRegState(step, formData as any, verifyMethod, sentInfo);
  }, [step, formData, verifyMethod, sentInfo]);

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
      setError("Please enter a valid email address (always required)");
      return;
    }
    if (verifyMethod === "sms" && (!formData.phone || formData.phone.length < 7)) {
      setError("Please enter a valid phone number for SMS verification");
      return;
    }
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
          verifyMethod,
          phone: formData.phone,
          countryCode: formData.countryCode,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to send verification code");
      }

      setSentInfo({
        maskedIdentifier: data.maskedIdentifier,
        devMode: data.devMode,
        code: data.code, // In dev mode, the actual code is returned
      });

      // Proceed to verification step
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
          phone: formData.phone,
          verifyMethod,
          name: formData.name,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to resend");
      
      // Update sentInfo with new code (for dev mode display)
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
    // Auto-submit when all 6 digits are entered
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
          verifyMethod,
          phone: formData.phone,
          countryCode: formData.countryCode,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Registration failed");
      }

      // Auto login after successful registration using the auto-login token
      if (data.autoLoginToken) {
        try {
          // Exchange auto-login token for session
          const autoLoginRes = await fetch("/api/auth/auto-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: data.autoLoginToken,
              email: formData.email,
            }),
          });

          if (autoLoginRes.ok) {
            // Now sign in with credentials
            const signInResult = await signIn("credentials", {
              email: formData.email,
              password: formData.password,
              redirect: false,
            });

            if ((signInResult as any)?.ok) {
              // Clear persisted state — registration complete!
              clearRegState();
              // Redirect to onboarding or dashboard
              router.push(data.redirectTo || "/dashboard/onboarding");
              return;
            }
          }
        } catch (error) {
          console.error("Auto-login failed:", error);
        }
      }

      // Fallback: redirect to login if auto-login failed
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
  // VERIFICATION STEP
  // ══════════════════════════════════════
  if (step === "verify") {
    return (
      <div className="glass-card p-8 max-w-md w-full">
        <div className="text-center mb-8">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #f43f5e 0%, #9333ea 50%, #f59e0b 100%)' }}>
              <div className="w-full h-full flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
              </div>
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-amber-400 bg-clip-text text-transparent">
              LokFeel
            </span>
          </div>

          <h1 className="text-2xl font-bold text-white mb-2">Verify Your Identity</h1>
          <p className="text-white/60 text-sm">
            We sent a 6-digit code to{' '}
            <span className="text-white font-medium">{sentInfo.maskedIdentifier || (verifyMethod === 'email' ? formData.email : `${formData.countryCode} ${formData.phone}`)}</span>
          </p>

          {sentInfo.devMode && (
            <div className="mt-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <p className="text-amber-300 text-xs mb-2 font-medium">⚠️ Dev Mode — Email service not configured</p>
              <p className="text-white/60 text-xs mb-2">Your verification code is:</p>
              <div className="flex items-center justify-center gap-3">
                {sentInfo.code && sentInfo.code.split('').map((digit, i) => (
                  <span key={i} className="w-10 h-12 flex items-center justify-center bg-amber-500/20 border border-amber-500/40 rounded-lg text-2xl font-bold text-amber-300 font-mono">
                    {digit}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (sentInfo.code) {
                    navigator.clipboard.writeText(sentInfo.code);
                  }
                }}
                className="mt-3 w-full text-xs text-white/50 hover:text-amber-300 transition-colors"
              >
                📋 Click to copy code
              </button>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-error/20 border border-error/30 text-error text-sm">
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
              className="w-12 h-14 text-center text-2xl font-bold bg-white/5 border border-white/10 rounded-xl text-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-transparent"
              disabled={isLoading}
              autoFocus={index === 0}
            />
          ))}
        </div>

        {/* Verify button */}
        <button
          onClick={handleVerifyAndCreate}
          disabled={isLoading}
          className="btn-primary w-full mb-4"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating account...
            </span>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Verify & Create Account
            </>
          )}
        </button>

        {/* Resend */}
        <div className="text-center mb-4">
          <button
            onClick={handleResendCode}
            disabled={countdown > 0 || isSendingCode}
            className="text-sm text-white/60 hover:text-primary transition-colors disabled:opacity-50"
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
          className="w-full text-sm text-white/40 hover:text-white/60 transition-colors"
        >
          ← Back to registration
        </button>
      </div>
    );
  }

  // ══════════════════════════════════════
  // REGISTRATION INFO STEP
  // ══════════════════════════════════════
  return (
    <div className="glass-card p-8 max-h-[90vh] overflow-y-auto max-w-md w-full">
      <div className="text-center mb-8">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #f43f5e 0%, #9333ea 50%, #f59e0b 100%)' }}>
            <div className="w-full h-full flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </div>
          </div>
          <span className="text-2xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-amber-400 bg-clip-text text-transparent">
            LokFeel
          </span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Create Your Account</h1>
        <p className="text-white/60 text-sm">Start your journey to meaningful connection</p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-error/20 border border-error/30 text-error text-sm">
          {error}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); handleSendCode(); }} className="space-y-4 mb-6">
        {/* Name — fixed placeholder, no autocomplete interference */}
        <div>
          <label htmlFor="reg-name" className="block text-sm font-medium text-white/80 mb-2">
            Full Name <span className="text-primary">*</span>
          </label>
          <input
            id="reg-name"
            name="name"
            type="text"
            value={formData.name}
            onChange={handleChange}
            placeholder=""
            autoComplete="name"
            className="input-feeld"
            required
          />
        </div>

        {/* Email (always required) */}
        <div>
          <label htmlFor="reg-email" className="block text-sm font-medium text-white/80 mb-2">
            Email <span className="text-primary">*</span>
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              id="reg-email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder=""
              autoComplete="email"
              className="input-feeld pl-10"
              required
            />
          </div>
        </div>

        {/* ─── Verification Method Selector ─── */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            Verify with <span className="text-primary">*</span> (choose one)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setVerifyMethod('email')}
              className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${
                verifyMethod === 'email'
                  ? 'border-primary bg-primary/10 text-white'
                  : 'border-white/10 bg-white/5 text-white/60 hover:border-white/30'
              }`}
            >
              <Mail className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm font-medium">Email</span>
              {verifyMethod === 'email' && (
                <CheckCircle2 className="w-4 h-4 ml-auto text-primary flex-shrink-0" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setVerifyMethod('sms')}
              className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${
                verifyMethod === 'sms'
                  ? 'border-primary bg-primary/10 text-white'
                  : 'border-white/10 bg-white/5 text-white/60 hover:border-white/30'
              }`}
            >
              <Phone className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm font-medium">SMS</span>
              {verifyMethod === 'sms' && (
                <CheckCircle2 className="w-4 h-4 ml-auto text-primary flex-shrink-0" />
              )}
            </button>
          </div>
        </div>

        {/* Phone (only shown when SMS selected) */}
        {verifyMethod === "sms" && (
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Code
              </label>
              <select
                name="countryCode"
                value={formData.countryCode}
                onChange={handleChange}
                className="input-feeld appearance-none text-sm"
                style={{ colorScheme: 'dark' }}
              >
                {countryCodes.map((cc) => (
                  <option key={cc.code} value={cc.code}>
                    {cc.flag} {cc.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="reg-phone" className="block text-sm font-medium text-white/80 mb-2">
                Phone Number
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  id="reg-phone"
                  name="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder=""
                  autoComplete="tel"
                  className="input-feeld pl-10"
                />
              </div>
            </div>
          </div>
        )}

        {/* Gender & Sexuality */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="reg-gender" className="block text-sm font-medium text-white/80 mb-2">
              I am a <span className="text-primary">*</span>
            </label>
            <select
              id="reg-gender"
              name="gender"
              value={formData.gender}
              onChange={handleChange}
              className="input-feeld appearance-none"
              style={{ colorScheme: 'dark' }}
              required
            >
              <option value="">Choose...</option>
              {genderOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="reg-sexuality" className="block text-sm font-medium text-white/80 mb-2">
              Interested in <span className="text-primary">*</span>
            </label>
            <select
              id="reg-sexuality"
              name="sexuality"
              value={formData.sexuality}
              onChange={handleChange}
              className="input-feeld appearance-none"
              style={{ colorScheme: 'dark' }}
              required
            >
              <option value="">Choose...</option>
              {sexualityOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Password */}
        <div>
          <label htmlFor="reg-password" className="block text-sm font-medium text-white/80 mb-2">
            Password <span className="text-primary">*</span>
          </label>
          <input
            id="reg-password"
            name="password"
            type="password"
            value={formData.password}
            onChange={handleChange}
            placeholder=""
            autoComplete="new-password"
            className="input-feeld"
            minLength={8}
            required
          />
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="reg-confirm-pwd" className="block text-sm font-medium text-white/80 mb-2">
            Confirm Password <span className="text-primary">*</span>
          </label>
          <input
            id="reg-confirm-pwd"
            name="confirmPassword"
            type="password"
            value={formData.confirmPassword}
            onChange={handleChange}
            placeholder=""
            autoComplete="new-password"
            className="input-feeld"
            required
          />
        </div>

        {/* Terms */}
        <div className="flex items-start gap-3 pt-2">
          <input
            id="agreeToTerms"
            name="agreeToTerms"
            type="checkbox"
            checked={formData.agreeToTerms}
            onChange={handleChange}
            className="mt-1 w-4 h-4 rounded border-white/20 bg-white/5 text-primary focus:ring-primary"
          />
          <label htmlFor="agreeToTerms" className="text-sm text-white/60 leading-relaxed">
            I agree to the{" "}
            <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>
            {" "}and{" "}
            <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
            LokFeel will send a verification code to{" "}
            <span className="text-white font-medium">
              {verifyMethod === 'email' ? 'your email address' : 'your phone'}
            </span>.
          </label>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isSendingCode}
          className="btn-primary w-full mt-4"
        >
          {isSendingCode ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Sending code...
            </span>
          ) : (
            <>
              Send Verification Code
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </button>
      </form>

      {/* Divider + OAuth (Google + Discord only) */}
      <div className="divider my-6"><span>or sign up with</span></div>

      <div className="grid grid-cols-2 gap-3">
        {oauthProviders.map(({ provider, label, svg }) => (
          <button
            key={provider}
            onClick={() => handleOAuthRegister(provider)}
            disabled={isLoading}
            className="btn-secondary flex items-center justify-center gap-2"
          >
            {svg}
            {label}
          </button>
        ))}
      </div>

      <p className="text-center text-white/60 mt-8 text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-primary hover:underline font-medium">
          Sign in
        </Link>
      </p>
    </div>
  );
}
