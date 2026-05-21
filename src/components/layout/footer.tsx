import Link from "next/link";

const footerSections = {
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
      { label: "18 U.S.C. 2257", href: "/18-usc-2257", external: false },
      { label: "Acceptable Use Policy", href: "/terms#use-policy", external: false },
      { label: "Appeals Policy", href: "/content-removal-appeals-policy", external: false },
      { label: "Fan/Creator Agreement", href: "/fan-creator-agreement", external: false },
    ],
  },
  FOLLOW: {
    title: "FOLLOW",
    links: [
      { label: "Blog", href: "https://blog.lokfeel.com", external: true },
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-12">
          {Object.entries(footerSections).map(([key, section]) => (
            <div key={key}>
              <h4 className="text-[11px] font-bold tracking-widest text-white/40 uppercase mb-4">
                {section.title}
              </h4>
              <ul className="space-y-2 list-none p-0 m-0">
                {section.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] text-white/50 hover:text-white/90 no-underline transition-colors"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-[13px] text-white/50 hover:text-white/90 no-underline transition-colors"
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
          <p className="text-[13px] text-white/40">
            &copy; 2026 LokFeel Inc. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
