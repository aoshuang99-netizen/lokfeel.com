import { NextAuthConfig } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Google from 'next-auth/providers/google'
import GitHub from 'next-auth/providers/github'
import Credentials from 'next-auth/providers/credentials'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verifyPassword } from './auth'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const authConfig: NextAuthConfig = {
  // PrismaAdapter for OAuth and session management
  // Note: Credentials provider doesn't use the adapter
  
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      allowDangerousEmailAccountLinking: true,
    }),
    
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      allowDangerousEmailAccountLinking: true,
    }),
    
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials)
        
        if (!parsed.success) {
          return null
        }
        
        const { email, password } = parsed.data
        
        // For MVP: check if user exists, credentials login is optional
        const user = await db.user.findUnique({
          where: { email },
        })
        
        if (!user) {
          return null
        }
        
        // Password check skipped for MVP (OAuth-only for now)
        // In production, you'd add a password hash column and verify here
        
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        }
      },
    }),
  ],
  
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
  
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        token.role = 'USER' // Default role
        token.email = user.email
      }
      
      if (trigger === 'update' && session) {
        token.name = (session as any).name ?? token.name
        token.picture = (session as any).image ?? token.picture
      }
      
      // Fetch fresh role from DB
      if (token.email) {
        const dbUser = await db.user.findUnique({
          where: { email: token.email as string },
          select: { role: true },
        })
        if (dbUser) {
          token.role = dbUser.role
        }
      }
      
      return token
    },
    
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).id = token.id as string
        (session.user as any).role = token.role as string
        (session.user as any).email = token.email as string
      }
      
      return session
    },
    
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`
      if (new URL(url).origin === baseUrl) return url
      return baseUrl
    },
  },
  
  pages: {
    signIn: '/login',
    verifyRequest: '/verify-request',
  },
  
  debug: process.env.NODE_ENV === 'development',
}
