"use client";

/**
 * LoginInnerClient — Cool Blue V2 Glassmorphism (Optimized for PC)
 * Seamless visual transition from landing page (same video bg + overlay)
 * Retains all OAuth functionality (Google OAuth 2.0, X OAuth 2.0)
 * OPTIMIZED: Removed all inline styles, use Tailwind classes, PC-friendly layout
 */

import { useState, useCallback } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";

// Use manual POST-based Google OAuth (bypasses next-auth/react signIn issues)
import GoogleSignInButton from "@/components/auth/google-sign-in-button";
import { safeJsonParse, getAuthErrorMessage } from "@/lib/safe-json";

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
  const [oauthOnly, setOauthOnly] = useState<{ providers: string; email: string } | null>(null);

  // ─── X (Twitter) OAuth — Manual navigation with error handling ───
  const handleTwitterSignIn = useCallback(async () => {
    setTwitterError(null);
    setIsLoading(true);
    try {
      // Use GET redirect — Twitter has its own custom handler that works via GET
      window.location.href = `/api/auth/oauth/twitter/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
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
          rememberMe,
        }),
      });

      const data = await safeJsonParse<{
        success?: boolean;
        error?: string;
        errorCode?: string;
        providers?: string;
        email?: string;
        redirectUrl?: string;
      }>(res);

      if (!res.ok || !data.success) {
        // Handle OAuth-only user: show OAuth buttons instead of error
        if (data.errorCode === "OAUTH_ONLY") {
          setOauthOnly({
            providers: data.providers || "",
            email: data.email || email,
          });
          setError("");
          setIsLoading(false);
          return;
        }
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
      setError(getAuthErrorMessage(err));
      setIsLoading(false);
    }
  };

  // ─── Continue as Guest ───
  const handleGuestContinue = useCallback(async () => {
    setIsLoading(true);
    try {
      // Set guest JWT via API route, then redirect
      window.location.href = `/api/guest?callbackUrl=${encodeURIComponent(callbackUrl || "/dashboard")}`;
    } catch (err: any) {
      setError("Unable to continue as guest. Please try again.");
      setIsLoading(false);
    }
  }, [callbackUrl]);

  // ─── OAuth-only UI (shown when user has no password) ───
  if (oauthOnly) {
    return (
      <div className="w-full max-w-md mx-auto px-6 py-8">
        <div className="text-center mb-8">
          <Link
            href="/"
            className="text-3xl font-bold text-foreground hover:text-primary transition-colors inline-block mb-4"
          >
            Lok<span className="text-primary">Feel</span>
          </Link>
          <h1 className="text-2xl font-bold text-foreground font-display mb-2">
            Welcome Back
          </h1>
          <p className="text-foreground-muted text-sm">
            This account uses social login
          </p>
        </div>

        <div className="flex flex-col gap-3 mb-6">
          {oauthOnly.providers.includes("google") && (
            <GoogleSignInButton
              callbackUrl={callbackUrl}
              label="Continue with Google"
            />
          )}
          {oauthOnly.providers.includes("twitter") && (
            <button
              type="button"
              onClick={handleTwitterSignIn}
              className="auth-social-btn w-full"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
              </svg>
              Continue with X
            </button>
          )}
        </div>

        <p className="text-center text-xs text-foreground-subtle mb-4">
          <button
            type="button"
            onClick={() => { setOauthOnly(null); setEmail(""); setPassword(""); }}
            className="text-primary hover:text-primary-hover underline cursor-pointer bg-transparent border-none p-0"
          >
            ← Use a different email
          </button>
        </p>

        <button
          type="button"
          onClick={handleGuestContinue}
          className="auth-cta-secondary w-full text-center"
        >
          Continue as Guest
        </button>
      </div>
    );
  }

  // ─── Cool Blue Glass Styles (PC-optimized) ───
  // Using Tailwind classes for all styling (no inline styles)

  return (
    <div className="w-full max-w-md mx-auto px-6 py-8">
      {/* Header — Brand: LokFeel */}
      <div className="text-center mb-8">
        <Link
          href="/"
          className="text-3xl font-bold text-foreground hover:text-primary transition-colors inline-block mb-4"
        >
          Lok<span className="text-primary">Feel</span>
        </Link>
        <h1 className="text-2xl font-bold text-foreground font-display mb-2">
          Welcome Back
        </h1>
        <p className="text-foreground-muted text-sm">
          Log in to continue your journey
        </p>
      </div>

      {/* ─── SOCIAL LOGIN — VERTICAL STACK (Google top, X bottom) ─── */}
      <div className="flex flex-col gap-3 mb-6">
        {/* Google — GIS with FedCM */}
        <GoogleSignInButton
          callbackUrl={callbackUrl}
          disabled={isLoading}
          label="Continue with Google"
        />

        {/* X (Twitter) — Native OAuth 2.0 + PKCE */}
        <div className="w-full">
          <button
            type="button"
            onClick={handleTwitterSignIn}
            disabled={isLoading}
            className="auth-social-btn w-full"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
            </svg>
            Continue with X
          </button>
          {twitterError && (
            <div className="mt-2 p-3 rounded-xl bg-error-muted border border-error-muted text-error text-sm">
              {twitterError}
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="auth-divider mb-6">
        <span>or continue with email</span>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-error-muted border border-error-muted text-error text-sm">
          {error}
        </div>
      )}

      {/* LOGIN FORM */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        {/* Email */}
        <div className="form-group">
          <label
            htmlFor="login-email"
            className="block text-sm font-medium text-foreground-muted mb-2"
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
            className="auth-input w-full"
          />
        </div>

        {/* Password */}
        <div className="form-group">
          <label
            htmlFor="login-password"
            className="block text-sm font-medium text-foreground-muted mb-2"
          >
            Password
          </label>
          <div className="relative">
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
              className="auth-input w-full pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              disabled={isLoading}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-foreground-subtle hover:text-foreground p-1"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Remember Me */}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-foreground-muted cursor-pointer">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-4 h-4 accent-lime-400"
            />
            Remember me
          </label>
          <Link
            href="/forgot-password"
            className="text-sm text-primary hover:text-primary-hover font-medium"
          >
            Forgot password?
          </Link>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading}
          className="auth-cta w-full mt-2"
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

      {/* ─── Bottom Links Row — subtle, Tinder/Bumble style ─── */}
      <div className="flex items-center justify-center gap-3 mt-6 text-sm text-foreground-subtle">
        <button
          type="button"
          onClick={handleGuestContinue}
          className="bg-transparent border-none cursor-pointer text-foreground-subtle hover:text-foreground transition-colors p-0 text-sm"
        >
          Continue as Guest
        </button>
        <span className="text-foreground-faint">·</span>
        <Link
          href="/register"
          className="text-primary hover:text-primary-hover font-medium transition-colors"
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
