"use client";

/**
 * FirebaseOAuthButton — Generic Firebase OAuth popup button
 *
 * Supports: Google, Twitter/X
 * Uses Firebase Auth SDK to open a provider popup, then bridges
 * to NextAuth session via /api/auth/firebase-bridge.
 *
 * Firebase config is fetched at RUNTIME from /api/config/firebase
 * to bypass Vercel build-time env var injection issues.
 *
 * DATEASY DARK theme: matches existing login/register page styling.
 */

import { useState } from "react";
import { signIn } from "next-auth/react";
import type { Auth, GoogleAuthProvider, TwitterAuthProvider } from "firebase/auth";

// DATEASY DARK theme constants
const colors = {
  bg: "rgba(26, 26, 26, 0.9)",
  border: "rgba(85, 85, 85, 0.3)",
  borderHover: "rgba(76, 29, 149, 0.3)",
  text: "#ffffff",
  textLoading: "rgba(255,255,255,0.5)",
};

export type FirebaseProviderType = "google" | "twitter";

interface FirebaseOAuthButtonProps {
  provider: FirebaseProviderType;
  callbackUrl?: string;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  fullWidth?: boolean;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

// ─── Provider Icons (inline SVG) ───

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
}

const iconMap: Record<FirebaseProviderType, () => React.ReactNode> = {
  google: GoogleIcon,
  twitter: XIcon,
};

const defaultLabels: Record<FirebaseProviderType, string> = {
  google: "Continue with Google",
  twitter: "Continue with X",
};

export default function FirebaseOAuthButton({
  provider,
  callbackUrl = "/dashboard",
  label,
  className = "",
  style = {},
  disabled = false,
  fullWidth = true,
  onSuccess,
  onError,
}: FirebaseOAuthButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const IconComponent = iconMap[provider];
  const buttonLabel = label || defaultLabels[provider];

  const handleSignIn = async () => {
    if (isLoading || disabled) return;
    setIsLoading(true);

    let bridgeRes: Response | null = null;
    let bridgeData: any = null;

    try {
      // Step 1: Load Firebase SDK with runtime config
      const {
        getFirebaseAuth,
        getGoogleProvider,
        getTwitterProvider,
      } = await import("@/lib/firebase/client");

      const auth: Auth | null = await getFirebaseAuth();
      if (!auth) {
        throw new Error("Firebase SDK 初始化失败。请检查网络连接后重试。");
      }

      let fbProvider: GoogleAuthProvider | TwitterAuthProvider | null = null;
      if (provider === "google") {
        fbProvider = await getGoogleProvider();
      } else {
        fbProvider = await getTwitterProvider();
      }

      if (!fbProvider) {
        throw new Error(`${provider} 登录未配置`);
      }

      // Step 2: Firebase popup sign-in
      const { signInWithPopup } = await import("firebase/auth");
      const result = await signInWithPopup(auth, fbProvider);

      // Step 3: Get Firebase ID token
      const idToken = await result.user.getIdToken();
      if (!idToken) {
        throw new Error("Failed to get Firebase ID token");
      }

      // Step 4: Bridge to NextAuth session
      bridgeRes = await fetch("/api/auth/firebase-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      bridgeData = await bridgeRes.json();

      if (!bridgeRes.ok || !bridgeData.success) {
        throw new Error(bridgeData.error || "Bridge authentication failed");
      }

      // Step 5: Sign in via NextAuth "firebase-token" credentials provider
      // Get CSRF token first
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();

      if (!csrfToken) {
        throw new Error("Failed to get CSRF token");
      }

      const loginRes = await signIn("firebase-token", {
        token: bridgeData.signInToken,
        userId: bridgeData.userId,
        callbackUrl,
        csrfToken,
        redirect: false,
      });

      // Step 6: Handle redirect
      if (loginRes?.ok) {
        onSuccess?.();
        window.location.href = callbackUrl;
      } else {
        const loginError = loginRes?.error || "NextAuth sign-in failed";
        console.error("[FirebaseOAuthButton] NextAuth signIn failed:", loginError);
        throw new Error(loginError);
      }
    } catch (error: any) {
      console.error(`[FirebaseOAuthButton][${provider}] Error:`, {
        code: error?.code,
        message: error?.message,
        name: error?.name,
        customData: error?.customData,
        stack: error?.stack?.split("\n")?.slice(0, 5),
      });
      const errorCode = error?.code || "";
      const errorMsg = error?.message || "";
      const customData = error?.customData;

      if (errorCode === "auth/unauthorized-domain" || errorMsg.includes("requests-from-referer") || errorMsg.includes("are-blocked")) {
        onError?.("域名未授权：请在 Firebase Console → Authentication → Settings → Authorized domains 中添加 app.lokfeel.com");
      } else if (errorCode === "auth/invalid-credential" || errorCode === "auth/invalid-login-credentials") {
        // OAuth credential rejected — typically means Google Cloud OAuth client misconfiguration
        const hint = customData?.email
          ? ` (账户: ${customData.email})`
          : "";
        onError?.(`OAuth认证失败${hint}。请检查 Google Cloud Console → Credentials 中 OAuth Client 的 Authorized JavaScript origins 是否包含 app.lokfeel.com`);
      } else if (errorCode === "auth/popup-blocked") {
        onError?.("弹窗被浏览器拦截，请允许此网站的弹窗后重试");
      } else if (errorCode === "auth/popup-closed-by-user") {
        // User closed the popup — silently stop
      } else if (errorMsg.includes("client_id") || errorMsg.includes("invalid_request")) {
        onError?.("OAuth 配置错误，请联系管理员");
      } else if (errorMsg.includes("Firebase SDK 初始化失败")) {
        onError?.("Firebase 配置加载失败，请刷新页面重试");
      } else if (bridgeRes && !bridgeRes.ok) {
        // Bridge API error
        onError?.(bridgeData?.error || "服务器认证失败");
      } else {
        const safeMsg = errorCode ? `[${errorCode}]` : "登录失败，请稍后重试";
        onError?.(safeMsg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSignIn}
      disabled={isLoading || disabled}
      className={className}
      style={{
        padding: "13px 16px",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: "12px",
        color: isLoading ? colors.textLoading : colors.text,
        fontSize: "14px",
        fontWeight: "500",
        cursor: isLoading || disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        opacity: isLoading || disabled ? 0.5 : 1,
        transition: "all 0.2s",
        fontFamily: "'Outfit', sans-serif",
        width: fullWidth ? "100%" : "auto",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!isLoading && !disabled) e.currentTarget.style.borderColor = colors.borderHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = colors.border;
      }}
    >
      <IconComponent />
      {isLoading ? (
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round"/>
          </svg>
          Signing in...
        </span>
      ) : (
        buttonLabel
      )}
    </button>
  );
}
