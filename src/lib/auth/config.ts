import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import LinkedIn from "next-auth/providers/linkedin";
import Facebook from "next-auth/providers/facebook";
import Discord from "next-auth/providers/discord";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/auth";
import { syncOAuthProfileToUser, OAuthProfileData } from "@/lib/auth/oauth-profile";

export const authConfig = {
  adapter: PrismaAdapter(db),
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
          const user = await db.user.findUnique({
            where: { email: credentials.email as string },
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
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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
    LinkedIn({
      clientId: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      authorization: {
        params: {
          scope: 'openid profile email',
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
    Facebook({
      clientId: process.env.FACEBOOK_CLIENT_ID,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
      authorization: {
        params: {
          scope: 'email public_profile',
        },
      },
      profile(profile) {
        return {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          image: profile.picture?.data?.url,
          emailVerified: null,
        };
      },
    }),
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      authorization: {
        params: {
          scope: 'identify email',
        },
      },
      profile(profile) {
        if (profile.avatar === null) {
          const defaultAvatarNumber = parseInt(profile.discriminator) % 5;
          profile.image_url = `https://cdn.discordapp.com/embed/avatars/${defaultAvatarNumber}.png`;
        } else {
          const format = profile.avatar.startsWith("a_") ? "gif" : "png";
          profile.image_url = `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${format}`;
        }
        return {
          id: profile.id,
          name: profile.global_name || profile.username,
          email: profile.email,
          image: profile.image_url,
          emailVerified: profile.verified ? new Date() : null,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt" as const,
    maxAge: 30 * 24 * 60 * 60, // 30 days
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
            name: user.name || profile.name,
            image: user.image || profile.picture || profile.image?.url,
            // LinkedIn specific
            headline: profile.headline,
            industry: profile.industry,
            location: profile.location?.name,
            summary: profile.summary,
            // Google specific
            locale: profile.locale,
            verified: profile.email_verified,
            // Facebook specific
            birthday: profile.birthday,
            hometown: profile.hometown?.name,
            gender: profile.gender,
            // Discord specific
            username: profile.username,
            discriminator: profile.discriminator,
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
      if (user) {
        token.id = user.id;
        token.role = user.role || "USER";
        token.name = user.name;
        token.picture = user.image;
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
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.name = token.name;
        session.user.image = token.picture;
      }
      return session;
    },
  } as any,
  secret: process.env.AUTH_SECRET,
  debug: process.env.NODE_ENV === "development",
};
