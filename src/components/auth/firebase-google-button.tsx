"use client";

/**
 * Firebase Google Sign-In Button
 * Uses Firebase JS SDK (signInWithPopup) - NOT Google Identity Services (GIS)
 * 
 * WHY: Firebase SDK handles account selection + returns Firebase ID token directly
 * No FedCM complexity, no One Tap deprecation warnings, no hydration issues
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { signIn } from "next-auth/react";
import { getAuth, signInWithPopup, GoogleAuthProvider, User } from "firebase/auth";
import { initializeApp, getApps } from "firebase/app";

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

interface FirebaseGoogleButtonProps {
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

// Firebase config from env (client-side)
function getFirebaseConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

export default function FirebaseGoogleButton({
  callbackUrl = "/dashboard",
  label = "Continue with Google",
  disabled = false,
  onSuccess,
  onError,
}: FirebaseGoogleButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleGoogleSignIn = useCallback(async () => {
    if (isLoading || disabled) return;

    setIsLoading(true);
    setError("");

    try {
      // Initialize Firebase (client-side only, prevent double init)
      if (typeof window === "undefined") return;

      if (getApps().length === 0) {
        const config = getFirebaseConfig();
        // Validate config
        if (!config.apiKey || !config.projectId) {
          throw new Error("Firebase config missing. Check NEXT_PUBLIC_FIREBASE_* env vars.");
        }
        initializeApp(config);
      }

      const auth = getAuth();
      const provider = new GoogleAuthProvider();
      
      // Force account selection (user can switch accounts)
      provider.setCustomParameters({
        prompt: "select_account",
      });

      console.log("[Firebase Google] Popup sign-in starting...");
      
      const result = await signInWithPopup(auth, provider);
      const user: User = result.user;

      if (!user) throw new Error("No user returned from Google sign-in");

      console.log("[Firebase Google] User:", user.email, user.displayName);

      // Get Firebase ID token
      const idToken = await user.getIdToken();
      console.log("[Firebase Google] ID token obtained, length:", idToken.length);

      // Send to bridge API
      const bridgeRes = await fetch("/api/auth/firebase-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      const bridge = await bridgeRes.json();
      if (!bridgeRes.ok || !bridge.success) {
        throw new Error(bridge.error || "Firebase bridge failed");
      }

      console.log("[Firebase Google] Bridge OK, userId:", bridge.userId);

      // Get CSRF token
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      if (!csrfToken) throw new Error("CSRF token unavailable");

      // Sign in via NextAuth (firebase-token provider)
      const loginRes = await signIn("firebase-token", {
        token: bridge.signInToken,
        userId: bridge.userId,
        callbackUrl,
        csrfToken,
        redirect: false,
      });

      if (loginRes?.ok) {
        console.log("[Firebase Google] NextAuth login OK");
        if (mountedRef.current) {
          onSuccess?.();
          window.location.href = callbackUrl;
        }
      } else {
        throw new Error(loginRes?.error || "NextAuth sign-in failed");
      }
    } catch (err: any) {
      console.error("[Firebase Google] Error:", err);
      if (!mountedRef.current) return;

      let msg = err.message || "Google sign-in failed";
      
      // Handle specific Firebase errors
      if (err.code === "auth/popup-closed-by-user") {
        msg = "Sign-in cancelled. Please try again.";
      } else if (err.code === "auth/popup-blocked") {
        msg = "Popup blocked by browser. Please allow popups for this site.";
      }

      setError(msg);
      onError?.(msg);
      setIsLoading(false);
    }
  }, [isLoading, disabled, callbackUrl, onSuccess, onError]);

  return (
    <div style={{ width: "100%" }}>
      <button
        type="button"
        onClick={handleGoogleSignIn}
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
        {isLoading ? (
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ animation: "spin 1s linear infinite" }}>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round"/>
            </svg>
            Signing in...
          </span>
        ) : (
          label
        )}
      </button>

      {error && (
        <div style={{
          marginTop: "8px",
          padding: "10px 12px",
          background: colors.errorBg,
          border: `1px solid ${colors.error}33`,
          borderRadius: "8px",
          color: colors.error,
          fontSize: "12px",
          lineHeight: "1.5",
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
