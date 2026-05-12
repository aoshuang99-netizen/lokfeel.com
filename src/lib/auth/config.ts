import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/auth";
import { syncOAuthProfileToUser, OAuthProfileData } from "@/lib/auth/oauth-profile";

// Clean env vars: strip surrounding whitespace, surrounding quotes,
// AND literal "\n"/"\r" strings that Vercel CLI sometimes injects
// (.env.local often has AUTH_SECRET="value" with literal quotes that break JWT)
export function cleanEnvVar(key: string): string {
  if (!process.env[key]) return "";
  return process.env[key]!
    .replace(/^["']|["']$/g, "")       // strip surrounding quotes
    .replace(/\\n|\\r/g, "")            // remove literal \n / \r injected by Vercel CLI
    .trim();
}

// Trim env vars in case Vercel injected trailing newlines
if (process.env.AUTH_SECRET) process.env.AUTH_SECRET = cleanEnvVar("AUTH_SECRET")
if (process.env.AUTH_URL) process.env.AUTH_URL = cleanEnvVar("AUTH_URL")
if (process.env.NEXTAUTH_URL) process.env.NEXTAUTH_URL = cleanEnvVar("NEXTAUTH_URL")
if (process.env.DATABASE_URL) process.env.DATABASE_URL = cleanEnvVar("DATABASE_URL")
if (process.env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = cleanEnvVar("GOOGLE_CLIENT_ID")
if (process.env.GOOGLE_CLIENT_SECRET) process.env.GOOGLE_CLIENT_SECRET = cleanEnvVar("GOOGLE_CLIENT_SECRET")

// Dev server fix: use localhost with dynamic port for local development
const isDev = process.env.NODE_ENV !== "production";
if (isDev) {
  const port = process.env.PORT || "3000";
  process.env.AUTH_URL = process.env.AUTH_URL || `http://localhost:${port}`;
}

export const authConfig = {
  adapter: PrismaAdapter(db),
  trustHost: true,
  basePath: "/api/auth",
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        try {
          // Normalize email to lowercase for case-insensitive lookup
          const email = (credentials.email as string).toLowerCase().trim();
          
          const user = await db.user.findUnique({
            where: { email },
            include: { profile: true },
          });

          if (!user || !(user as any).password) {
            return null;
          }

          const isValid = await verifyPassword(
            credentials.password as string,
            (user as any).password
          );

          if (!isValid) {
            return null;
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name || user.profile?.displayName || "",
            image: user.image || user.profile?.avatar || null,
            role: user.role,
          };
        } catch {
          // Database not available (build time / no DATABASE_URL)
          return null;
        }
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || undefined,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || undefined,
      authorization: {
        params: {
          scope: 'openid email profile',
        },
      },
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
          emailVerified: profile.email_verified ? new Date() : null,
        };
      },
    }),
    // Firebase Bridge Credentials provider
    // Accepts one-time sign-in tokens from /api/auth/firebase-bridge
    Credentials({
      id: "firebase-token",
      name: "Firebase",
      credentials: {
        token: { label: "Token", type: "text" },
        userId: { label: "User ID", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.token || !credentials?.userId) {
          console.error("[firebase-token authorize] Missing token or userId");
          return null;
        }

        try {
          const rawToken = credentials.token as string;
          const userId = credentials.userId as string;

          // Token format: "fb_{userId}_{uuid}_{timestamp}"
          if (!rawToken.startsWith(`fb_${userId}_`)) {
            console.error("[firebase-token authorize] Token format mismatch. Expected fb_" + userId.substring(0, 8) + "_, got:", rawToken.substring(0, 20));
            return null;
          }

          // Look up the verification token (exact match — raw token stored directly)
          let verification;
          try {
            verification = await db.verificationToken.findUnique({
              where: {
                identifier_token: {
                  identifier: `firebase:${userId}`,
                  token: rawToken,
                },
              },
            });
          } catch (dbErr: any) {
            console.error("[firebase-token authorize] DB lookup error:", dbErr.message);
            return null;
          }

          if (!verification) {
            console.error("[firebase-token authorize] Verification token not found for user:", userId.substring(0, 8));
            return null;
          }

          // Check expiration
          if (verification.expires < new Date()) {
            console.error("[firebase-token authorize] Token expired for user:", userId.substring(0, 8), "expired at:", verification.expires.toISOString());
            await db.verificationToken.delete({ where: { id: verification.id } });
            return null;
          }

          // Verify user exists
          let user;
          try {
            user = await db.user.findUnique({
              where: { id: userId },
              include: { profile: true },
            });
          } catch (dbErr: any) {
            console.error("[firebase-token authorize] User lookup error:", dbErr.message);
            return null;
          }

          if (!user) {
            console.error("[firebase-token authorize] User not found:", userId.substring(0, 8));
            return null;
          }

          // Delete the one-time token (single use)
          try {
            await db.verificationToken.delete({ where: { id: verification.id } });
          } catch (dbErr: any) {
            console.error("[firebase-token authorize] Token deletion error (non-fatal):", dbErr.message);
          }

          console.log("[firebase-token authorize] Success for user:", userId.substring(0, 8), user.email);

          return {
            id: user.id,
            email: user.email,
            name: user.name || user.profile?.displayName || "",
            image: user.image || user.profile?.avatar || null,
            role: user.role,
            emailVerified: user.emailVerified,
          };
        } catch (err: any) {
          console.error("[firebase-token authorize] Unexpected error:", err.message, err.stack);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: "jwt" as const,
    maxAge: 7 * 24 * 60 * 60, // 7 days (reduced from 30 for security)
  },
  pages: {
    signIn: "/login",
    signOut: "/login",
    error: "/login",
    verifyRequest: "/verify-request",
  },
  events: {
    // Sync OAuth profile data after successful sign in
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signIn({ user, account, profile, isNewUser }: any) {
      if (account?.provider !== "credentials" && user?.id && profile) {
        try {
        const oauthProfile: OAuthProfileData = {
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          email: user.email || profile.email,
          name: user.name || profile.name || profile.username,
          image: user.image || profile.picture || (profile as any).avatar,
          // Google specific
          locale: (profile as any).locale,
          verified: (profile as any).email_verified || (profile as any).verified,
          // Twitter/X specific
          occupation: undefined,
          company: undefined,
          industry: undefined,
        };

          await syncOAuthProfileToUser(user.id, oauthProfile);
        } catch (error) {
          console.error('OAuth profile sync error:', error);
          // Non-blocking: continue sign in even if sync fails
        }
      }
    },
  },
  callbacks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signIn({ user, account, profile }: any) {
      // Allow OAuth sign-in
      if (account?.provider !== "credentials") {
        return true;
      }
      return true;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async jwt({ token, user, trigger, session }: any) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Auth Debug][JWT] trigger:', trigger, 'user:', user?.id, user?.email);
      }
      if (user) {
        token.id = user.id;
        token.role = user.role || "USER";
        token.name = user.name;
        token.picture = user.image;
        token.emailVerified = user.emailVerified || null;
      }

      // Update token on session update
      if (trigger === "update" && session) {
        token.name = session.name;
        token.picture = session.image;
      }

      return token;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async session({ session, token }: any) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Auth Debug] session callback - token.id:', token.id, 'token.role:', token.role);
      }
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.name = token.name;
        session.user.image = token.picture;
        // Expose verification status to client
        ;(session.user as any).emailVerified = token.emailVerified;
      }
      if (process.env.NODE_ENV === 'development') {
        console.log('[Auth Debug] session result - session.user.id:', session.user?.id);
      }
      return session;
    },
  } as any,
  secret: process.env.AUTH_SECRET,
  debug: process.env.NODE_ENV === "development",
};
