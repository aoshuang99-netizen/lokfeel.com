import Link from "next/link";

import { visiblePublicLinks } from "@/config/public-surface";

const footerSections = {
  PRODUCT: {
    title: "PRODUCT",
    links: [
      { label: "Product", href: "/product", external: false },
      { label: "Solutions", href: "/solutions", external: false },
      { label: "Stories", href: "/stories", external: false },
      { label: "How it works", href: "/how-it-works", external: false },
      { label: "Help center", href: "/help", external: false },
      { label: "Pricing", href: "/pricing", external: false },
    ],
  },
  COMPANY: {
    title: "COMPANY",
    links: [
      { label: "About Us", href: "/about", external: false },
      { label: "Careers", href: "/careers", external: false },
      { label: "Press", href: "/press", external: false },
      { label: "Contact", href: "/contact", external: false },
    ],
  },
  SUPPORT: {
    title: "SUPPORT",
    links: [
      { label: "FAQ", href: "/faq", external: false },
      { label: "Safety Tips", href: "/safety-tips", external: false },
      { label: "Community Guidelines", href: "/community-guidelines", external: false },
      { label: "Support", href: "/support", external: false },
      { label: "Refunds", href: "/refunds", external: false },
      { label: "Cancellations Policy", href: "/cancellations-policy", external: false },
    ],
  },
  LEGAL: {
    title: "LEGAL",
    links: [
      { label: "Terms of Service", href: "/terms", external: false },
      { label: "Privacy Policy", href: "/privacy", external: false },
      { label: "Cookie Policy", href: "/cookies", external: false },
      { label: "DMCA", href: "/dmca", external: false },
      // 18 U.S.C. 2257 与 Fan/Creator Agreement 属**成人内容平台**法务模板，
      // 与 Connection OS 的业务范围无关。两者路由仍保留（已停用 + noindex，
      // 老链接与外部引用不断链），但**不再从全站页脚导流** ——
      // 继续挂着等于对外声明我们经营那类业务（V16 · T07 legacy 治理）。
      { label: "Acceptable Use Policy", href: "/terms#use-policy", external: false },
      { label: "Appeals Policy", href: "/content-removal-appeals-policy", external: false },
    ],
  },
  FOLLOW: {
    title: "FOLLOW",
    links: [
      // C-31 / P0-08（2026-11-12 实测）：blog.lokfeel.com 经 dscacheutil 查询
      // **无任何 DNS 记录**，curl 报 CONNECT tunnel 502 ⇒ 确认死链，从全站页脚移除。
      // Twitter / Instagram / Facebook 三个域名有 DNS 记录，但本机代理对
      // 外站一律阻断（对照 github.com 同为 HTTP 000），可达性本轮 NOT_TESTED，
      // 故保留但不宣称已核验；D8 主体批复时一并复核。
      { label: "Twitter / X", href: "https://twitter.com/lokfeel", external: true },
      { label: "Instagram", href: "https://instagram.com/lokfeel", external: true },
      { label: "Facebook", href: "https://facebook.com/lokfeel", external: true },
    ],
  },
};

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/10">
      <div className="max-w-7xl mx-auto px-6 sm:px-12 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10 mb-12">
          {Object.entries(footerSections).map(([key, section]) => (
            <div key={key}>
              {/* 无障碍：原为 h4，页面只有 h1 时构成 h1→h4 跳级（键盘/读屏审计实测）。
                  页脚栏目是 footer 内的一级分组，用 h2 才是正确的结构层级；样式由 class 决定，视觉不变。 */}
              {/* V19.8：white/40 只有 3.77:1（axe color-contrast 判红）→ white/60 ≈ 6.9:1 */}
              <h2 className="text-[11px] font-bold tracking-widest text-white/60 uppercase mb-4">
                {section.title}
              </h2>
              <ul className="space-y-2 list-none p-0 m-0">
                {/* GA T2：审核中的公开页从页脚摘除（与中间件/sitemap 同一份名单），
                    避免"入口还在、点进去却是审核中"的孤儿导航。 */}
                {visiblePublicLinks(section.links).map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] text-white/50 hover:text-white/90 no-underline transition-colors inline-flex items-center min-h-6"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-[13px] text-white/50 hover:text-white/90 no-underline transition-colors inline-flex items-center min-h-6"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar — 仅版权，不重复 Follow Us 栏 */}
        <div className="pt-8 border-t border-white/10 flex items-center justify-center">
          {/* V19.8：同上，white/40 → white/60（对比度 3.78 → ≈6.9:1） */}
          <p className="text-[13px] text-white/60">
            &copy; 2026 LokFeel. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
