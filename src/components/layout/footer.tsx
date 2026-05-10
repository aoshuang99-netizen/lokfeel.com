import Link from "next/link";
import { Github, Twitter, Instagram } from "lucide-react";

const footerSections = {
  COMPANY: {
    title: "COMPANY",
    links: [
      { label: "About Us", href: "/about" },
      { label: "Careers", href: "/careers" },
      { label: "Press", href: "/press" },
      { label: "Ad Choices", href: "/ad-choices" },
    ],
  },
  CONDITIONS: {
    title: "CONDITIONS",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Cookies – Manage preferences", href: "/cookies" },
      { label: "Terms", href: "/terms" },
      { label: "Community Guidelines", href: "/community-guidelines" },
      { label: "Consumer Health Data Privacy Policy", href: "/privacy#health-data" },
      { label: "Colorado Safety Policy Information", href: "/safety#colorado" },
    ],
  },
  CONTACT: {
    title: "CONTACT",
    links: [
      { label: "Support", href: "/support" },
      { label: "Security", href: "/support#security" },
      { label: "Safety Tips", href: "/safety-tips" },
      { label: "Impressum", href: "/impressum" },
      { label: "Accessibility", href: "/accessibility" },
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
              <ul className="space-y-2.5 list-none p-0 m-0">
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
              <Github size={16} />
            </a>
            <a
              href="https://twitter.com/lokfee"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/40 hover:text-white/80 transition-colors"
            >
              <Twitter size={16} />
            </a>
            <a
              href="https://instagram.com/lokfee"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/40 hover:text-white/80 transition-colors"
            >
              <Instagram size={16} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
