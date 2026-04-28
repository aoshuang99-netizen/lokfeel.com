"use client";

/**
 * ForgotPasswordClient — Client-side form for requesting password reset
 * Matches the login page design style (Light Theme + Warm Sand)
 */
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Mail } from "lucide-react";

// ─── STYLE CONSTANTS (matching login page) ───────────────────────
const colors = {
  bg: "rgba(255,255,255,0.95)",
  border: "rgba(0,0,0,0.08)",
  text: "#1a1a2e",
  textMuted: "rgba(0,0,0,0.45)",
  textSecondary: "rgba(0,0,0,0.65)",
  input: "#f8f8fc",
  inputBorder: "rgba(0,0,0,0.12)",
  inputFocus: "rgba(232, 160, 56, 0.5)",
  inputPlaceholder: "rgba(0,0,0,0.3)",
  primary: "#e8a038",
  primaryBg: "#e8a038",
  primaryText: "#fff",
  success: "#16a34a",
  successBg: "rgba(22,163,74,0.08)",
  successBorder: "rgba(22,163,74,0.2)",
  error: "#dc2626",
  errorBg: "rgba(239,68,68,0.08)",
  errorBorder: "rgba(239,68,68,0.2)",
};

type Step = "email" | "sent";

export default function ForgotPasswordClient() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<Step>("email");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [devResetUrl, setDevResetUrl] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Something went wrong");
        setIsLoading(false);
        return;
      }

      // Always show success to prevent email enumeration
      setMaskedEmail(data.maskedEmail || email.replace(/(.{2})(.*)(@.*)/, "$1***$3"));
      if (data.devResetUrl) {
        setDevResetUrl(data.devResetUrl);
      }
      setStep("sent");
    } catch (err) {
      console.error("Forgot password error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const inputStyle = (): React.CSSProperties => ({
    width: "100%",
    padding: "12px 16px 12px 44px",
    background: colors.input,
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: "12px",
    color: colors.text,
    fontSize: "15px",
    outline: "none",
    boxSizing: "border-box",
    opacity: isLoading ? 0.6 : 1,
    transition: "border-color 0.2s",
  });

  // ─── Step: Email Input ───
  if (step === "email") {
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
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}
      >
        {/* Back to Login */}
        <Link
          href="/login"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "13px",
            color: colors.textMuted,
            textDecoration: "none",
            marginBottom: "24px",
          }}
        >
          <ArrowLeft size={14} />
          Back to Sign In
        </Link>

        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              overflow: "hidden",
              background: "linear-gradient(135deg, #e8a038, #c85050)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "20px",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </div>
          <h1
            style={{
              fontSize: "24px",
              fontWeight: "bold",
              color: colors.text,
              margin: "0 0 8px",
            }}
          >
            Forgot Password?
          </h1>
          <p
            style={{
              color: colors.textMuted,
              fontSize: "14px",
              margin: 0,
              lineHeight: "1.5",
            }}
          >
            No worries. Enter your email and we&apos;ll send you a link to reset your password.
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

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          noValidate
        >
          <div>
            <label
              htmlFor="forgot-email"
              style={{
                display: "block",
                fontSize: "14px",
                fontWeight: "500",
                color: colors.textSecondary,
                marginBottom: "8px",
              }}
            >
              Email Address
            </label>
            <div style={{ position: "relative" }}>
              <Mail
                size={18}
                style={{
                  position: "absolute",
                  left: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: colors.textMuted,
                  pointerEvents: "none",
                }}
              />
              <input
                id="forgot-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                disabled={isLoading}
                placeholder="you@example.com"
                style={inputStyle()}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || !email}
            style={{
              width: "100%",
              padding: "14px",
              background: isLoading || !email ? "rgba(232,160,56,0.5)" : colors.primaryBg,
              border: "none",
              borderRadius: "12px",
              color: colors.primaryText,
              fontSize: "16px",
              fontWeight: "600",
              cursor: isLoading || !email ? "not-allowed" : "pointer",
              opacity: isLoading || !email ? 0.6 : 1,
              transition: "opacity 0.2s, background 0.2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Sending...
              </>
            ) : (
              <>Send Reset Link</>
            )}
          </button>
        </form>
      </div>
    );
  }

  // ─── Step: Confirmation ───
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
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
      }}
    >
      {/* Back to Login */}
      <Link
        href="/login"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "13px",
          color: colors.textMuted,
          textDecoration: "none",
          marginBottom: "24px",
        }}
      >
        <ArrowLeft size={14} />
        Back to Sign In
      </Link>

      {/* Success Icon */}
      <div
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "50%",
          background: colors.successBg,
          border: `2px solid ${colors.successBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 24px",
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={colors.success} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      </div>

      <h1
        style={{
          fontSize: "24px",
          fontWeight: "bold",
          color: colors.text,
          margin: "0 0 12px",
          textAlign: "center",
        }}
      >
        Check Your Email
      </h1>

      <p
        style={{
          color: colors.textMuted,
          fontSize: "14px",
          margin: "0 0 8px",
          textAlign: "center",
          lineHeight: "1.5",
        }}
      >
        We&apos;ve sent a password reset link to:
      </p>

      <p
        style={{
          color: colors.text,
          fontSize: "16px",
          fontWeight: "600",
          margin: "0 0 24px",
          textAlign: "center",
        }}
      >
        {maskedEmail}
      </p>

      <p
        style={{
          color: colors.textMuted,
          fontSize: "13px",
          margin: "0 0 24px",
          textAlign: "center",
          lineHeight: "1.5",
        }}
      >
        The link will expire in 30 minutes. If you don&apos;t see the email, check your spam folder.
      </p>

      {/* Dev mode: show reset URL directly */}
      {devResetUrl && (
        <div
          style={{
            marginBottom: "24px",
            padding: "12px 16px",
            borderRadius: "12px",
            background: "rgba(232,160,56,0.08)",
            border: "1px solid rgba(232,160,56,0.2)",
            fontSize: "13px",
          }}
        >
          <p style={{ margin: "0 0 8px", color: colors.primary, fontWeight: "600" }}>
            🛠 Dev Mode — Reset Link:
          </p>
          <a
            href={devResetUrl}
            style={{ color: colors.primary, wordBreak: "break-all" }}
          >
            {devResetUrl}
          </a>
        </div>
      )}

      <Link
        href="/login"
        style={{
          display: "block",
          width: "100%",
          padding: "14px",
          background: colors.primaryBg,
          border: "none",
          borderRadius: "12px",
          color: colors.primaryText,
          fontSize: "16px",
          fontWeight: "600",
          textAlign: "center",
          textDecoration: "none",
          transition: "opacity 0.2s",
        }}
      >
        Back to Sign In
      </Link>
    </div>
  );
}
