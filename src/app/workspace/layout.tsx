/**
 * Living Workspace —— 个人态访问守卫（`/workspace/*`）
 *
 * 依据：`docs/implementation/DESIGN/02-plan.md` P0「预览路由 /workspace（鉴权守卫内）」。
 * 这是 **Next 路由**，不是 mock：未登录一律跳登录并**保留回跳地址**
 * （与 `(dashboard)/layout.tsx`、`console/layout.tsx` 同款做法，只接受 `/workspace` 命名空间内的相对路径）。
 */
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth/auth'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Living Workspace',
}

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  if (!session?.user?.id) {
    const headersList = await headers()
    let callbackUrl = '/workspace'
    try {
      const refUrl = new URL(headersList.get('referer') || '')
      if (refUrl.pathname.startsWith('/workspace')) {
        callbackUrl = refUrl.pathname + refUrl.search
      }
    } catch {
      /* Referer 缺失或非法 → 回落入口 */
    }
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }

  return <>{children}</>
}
