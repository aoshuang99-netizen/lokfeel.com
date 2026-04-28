"use client";

/**
 * ResetPasswordClient — Client-side form for setting a new password
 * Matches the login page design style (Light Theme + Warm Sand)
 */
import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2, Lock, CheckCircle2 } from "lucide-react";

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

interface Props {
  token: string;
  email: string;
}

type Step = "form" | "success";

export default function ResetPasswordClient({ token, email }: Props) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<Step>("form");

  // Password strength indicator
  const getPasswordStrength = (pwd: string): { label: string; color: string; width: string } => {
    if (!pwd) return { label: "", color: "transparent", width: "0%" };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    if (score <= 2) return { label: "Weak", color: "#ef4444", width: "33%" };
    if (score <= 3) return { label: "Medium", color: "#f59e0b", width: "66%" };
    return { label: "Strong", color: "#22c55e", width: "100%" };
  };

  const strength = getPasswordStrength(password);
  const passwordsMatch = !confirmPassword || password === confirmPassword;
  const isValid = password.length >= 8 && confirmPassword.length >= 8 && password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!isValid) {
      if (password.length < 8) {
        setError("Password must be at least 8 characters");
      } else if (!passwordsMatch) {
        setError("Passwords do not match");
      }
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password, confirmPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Failed to reset password");
        setIsLoading(false);
        return;
      }

      setStep("success");
    } catch (err) {
      console.error("Reset password error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const inputStyle = (hasRightPadding?: boolean): React.CSSProperties => ({
    width: "100%",
    padding: hasRightPadding ? "12px 44px 12px 44px" : "12px 16px 12px 44px",
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

  // ─── Step: Success ───
  if (step === "success") {
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
          <CheckCircle2 size={32} color={colors.success} />
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
          Password Reset!
        </h1>

        <p
          style={{
            color: colors.textMuted,
            fontSize: "14px",
            margin: "0 0 32px",
            textAlign: "center",
            lineHeight: "1.5",
          }}
        >
          Your password has been reset successfully. You can now sign in with your new password.
        </p>

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
          Sign In Now
        </Link>
      </div>
    );
  }

  // ─── Step: Form ───
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
        ← Back to Sign In
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
          <Lock size={24} color="white" />
        </div>
        <h1
          style={{
            fontSize: "24px",
            fontWeight: "bold",
            color: colors.text,
            margin: "0 0 8px",
          }}
        >
          Set New Password
        </h1>
        <p
          style={{
            color: colors.textMuted,
            fontSize: "14px",
            margin: 0,
            lineHeight: "1.5",
          }}
        >
          Create a new password for <strong style={{ color: colors.textSecondary }}>{email}</strong>
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
        {/* New Password */}
        <div>
          <label
            htmlFor="new-password"
            style={{
              display: "block",
              fontSize: "14px",
              fontWeight: "500",
              color: colors.textSecondary,
              marginBottom: "8px",
            }}
          >
            New Password
          </label>
          <div style={{ position: "relative" }}>
            <Lock
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
              id="new-password"
              name="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              autoFocus
              disabled={isLoading}
              placeholder="At least 8 characters"
              style={inputStyle(true)}
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
                color: colors.textMuted,
                padding: "4px",
              }}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {/* Password Strength */}
          {password && (
            <div style={{ marginTop: "8px" }}>
              <div
                style={{
                  height: "4px",
                  borderRadius: "2px",
                  background: "rgba(0,0,0,0.06)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: strength.width,
                    background: strength.color,
                    borderRadius: "2px",
                    transition: "width 0.3s, background 0.3s",
                  }}
                />
              </div>
              <p style={{ margin: "4px 0 0", fontSize: "12px", color: strength.color }}>
                {strength.label}
              </p>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label
            htmlFor="confirm-password"
            style={{
              display: "block",
              fontSize: "14px",
              fontWeight: "500",
              color: colors.textSecondary,
              marginBottom: "8px",
            }}
          >
            Confirm Password
          </label>
          <div style={{ position: "relative" }}>
            <Lock
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
              id="confirm-password"
              name="confirmPassword"
              type={showConfirm ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              disabled={isLoading}
              placeholder="Repeat your password"
              style={{
                ...inputStyle(true),
                borderColor: !passwordsMatch ? colors.error : colors.inputBorder,
              }}
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
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
                color: colors.textMuted,
                padding: "4px",
              }}
            >
              {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {!passwordsMatch && (
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: colors.error }}>
              Passwords do not match
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading || !isValid}
          style={{
            width: "100%",
            padding: "14px",
            background: isLoading || !isValid ? "rgba(232,160,56,0.5)" : colors.primaryBg,
            border: "none",
            borderRadius: "12px",
            color: colors.primaryText,
            fontSize: "16px",
            fontWeight: "600",
            cursor: isLoading || !isValid ? "not-allowed" : "pointer",
            opacity: isLoading || !isValid ? 0.6 : 1,
            transition: "opacity 0.2s, background 0.2s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            marginTop: "8px",
          }}
        >
          {isLoading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Resetting...
            </>
          ) : (
            <>Reset Password</>
          )}
        </button>
      </form>
    </div>
  );
}
