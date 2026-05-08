"use client";

/**
 * LoginInnerClient — Feeld-style login
 * DATEASY DARK: Social auth promoted above email form
 * Unified visual language with register page
 */

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Eye, EyeOff, Loader2, Mail, Lock } from "lucide-react";
import dynamic from "next/dynamic";

// Lazy-load GoogleOneTap to avoid Firebase SDK in initial bundle
const GoogleOneTap = dynamic(() => import("@/components/auth/google-one-tap"), {
  ssr: false,
  loading: () => (
    <button type="button" disabled style={{
      padding: "13px 16px", background: "rgba(26, 26, 26, 0.9)",
      border: "1px solid rgba(85, 85, 85, 0.3)", borderRadius: "12px",
      color: "rgba(255,255,255,0.5)", fontSize: "14px", fontWeight: "500",
      cursor: "not-allowed", display: "flex", alignItems: "center",
      justifyContent: "center", gap: "8px", width: "100%",
      fontFamily: "'Outfit', sans-serif",
    }}>
      Loading...
    </button>
  ),
});

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

interface Props {
  callbackUrl: string;
  errorMessage: string;
}

export default function LoginInnerClient({
  callbackUrl,
  errorMessage: initialError,
}: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // ─── Form Submit ───
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();

      if (!csrfToken) {
        setError("Security check failed. Please refresh and try again.");
        setIsLoading(false);
        return;
      }

      const formData = new FormData();
      formData.append("email", email.toLowerCase().trim());
      formData.append("password", password);
      formData.append("csrfToken", csrfToken);
      formData.append("callbackUrl", callbackUrl || "/dashboard");

      const res = await fetch("/api/auth/callback/credentials", {
        method: "POST",
        body: formData,
      });

      const location = res.headers.get("location") || "";
      let redirectUrl = location || callbackUrl || "/dashboard";

      if (location.includes("error=")) {
        const errorCode = new URL(redirectUrl, window.location.origin).searchParams.get("error");
        if (errorCode === "CredentialsSignin") {
          setError("Invalid email or password.");
        } else if (errorCode === "MissingCSRF") {
          setError("Security check failed. Please refresh and try again.");
        } else {
          setError("Sign in failed. Please try again.");
        }
        setIsLoading(false);
        return;
      }

      window.location.href = redirectUrl;
    } catch (err) {
      console.error("[Login] Error:", err);
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  // ─── OAuth handlers ───
  const handleOAuth = async (provider: string) => {
    try {
      await signIn(provider as any, { callbackUrl });
    } catch (err) {
      console.error(`[OAuth] ${provider} failed:`, err);
      window.location.href = `/api/auth/signin/${provider}`;
    }
  };

  // ─── Focus styles ───
  const inputFocusStyle: React.CSSProperties = {
    borderColor: colors.inputFocus,
    boxShadow: "0 0 0 3px rgba(76, 29, 149, 0.15)",
  };

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
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", marginBottom: "20px" }}>
            {/* Logo */}
            <div style={{
              width: "48px", height: "48px", borderRadius: "14px",
              background: "linear-gradient(135deg, #4c1d95, #8b5cf6)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </div>
            <span style={{ fontSize: "24px", fontWeight: "bold", color: colors.text, fontFamily: "'Outfit', sans-serif" }}>
              LokFeel
            </span>
          </div>
          <h1 style={{ fontSize: "22px", fontWeight: "700", color: colors.text, margin: "0 0 6px", fontFamily: "'Outfit', sans-serif" }}>
            Welcome Back
          </h1>
          <p style={{ color: colors.textMuted, fontSize: "14px", margin: 0 }}>
            Sign in to continue
          </p>
        </div>

        {/* ─── SOCIAL LOGIN — PROMINENT, ABOVE FORM ─── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "24px" }}>
          {/* Google — Firebase-powered One Tap */}
          <GoogleOneTap
            callbackUrl={callbackUrl}
            onError={(err) => setError(err)}
            disabled={isLoading}
          />

          {/* Discord */}
          <button
            type="button"
            onClick={() => handleOAuth("discord")}
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#5865F2">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
            Continue with Discord
          </button>
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

        {/* LOGIN FORM */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }} noValidate>
          {/* Email */}
          <div>
            <label htmlFor="login-email" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "500", color: colors.textSecondary, marginBottom: "6px" }}>
              <Mail size={13} /> Email
            </label>
            <input
              id="login-email" name="email" type="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              required autoComplete="email" autoFocus disabled={isLoading}
              placeholder="you@example.com"
              style={{
                width: "100%", padding: "14px 16px",
                background: colors.input, border: `1px solid ${colors.inputBorder}`,
                borderRadius: "12px", color: colors.text, fontSize: "15px",
                outline: "none", boxSizing: "border-box",
                opacity: isLoading ? 0.6 : 1, transition: "border-color 0.2s, box-shadow 0.2s",
              }}
              onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
              onBlur={(e) => { e.target.style.borderColor = colors.inputBorder; e.target.style.boxShadow = "none"; }}
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="login-password" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "500", color: colors.textSecondary, marginBottom: "6px" }}>
              <Lock size={13} /> Password
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="login-password" name="password"
                type={showPassword ? "text" : "password"}
                value={password} onChange={(e) => setPassword(e.target.value)}
                required minLength={8} autoComplete="current-password" disabled={isLoading}
                placeholder="Min 8 characters"
                style={{
                  width: "100%", padding: "14px 44px 14px 16px",
                  background: colors.input, border: `1px solid ${colors.inputBorder}`,
                  borderRadius: "12px", color: colors.text, fontSize: "15px",
                  outline: "none", boxSizing: "border-box",
                  opacity: isLoading ? 0.6 : 1, transition: "border-color 0.2s, box-shadow 0.2s",
                }}
                onFocus={(e) => Object.assign(e.target.style, inputFocusStyle)}
                onBlur={(e) => { e.target.style.borderColor = colors.inputBorder; e.target.style.boxShadow = "none"; }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1} disabled={isLoading}
                style={{
                  position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer",
                  color: colors.textMuted, padding: "4px",
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Remember Me + Forgot Password */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: colors.textSecondary, cursor: "pointer" }}>
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
                style={{ width: "16px", height: "16px", borderRadius: "4px", accentColor: colors.primary }} />
              Remember me
            </label>
            <Link href="/forgot-password"
              style={{ fontSize: "13px", color: colors.purple, textDecoration: "none", fontWeight: "500" }}>
              Forgot password?
            </Link>
          </div>

          {/* Submit */}
          <button
            type="submit" disabled={isLoading}
            style={{
              width: "100%", padding: "14px",
              background: isLoading ? "rgba(163,230,53,0.5)" : colors.primaryBg,
              border: "none", borderRadius: "12px",
              color: colors.primaryText, fontSize: "16px", fontWeight: "600",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1,
              transition: "opacity 0.2s, background 0.2s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              fontFamily: "'Outfit', sans-serif",
              boxShadow: isLoading ? "none" : "0 0 20px -5px rgba(163, 230, 53, 0.3)",
            }}
          >
            {isLoading ? (
              <><Loader2 size={18} className="animate-spin" />Signing In...</>
            ) : (
              <>Sign In →</>
            )}
          </button>
        </form>

        {/* Register Link */}
        <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: `1px solid ${colors.border}`, textAlign: "center" }}>
          <p style={{ color: colors.textMuted, fontSize: "14px" }}>
            No account?{' '}
            <Link href="/register" style={{ color: colors.primary, textDecoration: "none", fontWeight: "600" }}>
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
