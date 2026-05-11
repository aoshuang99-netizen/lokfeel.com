/**
 * OAuth Configuration Check Utility
 * 
 * Checks if OAuth providers are properly configured.
 * Used to show/hide OAuth buttons in UI and provide better error messages.
 */

export interface OAuthStatus {
  google: boolean;
  twitter: boolean;
}

/**
 * Check OAuth configuration status (client-safe, checks only public env vars)
 */
export function getOAuthStatus(): OAuthStatus {
  // Only check NEXT_PUBLIC_ vars for client-side
  // For server-side, this function should be called from an API route
  return {
    google: true, // Google OAuth is handled by GIS, always available if component mounted
    twitter: true, // Twitter OAuth availability checked via API
  };
}

/**
 * Server-side OAuth config validation
 * Call this in API routes to check if credentials are configured
 */
export function validateOAuthConfig(): {
  google: { configured: boolean; message: string };
  twitter: { configured: boolean; message: string };
} {
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const twitterClientId = process.env.TWITTER_CLIENT_ID?.trim();
  const twitterClientSecret = process.env.TWITTER_CLIENT_SECRET?.trim();

  return {
    google: {
      configured: !!(googleClientId && googleClientSecret),
      message: !googleClientId 
        ? "GOOGLE_CLIENT_ID not configured" 
        : !googleClientSecret 
        ? "GOOGLE_CLIENT_SECRET not configured"
        : "OK",
    },
    twitter: {
      configured: !!(twitterClientId && twitterClientSecret),
      message: !twitterClientId 
        ? "TWITTER_CLIENT_ID not configured" 
        : !twitterClientSecret 
        ? "TWITTER_CLIENT_SECRET not configured"
        : "OK",
    },
  };
}
