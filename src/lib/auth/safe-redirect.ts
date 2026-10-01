/**
 * Shared open-redirect guard for post-authentication redirects.
 *
 * WHY: Credentials login (/api/auth/login) and the OAuth callbacks
 * (Google / Twitter) all read a `callbackUrl` from a cookie and then
 * `NextResponse.redirect(new URL(destination, publicOrigin))` — 注意基址必须取自
 * `@/lib/http/public-origin`（公开 origin），不要用 `request.url`：生产实测
 * `request.url` 会指向平台部署专用域名。If that
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
 *
 * ⚠️ Normalization (regression fix, 2026-10-01):
 *   The WHATWG URL parser treats "\" exactly like "/" for special schemes
 *   (http/https), and strips ASCII tab/newline/CR before parsing. So the raw
 *   spellings "/\evil.com" and "\t//evil.com" **resolve to https://evil.com/**
 *   even though neither starts with "//" — the old prefix check let them through
 *   and this was reproducible end-to-end in production (a crafted callbackUrl
 *   was stored verbatim in the google-callback-url cookie and then honoured).
 *   We therefore normalize those synonyms BEFORE any prefix comparison, so a
 *   URL is judged by its effective destination rather than its spelling.
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
 * Normalize a candidate redirect target into its effective canonical spelling.
 *
 * WHY: the browser's URL parser (`new URL`) applies these transformations
 * anyway; doing it ourselves first means the allow-list sees the same string
 * the redirect will actually use.
 *   - `\` → `/`   (WHATWG: backslash is a path separator for http/https)
 *   - strip ASCII tab / newline / CR (WHATWG removes them before parsing)
 */
function normalizeRedirectTarget(url: string): string {
  return url.replace(/\\/g, "/").replace(/[\t\n\r]/g, "")
}

/**
 * Returns true when `url` is safe to redirect to after authentication.
 */
export function isSafeRedirect(url?: string): boolean {
  if (!url) return false
  const normalized = normalizeRedirectTarget(url)
  if (!normalized) return false
  // Relative path is safe — but reject protocol-relative "//evil.com".
  // Checked AFTER normalization so "/\evil.com" (→ "//evil.com") is rejected too.
  if (normalized.startsWith("/") && !normalized.startsWith("//")) return true
  try {
    const u = new URL(normalized)
    return ALLOWED_REDIRECT_HOSTS.includes(u.host)
  } catch {
    return false
  }
}
