"use client";

/**
 * ADMIN LOGIN PAGE - Dark ERP Theme
 * Separate from user login with distinct visual identity
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Shield, Lock, User } from "lucide-react";

const colors = {
  bg: "#0a0a0f",
  card: "rgba(15, 15, 25, 0.95)",
  border: "rgba(255, 255, 255, 0.08)",
  text: "#e4e4e7",
  textMuted: "rgba(255, 255, 255, 0.45)",
  textSecondary: "rgba(255, 255, 255, 0.65)",
  input: "rgba(255, 255, 255, 0.05)",
  inputBorder: "rgba(255, 255, 255, 0.12)",
  inputFocus: "rgba(76, 29, 149, 0.5)",
  primary: "#4c1d95",
  primaryHover: "#7c3aed",
  primaryText: "#ffffff",
  error: "#ef4444",
  errorBg: "rgba(239, 68, 68, 0.1)",
  errorBorder: "rgba(239, 68, 68, 0.3)",
  success: "#22c55e",
};

interface Props {
  error?: string;
}

export default function AdminLoginPage({ error: initialError }: Props) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError || "");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // Admin credentials check (simplified for demo)
      // In production, integrate with your admin auth system
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include", // Important: send cookies
      });

      const data = await res.json();

      if (data.success) {
        router.push("/admin");
      } else {
        setError(data.error || "�û������������");
      }
    } catch (err) {
      console.error("[Admin Login] Error:", err);
      setError("����ʧ�ܣ�������");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        // Subtle grid pattern
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
        `,
        backgroundSize: "50px 50px",
      }}
    >
      {/* Decorative glow */}
      <div
        style={{
          position: "fixed",
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "600px",
          height: "400px",
          background: "radial-gradient(ellipse, rgba(76, 29, 149, 0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* Login Card */}
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          padding: "32px",
          background: colors.card,
          backdropFilter: "blur(20px)",
          borderRadius: "16px",
          border: `1px solid ${colors.border}`,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          {/* Admin Icon */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
              marginBottom: "24px",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "14px",
                background: "linear-gradient(135deg, #4c1d95, #7c3aed)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 20px rgba(76, 29, 149, 0.4)",
              }}
            >
              <Shield size={28} color="white" />
            </div>
          </div>

          <h1
            style={{
              fontSize: "22px",
              fontWeight: "bold",
              color: colors.text,
              margin: "0 0 8px",
              letterSpacing: "-0.5px",
            }}
          >
            Admin Console
          </h1>
          <p
            style={{
              color: colors.textMuted,
              fontSize: "13px",
              margin: 0,
            }}
          >
            ����Ա��¼ - ��ȫ���ʿ���ϵͳ
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            style={{
              marginBottom: "24px",
              padding: "12px 16px",
              borderRadius: "10px",
              background: colors.errorBg,
              border: `1px solid ${colors.errorBorder}`,
              color: colors.error,
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <Lock size={14} />
            {error}
          </div>
        )}

        {/* Login Form */}
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "20px" }}
        >
          {/* Username */}
          <div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                fontWeight: "500",
                color: colors.textSecondary,
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              <User size={12} />
              ����Ա�˺�
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              autoFocus
              disabled={isLoading}
              placeholder="Enter admin username"
              style={{
                width: "100%",
                padding: "12px 16px",
                background: colors.input,
                border: `1px solid ${colors.inputBorder}`,
                borderRadius: "10px",
                color: colors.text,
                fontSize: "14px",
                outline: "none",
                boxSizing: "border-box",
                opacity: isLoading ? 0.6 : 1,
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => (e.target.style.borderColor = colors.inputFocus)}
              onBlur={(e) => (e.target.style.borderColor = colors.inputBorder)}
            />
          </div>

          {/* Password */}
          <div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                fontWeight: "500",
                color: colors.textSecondary,
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              <Lock size={12} />
              ����
            </label>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="current-password"
                disabled={isLoading}
                placeholder="Enter password"
                style={{
                  width: "100%",
                  padding: "12px 44px 12px 16px",
                  background: colors.input,
                  border: `1px solid ${colors.inputBorder}`,
                  borderRadius: "10px",
                  color: colors.text,
                  fontSize: "14px",
                  outline: "none",
                  boxSizing: "border-box",
                  opacity: isLoading ? 0.6 : 1,
                  transition: "border-color 0.2s",
                }}
                onFocus={(e) => (e.target.style.borderColor = colors.inputFocus)}
                onBlur={(e) => (e.target.style.borderColor = colors.inputBorder)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
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
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: "100%",
              padding: "14px",
              background: isLoading ? "rgba(76, 29, 149, 0.5)" : colors.primary,
              border: "none",
              borderRadius: "10px",
              color: colors.primaryText,
              fontSize: "14px",
              fontWeight: "600",
              cursor: isLoading ? "not-allowed" : "pointer",
              transition: "background 0.2s, transform 0.1s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              marginTop: "8px",
            }}
            onMouseOver={(e) => {
              if (!isLoading) e.currentTarget.style.background = colors.primaryHover;
            }}
            onMouseOut={(e) => {
              if (!isLoading) e.currentTarget.style.background = colors.primary;
            }}
            onMouseDown={(e) => {
              if (!isLoading) e.currentTarget.style.transform = "scale(0.98)";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            {isLoading ? (
              <>
                <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
                ��¼��...
              </>
            ) : (
              <>
                <Shield size={18} />
                ���������̨
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div
          style={{
            marginTop: "28px",
            paddingTop: "20px",
            borderTop: `1px solid ${colors.border}`,
            textAlign: "center",
          }}
        >
          <p
            style={{
              color: colors.textMuted,
              fontSize: "12px",
              margin: 0,
            }}
          >
            ʹ�ù���Ա�˺ŵ�¼�Է��ʺ�̨ϵͳ
          </p>
        </div>
      </div>

      {/* Version Badge */}
      <div
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          padding: "8px 12px",
          background: "rgba(255, 255, 255, 0.05)",
          borderRadius: "6px",
          border: `1px solid ${colors.border}`,
          color: colors.textMuted,
          fontSize: "11px",
          fontFamily: "monospace",
        }}
      >
        v2.0.0 | ERP Console
      </div>
    </div>
  );
}
