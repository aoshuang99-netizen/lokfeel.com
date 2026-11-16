import Navbar from "@/components/layout/navbar";
import Footer from "@/components/layout/footer";
import { isPublicSurfaceFrozen } from "@/config/public-surface";

/**
 * 公开子页共享 chrome（G2 路由闭环 · B2）。
 *
 * V22 修复：冻结态由**服务端计算一次**，作为 prop 传给 Navbar（client）与
 * Footer（server）。此前 Navbar 自己在客户端调用 `isPublicSurfaceFrozen()`，
 * 但 `PUBLIC_SURFACE_FROZEN` 不是 NEXT_PUBLIC_* 变量、不会内联到浏览器，
 * 导致「服务端已解冻、客户端仍冻结」→ 导航链接数量不一致 → React #418
 * 水合错误（本批 Preview 在 /pricing 实测复现）。两端共用同一个序列化值
 * 后，无论运维如何开关都不会再出现半解冻状态。
 *
 * 🔴 这个 prop 只决定「链接是否出现在导航里」，不是安全边界；
 *    真正的拦截仍在 proxy.ts（rewrite 到 /holding）。
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const publicSurfaceFrozen = isPublicSurfaceFrozen();

  return (
    <>
      <Navbar frozen={publicSurfaceFrozen} />
      {/* data-public-root：a11y 钩子——公开面正文链接下划线常驻（axe link-in-text-block，见 globals.css） */}
      <main data-public-root>{children}</main>
      <Footer frozen={publicSurfaceFrozen} />
    </>
  );
}
