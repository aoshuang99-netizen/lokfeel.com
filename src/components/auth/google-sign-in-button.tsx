"use client";

/**
 * GoogleSignInButton v9 — Custom PKCE Signin (Maximum Reliability)
 *
 * ARCHITECTURE:
 * - Directly navigates to /api/auth/google/signin which generates our own PKCE
 * - Our custom PKCE stores code_verifier as plain-text cookie (readable by callback)
 * - This bypasses NextAuth's JWE-encrypted PKCE which breaks the token exchange
 *
 * WHY v9 instead of v8 (POST to NextAuth):
 * - v8 POSTed to /api/auth/signin/google which used NextAuth's PKCE
 * - NextAuth v5 stores code_verifier as JWE-encrypted cookie
 * - Our custom callback cannot decrypt the JWE, so token exchange fails
 * - v9 uses our own /api/auth/google/signin with plain-text PKCE cookies
 *
 * HISTORY:
 * v5 (May 9): signIn("google") — WORKED ✅
 * v6 (May 12): window.location.href — BROKEN (custom callback + PKCE mismatch) ❌
 * v7 (May 12): Back to signIn("google") — broke for users behind GFW ❌
 * v8 (May 12): Manual POST to /api/auth/signin/google — JWE PKCE issue ❌
 * v9 (May 13): Direct navigation to /api/auth/google/signin — OWN PKCE ✅
 */

import { useState, useCallback, useRef, useEffect } from "react";

// DATEASY DARK theme constants
const colors = {
  bg: "rgba(26, 26, 26, 0.9)",
  bgHover: "rgba(26, 26, 26, 1)",
  border: "rgba(85, 85, 85, 0.3)",
  borderHover: "rgba(76, 29, 149, 0.4)",
  text: "#ffffff",
  textLoading: "rgba(255,255,255,0.5)",
  error: "#f87171",
  errorBg: "rgba(248, 113, 113, 0.1)",
};

interface GoogleSignInButtonProps {
  callbackUrl?: string;
  label?: string;
  disabled?: boolean;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

export default function GoogleSignInButton({
  callbackUrl = "/dashboard",
  label = "Continue with Google",
  disabled = false,
  onSuccess,
  onError,
}: GoogleSignInButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleClick = useCallback(async () => {
    if (isLoading || disabled) return;
    setIsLoading(true);
    setError(null);

    try {
      // Navigate directly to our custom Google signin endpoint
      // This generates our own PKCE with plain-text code_verifier cookie
      window.location.href = `/api/auth/google/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    } catch (err: any) {
      const msg = err?.message || "Network error. Please check your connection and try again.";
      setError(msg);
      onError?.(msg);
      console.error("[GoogleSignIn] Error:", err);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [isLoading, disabled, callbackUrl, onError]);

  return (
    <div style={{ width: "100%" }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading || disabled}
        style={{
          width: "100%",
          padding: "13px 16px",
          background: isLoading || disabled ? "rgba(26, 26, 26, 0.5)" : colors.bg,
          border: `1px solid ${isLoading || disabled ? "rgba(85,85,85,0.15)" : colors.border}`,
          borderRadius: "12px",
          color: isLoading ? colors.textLoading : colors.text,
          fontSize: "14px",
          fontWeight: "500",
          cursor: isLoading || disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          opacity: isLoading || disabled ? 0.6 : 1,
          transition: "all 0.2s ease",
          fontFamily: "'Outfit', sans-serif",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          if (!isLoading && !disabled) {
            e.currentTarget.style.borderColor = colors.borderHover;
            e.currentTarget.style.background = colors.bgHover;
          }
        }}
        onMouseLeave={(e) => {
          if (!isLoading && !disabled) {
            e.currentTarget.style.borderColor = colors.border;
            e.currentTarget.style.background = colors.bg;
          }
        }}
      >
        <GoogleIcon />
        {isLoading ? "Redirecting to Google..." : label}
      </button>
      {error && (
        <div
          style={{
            marginTop: "8px",
            padding: "10px 14px",
            borderRadius: "10px",
            background: colors.errorBg,
            border: `1px solid rgba(248, 113, 113, 0.2)`,
            color: colors.error,
            fontSize: "13px",
            lineHeight: "1.4",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
