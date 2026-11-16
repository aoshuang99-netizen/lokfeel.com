"use client";

import { usePathname } from "next/navigation";
import Footer from "@/components/layout/footer";

/**
 * 认证面外壳。
 *
 * 两套皮肤（按路由分流，不是两套逻辑）：
 *   · `/login` —— **纸面壳**（v4 生成式登录）：无视频、无毛玻璃，登录组件自己
 *     拥有 `<main>` 与左右两栏（左栏是随输入生成的 sign-in preflight）。
 *     理由：登录页是产品第一屏，视觉必须与首页同一套 token，否则"进站即换皮"。
 *   · 其余（register / forgot / reset / verify / auto-login / admin-login）——
 *     保持既有深色视频壳不动，避免牵连未验证的注册流程。
 *
 * 2026-11-16：删除 `lokfeel_from_landing` 淡入分支。该标记全仓**没有任何写入点**
 * （grep 只有本文件的读与删），是死代码；且它在 effect 里同步 setState，
 * 触发 React Compiler 的 cascading-render 规则。删除后行为不变（恒为不透明）。
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isPaperShell = pathname === "/login";

  if (isPaperShell) {
    return (
      <div className="min-h-screen" style={{ background: "#f7f5f0" }}>
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#0a0a0a]">
      {/* Video Background — identical to landing page */}
      <div className="hero-video-container" aria-hidden="true">
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover animate-ken-burns opacity-100 animate-fadeIn"
        >
          {/* Mobile: lightweight 720p */}
          <source
            src="/videos/background-mobile-720p.mp4"
            type="video/mp4"
            media="(max-width: 768px)"
          />
          {/* Modern browsers: WebM */}
          <source
            src="/videos/background-desktop-1080p.webm"
            type="video/webm"
          />
          {/* Fallback: MP4 */}
          <source
            src="/videos/background-desktop-1080p.mp4"
            type="video/mp4"
          />
        </video>
        {/* Overlay handled by hero-video-container::after in globals.css — identical to landing */}
        {/* Purple ambient glow — bottom left (identical to landing) */}
        <div className="absolute bottom-0 left-0 h-96 w-96 rounded-full bg-[#4c1d95]/20 blur-[120px] pointer-events-none" />
      </div>

      {/* Auth Content — 无障碍：认证面此前整片无 landmark（键盘/读屏审计实测 main=N），
          此处就是主内容区，用 <main> 而不是再加一层 div */}
      <main className="relative z-10 min-h-screen flex items-center justify-center px-6 pt-20 pb-20">
        {children}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
