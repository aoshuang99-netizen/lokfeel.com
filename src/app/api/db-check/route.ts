import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Test basic database connectivity by counting users
    const userCount = await db.user.count()
    const profileCount = await db.profile.count()
    
    return NextResponse.json({ 
      status: 'connected',
      engine: 'libsql',
      stats: {
        users: userCount,
        profiles: profileCount,
      }
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
