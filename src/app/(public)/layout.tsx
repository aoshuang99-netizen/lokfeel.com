import Navbar from "@/components/layout/navbar";
import Footer from "@/components/layout/footer";

/**
 * 公开子页共享 chrome（G2 路由闭环 · B2）：
 * 此前 22 个公开子页无导航无页脚（落地页自带 chrome，子页是孤岛死端）。
 * 导航与页脚是"营销主域与 app 子域共用定位/导航/语言/价格/支持入口"的落点，
 * 链接清单与 01b 文案矩阵同源。
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navbar />
      {/* data-public-root：a11y 钩子——公开面正文链接下划线常驻（axe link-in-text-block，见 globals.css） */}
      <main data-public-root>{children}</main>
      <Footer />
    </>
  );
}
