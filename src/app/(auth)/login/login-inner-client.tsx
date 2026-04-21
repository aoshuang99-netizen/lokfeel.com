"use client";

/**
 * LoginInnerClient — Client-side login UI
 * BLACK & WHITE MINIMAL STYLE
 */

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";

// ─── MINIMAL BLACK & WHITE STYLE CONSTANTS ───────────────────────────────
const colors = {
  bg: "rgba(255,255,255,0.03)",
  border: "rgba(255,255,255,0.08)",
  text: "#fff",
  textMuted: "rgba(255,255,255,0.5)",
  textSecondary: "rgba(255,255,255,0.7)",
  input: "rgba(255,255,255,0.05)",
  inputBorder: "rgba(255,255,255,0.1)",
  primary: "#fff",
  primaryBg: "#fff",
  primaryText: "#000",
  error: "#fca5a5",
  errorBg: "rgba(239,68,68,0.1)",
  errorBorder: "rgba(239,68,68,0.2)",
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

  // ─── Form Submit using signIn() ───
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = (await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl,
      })) as { error?: string | null; url?: string | null } | undefined;

      if (result?.error) {
        switch (result.error) {
          case "CredentialsSignin":
            setError("Invalid email or password.");
            break;
          case "MissingCSRF":
            setError("Security check failed. Please refresh and try again.");
            break;
          default:
            setError(`Sign in failed. Please try again.`);
        }
      } else if (result?.url) {
        window.location.href = result.url;
      }
    } catch (err) {
      console.error("[Login] Error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
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

  return (
    <div
      style={{
        maxWidth: "420px",
        margin: "0 auto",
        padding: "40px 32px",
        background: colors.bg,
        backdropFilter: "blur(20px)",
        borderRadius: "24px",
        border: `1px solid ${colors.border}`,
      }}
    >
      {/* Header - Black & White */}
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            marginBottom: "24px",
          }}
        >
          {/* Logo - Black Box */}
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              overflow: "hidden",
              background: "#000",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </div>
          <span
            style={{
              fontSize: "24px",
              fontWeight: "bold",
              color: colors.text,
            }}
          >
            LokFeel
          </span>
        </div>
        <h1
          style={{
            fontSize: "24px",
            fontWeight: "bold",
            color: colors.text,
            margin: "0 0 8px",
          }}
        >
          Welcome Back
        </h1>
        <p
          style={{
            color: colors.textMuted,
            fontSize: "14px",
            margin: 0,
          }}
        >
          Sign in to continue
        </p>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            marginBottom: "24px",
            padding: "12px 16px",
            borderRadius: "12px",
            background: colors.errorBg,
            border: `1px solid ${colors.errorBorder}`,
            color: colors.error,
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
        <div>
          <label
            htmlFor="login-email"
            style={{
              display: "block",
              fontSize: "14px",
              fontWeight: "500",
              color: colors.textSecondary,
              marginBottom: "8px",
            }}
          >
            Email
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
            disabled={isLoading}
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
              opacity: isLoading ? 0.6 : 1,
            }}
          />
        </div>

        {/* Password */}
        <div>
          <label
            htmlFor="login-password"
            style={{
              display: "block",
              fontSize: "14px",
              fontWeight: "500",
              color: colors.textSecondary,
              marginBottom: "8px",
            }}
          >
            Password
          </label>
          <div style={{ position: "relative" }}>
            <input
              id="login-password"
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="current-password"
              disabled={isLoading}
              style={{
                width: "100%",
                padding: "12px 44px 12px 16px",
                background: colors.input,
                border: `1px solid ${colors.inputBorder}`,
                borderRadius: "12px",
                color: colors.text,
                fontSize: "15px",
                outline: "none",
                boxSizing: "border-box",
                opacity: isLoading ? 0.6 : 1,
              }}
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
                color: "rgba(255,255,255,0.4)",
                padding: "4px",
              }}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Submit Button - Black & White */}
        <button
          type="submit"
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
            opacity: isLoading ? 0.6 : 1,
            transition: "opacity 0.2s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
          }}
        >
          {isLoading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Signing In...
            </>
          ) : (
            <>Sign In &rarr;</>
          )}
        </button>
      </form>

      {/* Divider */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          margin: "28px 0",
          color: colors.textMuted,
          fontSize: "13px",
        }}
      >
        <div
          style={{
            flex: 1,
            height: "1px",
            background: colors.border,
          }}
        />
        or continue with
        <div
          style={{
            flex: 1,
            height: "1px",
            background: colors.border,
          }}
        />
      </div>

      {/* OAuth Buttons (Google + Discord only) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10px",
        }}
      >
        {/* Google */}
        <button
          type="button"
          onClick={() => handleOAuth("google")}
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
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Google
        </button>

        {/* Discord */}
        <button
          type="button"
          onClick={() => handleOAuth("discord")}
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
          </svg>
          Discord
        </button>
      </div>

      {/* Register Link - ENHANCED */}
      <div className="mt-8 pt-6" style={{ borderTop: `1px solid ${colors.border}` }}>
        <p
          style={{
            textAlign: "center",
            color: colors.textMuted,
            fontSize: "14px",
          }}
        >
          No account?{" "}
          <Link
            href="/register"
            style={{
              color: colors.text,
              textDecoration: "underline",
              fontWeight: "600",
              textUnderlineOffset: "2px",
            }}
          >
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
