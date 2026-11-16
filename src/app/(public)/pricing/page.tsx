import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { PRICING_APPROVED } from '@/config/pricing-gate';
import { displayPrice, getProduct } from '@/config/products';
import { readCheckoutGate } from '@/lib/payments/commercial-gate';

// Pricing is not published until D1 is approved (§F / §J V22-G10), so metadata
// carries no price, plan name, discount, trial period or schema.org offer.
export const metadata: Metadata = {
  title: 'Pricing · LokFeel',
  description: 'LokFeel pricing is not published yet. Contact us for details.',
};

/**
 * /pricing — fail closed by default (DEV07).
 *
 * PRICING_APPROVED (src/config/pricing-gate.ts) is the explicit D1 switch: it
 * stays false until the Owner approves D1 pricing. The existing commercial gate
 * is kept as an additional required condition, not as the approval source.
 * While closed, this server component renders English "not published" copy, a
 * /contact link, and nothing else — no amounts, plans, discounts, trial days,
 * subscribe CTAs, or the three product lines.
 */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  // Keep the async RSC contract (server component with awaited searchParams).
  await searchParams;

  const gate = readCheckoutGate();
  // Widen the literal gate to boolean so the published branch stays reachable.
  const pricingPublished: boolean =
    PRICING_APPROVED && gate.commercialApproved && gate.enabled;
  const approvedPrice = pricingPublished
    ? displayPrice(getProduct('connection-os'))
    : null;

  return (
    // Accessibility: this page has no own nav/footer, so <main> is the landmark.
    <main className="pt-24 pb-20">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {pricingPublished ? (
          <>
            <p className="text-sm uppercase tracking-widest text-foreground-muted mb-3">
              LokFeel
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">
              Pricing
            </h1>
            {approvedPrice && (
              <p className="text-2xl font-semibold text-foreground">{approvedPrice}</p>
            )}
            <p className="text-foreground-muted leading-relaxed mt-4">
              Contact us to discuss a plan that fits your needs.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">
              Pricing is not published yet
            </h1>
            <p className="text-foreground-muted leading-relaxed">
              LokFeel has not published pricing yet; commercial terms are shared only after they are reviewed and approved.
            </p>
          </>
        )}
        <p className="mt-8">
          <Link
            href="/contact"
            className="inline-flex min-h-6 items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            Contact us
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </p>
      </div>
    </main>
  );
}
