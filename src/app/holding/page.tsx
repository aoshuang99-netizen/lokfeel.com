import type { Metadata } from 'next'

import { PublicHold } from '@/components/marketing/public-hold'

/**
 * 冻结期的合规占位页（GA 总令 T2）
 * ═══════════════════════════════════════════════════════════════════════
 * 中间件（`proxy.ts`）在可用时会把这些路由 rewrite 到这里；
 * 五个页面自身也会在冻结时直接返回同一个 `PublicHold`。
 * 两条路径都给同一个答案，所以"只有中间件、没有渲染层"时不至于漏。
 *
 * 为什么不用 404：这些 URL 已被发布过、可能被索引/分享。
 * 404 会让用户以为站点坏了；"审核中"才是真实状态。
 */
export const metadata: Metadata = {
  title: '页面审核中 · LokFeel',
  description: '该页面正在做上线前的最终审核，暂不对外展示。',
  robots: { index: false, follow: false },
}

export default function HoldingPage() {
  return <PublicHold />
}
