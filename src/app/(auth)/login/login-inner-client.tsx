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

// Lazy-load Firebase OAuth buttons to avoid Firebase SDK in initial bundle
const GoogleButton = dynamic(
  () => import("@/components/auth/firebase-oauth-button").then((mod) => {
    return function GoogleWrapped(props: any) {
      return <mod.default {...props} provider="google" />;
    };
  }),
  {
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
  }
);

const XButton = dynamic(
  () => import("@/components/auth/firebase-oauth-button").then((mod) => {
    return function XWrapped(props: any) {
      return <mod.default {...props} provider="twitter" />;
    };
  }),
  {
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
  }
);

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
          {/* Google — Firebase-powered */}
          <GoogleButton
            callbackUrl={callbackUrl}
            onError={(err) => setError(err)}
            disabled={isLoading}
          />

          {/* X (Twitter) — Firebase-powered */}
          <XButton
            callbackUrl={callbackUrl}
            onError={(err) => setError(err)}
            disabled={isLoading}
          />
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
