"use client";

/**
 * GoogleSignInButton v8 — Manual POST to NextAuth (Maximum Reliability)
 *
 * ARCHITECTURE:
 * - Manually fetches CSRF token from /api/auth/csrf
 * - POSTs to /api/auth/signin/google with proper headers
 * - NextAuth returns { url: "https://accounts.google.com/..." }
 * - Browser navigates to Google OAuth page
 *
 * WHY v8 instead of signIn("google"):
 * - signIn("google") from next-auth/react internally calls getProviders()
 *   first. If getProviders() fails (network issue, CSP, etc.), signIn()
 *   silently redirects to /api/auth/error with no useful feedback.
 * - Manual POST gives us full control over error handling and can show
 *   meaningful error messages to users.
 *
 * HISTORY:
 * v5 (May 9): signIn("google") — WORKED ✅
 * v6 (May 12): window.location.href — BROKEN (custom callback + PKCE mismatch) ❌
 * v7 (May 12): Back to signIn("google") — broke for users behind GFW ❌
 * v8 (May 12): Manual POST to /api/auth/signin/google — RELIABLE ✅
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
      // Step 1: Get CSRF token (must NOT set Content-Type on GET — some ad blockers reject it)
      const csrfRes = await fetch("/api/auth/csrf", {
        method: "GET",
        credentials: "same-origin",
      });

      if (!csrfRes.ok) {
        throw new Error(`Security token request failed (${csrfRes.status}). Please disable ad blockers and try again.`);
      }

      const csrfData = await csrfRes.json();
      const { csrfToken } = csrfData;

      if (!csrfToken) {
        throw new Error("Failed to get security token. Please refresh the page.");
      }

      // Step 2: POST to NextAuth signin endpoint
      // X-Auth-Return-Redirect: 1 makes NextAuth return JSON {url} instead of redirecting
      const signInRes = await fetch("/api/auth/signin/google", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Auth-Return-Redirect": "1",
        },
        body: new URLSearchParams({
          csrfToken,
          callbackUrl,
        }),
      });

      // Check if response is JSON (X-Auth-Return-Redirect mode)
      const contentType = signInRes.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await signInRes.json();

        if (data.url) {
          // Success — redirect to Google OAuth page
          // Verify it's actually a Google URL, not an error redirect
          if (data.url.includes("accounts.google.com")) {
            window.location.href = data.url;
          } else if (data.url.includes("error=")) {
            // NextAuth returned an error URL
            const errorParam = new URL(data.url, window.location.origin).searchParams.get("error") || "";
            const errorMsg = errorParam === "Configuration"
              ? "Google login is not configured. Please contact support."
              : errorParam === "MissingCSRF"
              ? "Security verification failed. Please refresh the page and try again."
              : errorParam === "AccessDenied"
              ? "Access denied by Google. Please try again."
              : `Login failed: ${errorParam}`;
            setError(errorMsg);
            onError?.(errorMsg);
          } else {
            // Unexpected URL — try navigating anyway
            window.location.href = data.url;
          }
        } else if (data.error) {
          const errorMsg = data.error === "Configuration"
            ? "Google login is not configured. Please contact support."
            : data.error === "AccessDenied"
            ? "Access denied. Please try again."
            : `Login failed: ${data.error}`;
          setError(errorMsg);
          onError?.(errorMsg);
        } else {
          setError("Unexpected response. Please try again.");
          onError?.("Unexpected response from auth server");
        }
      } else {
        // Response is a redirect (302) — extract Location header
        const redirectUrl = signInRes.headers.get("location") || "";
        if (redirectUrl.includes("accounts.google.com")) {
          window.location.href = redirectUrl;
        } else {
          setError("Authentication service error. Please try again.");
          onError?.("Auth service returned unexpected redirect");
        }
      }
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
