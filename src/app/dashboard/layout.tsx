import AuthProvider from "@/components/providers/auth-provider";

/**
 * `/dashboard/*`（非 `(dashboard)` 路由组）也需要会话上下文。
 *
 * R6-T7：根布局不再挂 SessionProvider（公开营销页不需要它，却要为它下载
 * next-auth/react 并在水合后请求一次 `/api/auth/session`）。而
 * `src/app/dashboard/users/[userId]/page.tsx` 用了 `useSession`，
 * 这条分支原本靠根布局提供 —— 拆掉根布局后必须在这里显式补上，
 * 否则表现为运行时 "must be used within a SessionProvider"，
 * 构建期不会报错。
 */
export default function LegacyDashboardLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
