'use client'

/**
 * 社群切换器（V20.5 · Batch 3「组织切换」）
 *
 * 此前 Console 只显示「最早加入的那个社群」：`resolveTenantForUser()` 在未指定
 * `organizationId` 时按 `createdAt asc` 取第一条，而七屏布局直接调它 ——
 * 属于多个社群的人**没有任何办法**看到第二个。`listTenants()` 的注释里写着
 * 「租户切换器用」，但切换器一直没被写出来。
 *
 * 为什么用原生 `<select>` 而不是自绘下拉：
 *   · 键盘、屏幕阅读器、移动端选择器全部由浏览器负责，天然满足 WCAG 2.2；
 *   · 自绘下拉要自己处理 roving tabindex / Escape / 外点关闭 / aria-activedescendant，
 *     而本仓已经因为"自己写第四份焦点逻辑"吃过亏（见 `use-dialog-a11y` 的注释）。
 *   在这个位置，可预测性比视觉定制重要。
 *
 * 为什么切换后是 `router.refresh()` 而不是整页跳转：
 *   · 租户是**服务端解析**的（cookie 软偏好），刷新即可让 RSC 用新租户重渲染；
 *   · 整页跳转会丢掉当前屏的本地状态，而用户只是换了个社群，没换页面。
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronsUpDown } from 'lucide-react'

export interface OrgSwitcherProps {
  tenants: readonly { organizationId: string; name: string; role: string }[]
  activeOrganizationId: string
}

export default function OrgSwitcher({ tenants, activeOrganizationId }: OrgSwitcherProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(activeOrganizationId)

  // 只有一个社群时不渲染选择器：一个"只有一项的下拉"是无意义控件（AC-18 的同类问题）。
  if (tenants.length < 2) return null

  async function switchTo(next: string) {
    if (next === activeOrganizationId) return
    setSelected(next)
    setError(null)
    try {
      const res = await fetch('/api/v1/organizations/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: next }),
        credentials: 'same-origin',
      })
      if (!res.ok) {
        // 403 = 已不是该社群成员（例如刚被移出）。不能假装成功 ——
        // 否则用户会看到"切过去了"但所有数据仍然是原来那个社群的。
        setSelected(activeOrganizationId)
        setError(res.status === 403 ? '你已不是该社群的成员' : '切换失败，请重试')
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setSelected(activeOrganizationId)
      setError('网络异常，切换未生效')
    }
  }

  return (
    <div className="flex min-w-0 flex-col">
      <label className="sr-only" htmlFor="lf-org-switcher">
        切换社群
      </label>
      <div className="relative flex min-w-0 items-center">
        <select
          id="lf-org-switcher"
          value={selected}
          disabled={pending}
          aria-busy={pending}
          onChange={(e) => void switchTo(e.target.value)}
          className="min-h-11 w-full max-w-[14rem] appearance-none truncate rounded-lg border border-card-border bg-background-secondary py-1 pl-2 pr-7 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {tenants.map((t) => (
            <option key={t.organizationId} value={t.organizationId}>
              {t.name}（{t.role}）
            </option>
          ))}
        </select>
        <ChevronsUpDown
          className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-foreground-muted"
          aria-hidden="true"
        />
      </div>
      {error && (
        <p role="status" className="mt-0.5 text-[10px] text-error">
          {error}
        </p>
      )}
    </div>
  )
}
