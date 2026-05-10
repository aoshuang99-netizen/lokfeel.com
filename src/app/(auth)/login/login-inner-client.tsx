"use client";

/**
 * LoginInnerClient — Cool Blue V2 Glassmorphism
 * Seamless visual transition from landing page (same video bg + overlay)
 * Retains all OAuth functionality (Google GIS, X OAuth 2.0)
 *
 * Fixes:
 * - Brand: LokFee! (not LokFeel)
 * - Social login: vertical stack (Google top, X bottom) for mobile
 * - Removed duplicate content with Register page
 * - PC layout optimized (440px card, better padding)
 */

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";

// Use NextAuth Google OAuth redirect flow
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
          setError("Security verification failed. Please try again.");
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

  // ─── Cool Blue Glass Styles ───
  const inputBaseStyle: React.CSSProperties = {
    width: "100%",
    padding: "14px 18px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "12px",
    fontSize: "15px",
    color: "#fff",
    fontFamily: "'Inter', -apple-system, sans-serif",
    outline: "none",
    transition: "all 0.2s",
    boxSizing: "border-box",
  };

  const inputFocusStyle: React.CSSProperties = {
    ...inputBaseStyle,
    borderColor: "#3b82f6",
    background: "rgba(59,130,246,0.1)",
    boxShadow: "0 0 0 3px rgba(59,130,246,0.2)",
  };

  return (
    <div style={{ width: "100%", maxWidth: "440px" }}>
      {/* Glassmorphism Login Card */}
      <div
        style={{
          background: "rgba(15,15,35,0.78)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: "24px",
          border: "1px solid rgba(255,255,255,0.16)",
          padding: "44px 40px",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.4)",
        }}
      >
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
          <button
            type="button"
            onClick={() => {
              window.location.href = `/api/auth/twitter/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
            }}
            disabled={isLoading}
            style={{
              padding: "13px 16px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.13)",
              borderRadius: "12px",
              color: isLoading ? "rgba(255,255,255,0.5)" : "#fff",
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
                e.currentTarget.style.background = "rgba(255,255,255,0.13)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.13)";
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Continue with X
          </button>
        </div>

        {/* Divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            margin: "0 0 20px",
            gap: "14px",
          }}
        >
          <div
            style={{
              flex: 1,
              height: "1px",
              background: "rgba(255,255,255,0.15)",
            }}
          />
          <span
            style={{
              fontSize: "13px",
              color: "rgba(255,255,255,0.5)",
              whiteSpace: "nowrap",
            }}
          >
            or continue with email
          </span>
          <div
            style={{
              flex: 1,
              height: "1px",
              background: "rgba(255,255,255,0.15)",
            }}
          />
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
              style={inputBaseStyle}
              onFocus={(e) =>
                Object.assign(e.target.style, {
                  borderColor: "#3b82f6",
                  background: "rgba(59,130,246,0.1)",
                  boxShadow: "0 0 0 3px rgba(59,130,246,0.2)",
                })
              }
              onBlur={(e) =>
                Object.assign(e.target.style, {
                  borderColor: "rgba(255,255,255,0.15)",
                  background: "rgba(255,255,255,0.08)",
                  boxShadow: "none",
                })
              }
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
                style={inputBaseStyle}
                onFocus={(e) =>
                  Object.assign(e.target.style, {
                    borderColor: "#3b82f6",
                    background: "rgba(59,130,246,0.1)",
                    boxShadow: "0 0 0 3px rgba(59,130,246,0.2)",
                  })
                }
                onBlur={(e) =>
                  Object.assign(e.target.style, {
                    borderColor: "rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.08)",
                    boxShadow: "none",
                  })
                }
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
            style={{
              width: "100%",
              padding: "15px",
              background: isLoading
                ? "rgba(59,130,246,0.5)"
                : "linear-gradient(135deg, #3b82f6, #6366f1)",
              border: "none",
              borderRadius: "12px",
              color: "#fff",
              fontSize: "16px",
              fontWeight: "600",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1,
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              fontFamily: "'Inter', sans-serif",
              boxShadow: isLoading
                ? "none"
                : "0 4px 20px rgba(59,130,246,0.35)",
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow =
                  "0 6px 25px rgba(59,130,246,0.45)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 20px rgba(59,130,246,0.35)";
            }}
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
          style={{
            display: "block",
            width: "100%",
            padding: "13px 16px",
            background: "linear-gradient(135deg, #8b5cf6, #a855f7)",
            border: "none",
            borderRadius: "12px",
            color: "#fff",
            fontSize: "15px",
            fontWeight: "600",
            textAlign: "center",
            textDecoration: "none",
            fontFamily: "'Inter', sans-serif",
            boxShadow: "0 4px 20px rgba(139,92,246,0.35)",
            transition: "all 0.2s",
            margin: "14px 0 0",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = "0 6px 25px rgba(139,92,246,0.45)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 4px 20px rgba(139,92,246,0.35)";
          }}
        >
          Create Account
        </Link>
      </div>
    </div>
  );
}
