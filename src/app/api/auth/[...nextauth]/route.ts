import { handlers } from '@/lib/auth/auth'

// Force dynamic rendering for auth routes
export const dynamic = 'force-dynamic'

// Export handlers for different HTTP methods
export const { GET, POST } = handlers

// Handle OPTIONS for CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
      'Access-Control-Allow-Credentials': 'true',
    },
  })
}
