import Link from "next/link";

const footerSections = {
  COMPANY: {
    title: "COMPANY",
    links: [
      { label: "About Us", href: "/about", external: false },
      { label: "Careers", href: "/careers", external: false },
      { label: "Press", href: "/press", external: false },
      { label: "Ad Choices", href: "/ad-choices", external: false },
    ],
  },
  CONDITIONS: {
    title: "CONDITIONS",
    links: [
      { label: "Privacy", href: "/privacy", external: false },
      { label: "Cookies – Manage preferences", href: "/cookies", external: false },
      { label: "Terms", href: "/terms", external: false },
      { label: "Community Guidelines", href: "/community-guidelines", external: false },
      { label: "Consumer Health Data Privacy Policy", href: "/privacy#health-data", external: false },
      { label: "Colorado Safety Policy Information", href: "/safety#colorado", external: false },
    ],
  },
  CONTACT: {
    title: "CONTACT",
    links: [
      { label: "Support", href: "/support", external: false },
      { label: "Security", href: "/support#security", external: false },
      { label: "Safety Tips", href: "/safety-tips", external: false },
      { label: "Impressum", href: "/impressum", external: false },
      { label: "Accessibility", href: "/accessibility", external: false },
    ],
  },
  FOLLOW: {
    title: "FOLLOW",
    links: [
      { label: "Blog", href: "https://blog.lokfee.com", external: true },
      { label: "Tech Blog", href: "https://tech.lokfee.com", external: true },
      { label: "Facebook", href: "https://facebook.com/lokfee", external: true },
      { label: "Instagram", href: "https://instagram.com/lokfee", external: true },
      { label: "Twitter / X", href: "https://twitter.com/lokfee", external: true },
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

        {/* Bottom bar */}
        <div className="pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[13px] text-white/40">
            &copy; 2026 LokFee!. Join the movement.
          </p>
          <div className="flex items-center gap-5">
            <a
              href="https://facebook.com/lokfee"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/40 hover:text-white/80 transition-colors"
            >
            {/* Github SVG icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
            </a>
            <a
              href="https://twitter.com/lokfee"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/40 hover:text-white/80 transition-colors"
            >
              {/* X (Twitter) SVG icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
            <a
              href="https://instagram.com/lokfee"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/40 hover:text-white/80 transition-colors"
            >
              {/* Instagram SVG icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
