/**
 * Shared open-redirect guard for post-authentication redirects.
 *
 * WHY: Credentials login (/api/auth/login) and the OAuth callbacks
 * (Google / Twitter) all read a `callbackUrl` from a cookie and then
 * `NextResponse.redirect(new URL(destination, request.url))`. If that
 * value is attacker-controlled (e.g. a crafted cookie or a cookie planted
 * by a third-party sub-resource), an absolute external URL would redirect
 * the freshly-authenticated victim to a phishing origin.
 *
 * This single source of truth lets every auth entry-point enforce the SAME
 * allow-list instead of each rolling its own (inconsistent) check.
 *
 * Policy:
 *  - Relative paths (e.g. "/dashboard") are allowed, EXCEPT protocol-relative
 *    "//evil.com" which resolves to an external origin.
 *  - Absolute URLs are only allowed when their host matches an app host
 *    (production + configured NEXT_PUBLIC_APP_URL / NEXTAUTH_URL + localhost).
 */

const ALLOWED_REDIRECT_HOSTS = [
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.NEXTAUTH_URL,
  "https://app.lokfeel.com",
  "http://localhost:3099",
  "http://localhost:3000",
]
  .filter(Boolean)
  .map((u) => {
    try {
      return new URL(u as string).host
    } catch {
      return ""
    }
  })
  .filter(Boolean)

/**
 * Returns true when `url` is safe to redirect to after authentication.
 */
export function isSafeRedirect(url?: string): boolean {
  if (!url) return false
  // Relative path is safe — but reject protocol-relative "//evil.com"
  if (url.startsWith("/") && !url.startsWith("//")) return true
  try {
    const u = new URL(url)
    return ALLOWED_REDIRECT_HOSTS.includes(u.host)
  } catch {
    return false
  }
}
