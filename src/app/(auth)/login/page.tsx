/**
 * LOGIN PAGE — Server Component
 *
 * Simplified approach:
 * 1. Check session → redirect if logged in
 * 2. Extract error/callbackUrl from searchParams
 * 3. Delegate ALL auth logic to Client Component
 *
 * WHY this works (unlike previous attempt):
 * - Previous: SSR fetched CSRF token (got JSON value) but couldn't pass
 *   the Set-Cookie to the browser → MissingCSRF on POST
 * - Now: Client component uses signIn() from next-auth/react which
 *   internally calls /api/auth/csrf WITH cookies, then submits form
 *   with both token AND cookie matching.
 */

import { auth } from "@/lib/auth/auth";
import { redirect } from "next/navigation";
import LoginInnerClient from "./login-inner-client";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const params = await searchParams;

  // If already logged in, redirect away
  const session = await auth();
  if (session?.user) {
    const role = (session.user as any)?.role;
    // Admin users → /admin, Regular users → /dashboard
    const destination = role === "ADMIN" || role === "SUPER_ADMIN"
      ? "/admin"
      : (params.callbackUrl || "/dashboard");
    redirect(destination);
  }

  // Parse error from URL (NextAuth redirects back with ?error=xxx)
  let errorMessage = "";
  if (params.error) {
    switch (params.error) {
      case "CredentialsSignin":
        errorMessage = "Invalid email or password.";
        break;
      case "MissingCSRF":
        errorMessage = "Security verification failed. Please try again.";
        break;
      case "AccessDenied":
        errorMessage = "Access denied. Your account may not have access.";
        break;
      case "Configuration":
        errorMessage = "Authentication service error. Please try again or use email/password.";
        break;
      case "OAuthSignin":
      case "OAuthCallback":
      case "OAuthCreateAccount":
      case "OAuthAccountNotLinked":
        errorMessage = "Social login failed. Please try again or use email/password.";
        break;
      default:
        // Support custom error messages from our Twitter/Google OAuth handlers
        // (they pass human-readable error strings directly)
        if (params.error.length > 20) {
          // Likely a custom error message, not a NextAuth error code
          errorMessage = decodeURIComponent(params.error);
        } else {
          errorMessage = "Sign in failed. Please try again.";
        }
    }
  }

  return (
    <LoginInnerClient
      callbackUrl={params.callbackUrl || "/dashboard"}
      errorMessage={errorMessage}
    />
  );
}
