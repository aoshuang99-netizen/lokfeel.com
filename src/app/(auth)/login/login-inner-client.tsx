"use client";

/**
 * LoginInnerClient — Cool Blue V2 Glassmorphism
 * Seamless visual transition from landing page (same video bg + overlay)
 * Retains all OAuth functionality (Google OAuth 2.0, X OAuth 2.0)
 */

import { useState, useCallback } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";

// Use manual POST-based Google OAuth (bypasses next-auth/react signIn issues)
import GoogleSignInButton from "@/components/auth/google-sign-in-button";

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
  const [twitterError, setTwitterError] = useState<string | null>(null);

  // ─── X (Twitter) OAuth — Manual navigation with error handling ───
  const handleTwitterSignIn = useCallback(async () => {
    setTwitterError(null);
    setIsLoading(true);
    try {
      // Use GET redirect — Twitter has its own custom handler that works via GET
      window.location.href = `/api/auth/twitter/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    } catch (err: any) {
      setTwitterError("Failed to connect to X. Please try again.");
      setIsLoading(false);
    }
  }, [callbackUrl]);

  // ─── Form Submit — Custom API login (bypasses NextAuth CSRF callback issues) ───
  // POSTs to /api/auth/login which verifies credentials server-side,
  // creates a valid NextAuth JWT session token, and returns JSON + sets cookie.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.toLowerCase().trim(),
          password,
          callbackUrl: callbackUrl || "/dashboard",
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        // Map server error messages to user-friendly text
        const msg = data.error || "Sign in failed. Please try again.";
        setError(msg);
        setIsLoading(false);
        return;
      }

      // Session cookie is already set by the server — just navigate
      window.location.href = data.redirectUrl || "/dashboard";
    } catch (err) {
      console.error("[Login] Error:", err);
      setError("Network error. Please check your connection and try again.");
      setIsLoading(false);
    }
  };

  // ─── Cool Blue Glass Styles ───
  // Using CSS classes for responsive behavior; keep minimal inline styles for dynamic states

  return (
    <div style={{ width: "100%", maxWidth: "440px" }}>
      {/* Glassmorphism Login Card — responsive padding via auth-card class */}
      <div className="auth-card">
        {/* Header — Brand: LokFee! */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <Link
            href="/"
            style={{
              fontSize: "26px",
              fontWeight: "700",
              color: "#fff",
              textDecoration: "none",
              display: "inline-block",
              marginBottom: "14px",
            }}
          >
            Lok<span style={{ color: "#60a5fa" }}>Fee!</span>
          </Link>
          <h1
            style={{
              fontSize: "26px",
              fontWeight: "700",
              margin: "0 0 8px",
              fontFamily: "'Inter', sans-serif",
            }}
          >
            Welcome Back
          </h1>
          <p style={{ color: "rgba(255,255,255,0.7)", fontSize: "14px", margin: 0 }}>
            Log in to continue your journey
          </p>
        </div>

        {/* ─── SOCIAL LOGIN — VERTICAL STACK (Google top, X bottom) ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
          {/* Google — GIS with FedCM */}
          <GoogleSignInButton
            callbackUrl={callbackUrl}
            disabled={isLoading}
            label="Continue with Google"
          />

          {/* X (Twitter) — Native OAuth 2.0 + PKCE */}
          <div style={{ width: "100%" }}>
            <button
              type="button"
              onClick={handleTwitterSignIn}
              disabled={isLoading}
              className="auth-social-btn"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Continue with X
            </button>
            {twitterError && (
              <div style={{
                marginTop: "8px",
                padding: "10px 14px",
                borderRadius: "10px",
                background: "rgba(251,113,133,0.1)",
                border: "1px solid rgba(251,113,133,0.2)",
                color: "#fb7185",
                fontSize: "13px",
              }}>
                {twitterError}
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="auth-divider">
          <span>or continue with email</span>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              marginBottom: "18px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "rgba(251,113,133,0.08)",
              border: "1px solid rgba(251,113,133,0.2)",
              color: "#fb7185",
              fontSize: "14px",
            }}
          >
            {error}
          </div>
        )}

        {/* LOGIN FORM */}
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          noValidate
        >
          {/* Email */}
          <div className="form-group">
            <label
              htmlFor="login-email"
              style={{
                display: "block",
                fontSize: "14px",
                fontWeight: "500",
                marginBottom: "8px",
                color: "rgba(255,255,255,0.9)",
              }}
            >
              Email or Phone
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
              placeholder="Enter your email or phone"
              className="auth-input"
            />
          </div>

          {/* Password */}
          <div className="form-group">
            <label
              htmlFor="login-password"
              style={{
                display: "block",
                fontSize: "14px",
                fontWeight: "500",
                marginBottom: "8px",
                color: "rgba(255,255,255,0.9)",
              }}
            >
              Password
            </label>
            <div style={{ position: "relative" }}>
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
                placeholder="Enter your password"
                className="auth-input"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                disabled={isLoading}
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "rgba(255,255,255,0.5)",
                  padding: "4px",
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Remember Me + Forgot Password */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "14px",
                color: "rgba(255,255,255,0.8)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{
                  width: "18px",
                  height: "18px",
                  accentColor: "#3b82f6",
                }}
              />
              Remember me
            </label>
            <Link
              href="/forgot-password"
              style={{
                fontSize: "14px",
                color: "#60a5fa",
                textDecoration: "none",
                fontWeight: "500",
              }}
            >
              Forgot password?
            </Link>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="auth-cta"
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Signing In...
              </>
            ) : (
              "Log In"
            )}
          </button>
        </form>

        {/* Create Account — simplified, no duplication with Register page */}
        <Link
          href="/register"
          className="auth-cta"
          style={{
            background: "linear-gradient(135deg, #8b5cf6, #a855f7)",
            boxShadow: "0 4px 20px rgba(139,92,246,0.35)",
            textDecoration: "none",
            marginTop: "14px",
          }}
        >
          Create Account
        </Link>
      </div>
    </div>
  );
}
