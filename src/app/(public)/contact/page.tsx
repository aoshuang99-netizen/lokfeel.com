import { Metadata } from "next";
import Link from "next/link";
import { Mail, Globe, Lock, TriangleAlert } from "lucide-react";

export const metadata: Metadata = {
  title: "Contact Us - LokFeel",
  description:
    "Contact details are being verified. We make no response-time promise and publish no mailing address until the channels are confirmed.",
};

const boundaryText =
  "LokFeel is in a controlled rollout. Today you can state a goal, review the steps, decide what needs your approval, and keep an in-app record of what happened. Not live yet: actions carried out inside external apps, automatic execution across other tools, and independent confirmation that a result was achieved outside LokFeel. We do not present any of those as available.";

const emails = [
  { address: "hello@lokfeel.com", listed: "general questions" },
  { address: "support@lokfeel.com", listed: "account and technical help" },
  { address: "billing@lokfeel.com", listed: "payments and subscriptions" },
  { address: "legal@lokfeel.com", listed: "legal matters" },
  { address: "privacy@lokfeel.com", listed: "privacy requests" },
  { address: "dmca@lokfeel.com", listed: "copyright notices" },
];

const socials = [
  { name: "Twitter / X", handle: "@lokfeel", href: "https://twitter.com/lokfeel" },
  { name: "Instagram", handle: "@lokfeel", href: "https://instagram.com/lokfeel" },
];

export default function ContactPage() {
  return (
    <div className="pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
            <Mail className="w-8 h-8 text-primary" aria-hidden />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">Contact</h1>
          <p className="text-xl text-foreground-muted">Contact details are under review.</p>
        </div>

        {/* Verification notice — visible in the first screen, not a footer disclaimer */}
        <div
          role="note"
          aria-label="Contact detail verification"
          className="glass-card border-primary/30 p-6 mb-8"
        >
          <div className="flex items-start gap-3">
            <TriangleAlert className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden />
            <div>
              <h2 className="text-base font-semibold text-foreground mb-2">
                Contact details are under review.
              </h2>
              <p className="text-sm text-foreground-muted leading-relaxed">
                We are confirming which of the addresses below are actually monitored. Until that
                is done, we make no promise about response times, and we do not publish a mailing
                address or company details here. Please treat the addresses below as not yet
                confirmed and do not rely on a reply.
              </p>
            </div>
          </div>
        </div>

        <div className="glass-card p-8 lg:p-12 space-y-10">
          {/* Email channels */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" aria-hidden />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Channels currently listed</h2>
            </div>
            <p className="text-sm text-foreground-muted leading-relaxed mb-4">
              These addresses have appeared on this site. We are confirming which of them are
              monitored; none is presented as a guaranteed way to reach us.
            </p>
            <ul className="space-y-2">
              {emails.map((item) => (
                <li
                  key={item.address}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-[44px]"
                >
                  <a
                    href={`mailto:${item.address}`}
                    className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary hover:underline"
                  >
                    {item.address}
                  </a>
                  <span className="text-sm text-foreground-subtle">listed for {item.listed}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Social channels */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center">
                <Globe className="w-5 h-5 text-secondary" aria-hidden />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Social channels currently listed</h2>
            </div>
            <div className="flex flex-wrap gap-4">
              {socials.map((social) => (
                <a
                  key={social.name}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-foreground hover:border-primary/50"
                >
                  {social.name}
                  <span className="text-foreground-muted">{social.handle}</span>
                </a>
              ))}
            </div>
          </section>

          {/* Product capability boundary */}
          <section>
            <div
              role="note"
              aria-label="Current capability boundary"
              className="rounded-lg border border-white/10 p-6"
            >
              <div className="flex items-center gap-3 mb-2">
                <Lock className="w-5 h-5 text-primary shrink-0" aria-hidden />
                <h2 className="text-base font-semibold text-foreground">Where things stand today</h2>
              </div>
              <p className="text-sm text-foreground-muted leading-relaxed">{boundaryText}</p>
            </div>
          </section>
        </div>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <Link href="/" className="btn-ghost min-h-[44px]">
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
