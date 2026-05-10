"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Crown, Check, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Paywall, SubscriptionTier, SubscriptionCard } from "@/components/subscription/paywall";

// ══════════════════════════════════
// SUBSCRIPTION PAGE
// ══════════════════════════════════

const TIERS = [
  SubscriptionTier.FREE,
  SubscriptionTier.PLUS,
  SubscriptionTier.PREMIUM,
  SubscriptionTier.FOUNDER,
];

export default function SubscriptionPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const currentTier = (session?.user as any)?.subscriptionTier || SubscriptionTier.FREE;

  const handleSelectTier = async (tier: SubscriptionTier) => {
    if (tier === SubscriptionTier.FREE) {
      // Can't "upgrade" to free
      return;
    }

    setSelectedTier(tier);
    setIsLoading(true);

    try {
      // Call Stripe Checkout
      const res = await fetch("/api/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });

      if (!res.ok) throw new Error("Failed to create checkout session");

      const { url } = await res.json();
      window.location.href = url; // Redirect to Stripe
    } catch (error) {
      console.error("Checkout error:", error);
      alert("Failed to start checkout. Please try again.");
      setIsLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!session) {
    router.push("/login");
    return null;
  }

  return (
    <div className="min-h-screen py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto mb-6">
            <Crown className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-foreground mb-3">
            Choose Your Plan
          </h1>
          <p className="text-foreground-muted text-lg max-w-2xl mx-auto">
            Unlock premium features and accelerate your dating journey
          </p>
        </div>

        {/* Current Tier Badge */}
        <div className="text-center mb-8">
          <Badge variant="outline" className="text-sm px-4 py-1">
            Current Plan: <span className="text-primary font-bold ml-1">{currentTier}</span>
          </Badge>
        </div>

        {/* Tier Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {TIERS.map((tier) => (
            <SubscriptionCard
              key={tier}
              tier={tier}
              currentTier={currentTier}
              onSelect={handleSelectTier}
            />
          ))}
        </div>

        {/* Feature Comparison Table */}
        <Card className="bg-[#111111] border-white/5 overflow-hidden">
          <div className="p-6 border-b border-white/5">
            <h2 className="text-xl font-bold text-foreground">Feature Comparison</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left p-4 text-sm font-medium text-foreground-muted">Feature</th>
                  {TIERS.map((tier) => (
                    <th key={tier} className="text-center p-4 text-sm font-medium text-foreground-muted">
                      {tier}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURE_ROWS.map((row, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-4 text-sm text-foreground">{row.feature}</td>
                    {TIERS.map((tier) => (
                      <td key={tier} className="p-4 text-center">
                        {row.access[tier] ? (
                          <Check className="w-5 h-5 text-green-500 mx-auto" />
                        ) : (
                          <X className="w-5 h-5 text-foreground-faint mx-auto" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* FAQ Section */}
        <div className="mt-12 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-foreground mb-6 text-center">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4">
            {FAQS.map((faq, i) => (
              <Card key={i} className="bg-[#111111] border-white/5">
                <CardHeader>
                  <CardTitle className="text-base text-foreground">{faq.q}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground-muted">{faq.a}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════
// FEATURE COMPARISON DATA
// ══════════════════════════════════

const FEATURE_ROWS = [
  {
    feature: "Matches per week",
    access: {
      [SubscriptionTier.FREE]: true,
      [SubscriptionTier.PLUS]: true,
      [SubscriptionTier.PREMIUM]: true,
      [SubscriptionTier.FOUNDER]: true,
    },
    values: {
      [SubscriptionTier.FREE]: "5",
      [SubscriptionTier.PLUS]: "20",
      [SubscriptionTier.PREMIUM]: "∞",
      [SubscriptionTier.FOUNDER]: "∞",
    },
  },
  {
    feature: "Who likes me",
    access: {
      [SubscriptionTier.FREE]: false,
      [SubscriptionTier.PLUS]: true,
      [SubscriptionTier.PREMIUM]: true,
      [SubscriptionTier.FOUNDER]: true,
    },
  },
  {
    feature: "Advanced filters",
    access: {
      [SubscriptionTier.FREE]: false,
      [SubscriptionTier.PLUS]: true,
      [SubscriptionTier.PREMIUM]: true,
      [SubscriptionTier.FOUNDER]: true,
    },
  },
  {
    feature: "Vault extend",
    access: {
      [SubscriptionTier.FREE]: false,
      [SubscriptionTier.PLUS]: false,
      [SubscriptionTier.PREMIUM]: true,
      [SubscriptionTier.FOUNDER]: true,
    },
  },
  {
    feature: "Priority showcase",
    access: {
      [SubscriptionTier.FREE]: false,
      [SubscriptionTier.PLUS]: false,
      [SubscriptionTier.PREMIUM]: true,
      [SubscriptionTier.FOUNDER]: true,
    },
  },
  {
    feature: "Read receipts",
    access: {
      [SubscriptionTier.FREE]: false,
      [SubscriptionTier.PLUS]: false,
      [SubscriptionTier.PREMIUM]: true,
      [SubscriptionTier.FOUNDER]: true,
    },
  },
  {
    feature: "Incognito mode",
    access: {
      [SubscriptionTier.FREE]: false,
      [SubscriptionTier.PLUS]: false,
      [SubscriptionTier.PREMIUM]: true,
      [SubscriptionTier.FOUNDER]: true,
    },
  },
  {
    feature: "Founder badge",
    access: {
      [SubscriptionTier.FREE]: false,
      [SubscriptionTier.PLUS]: false,
      [SubscriptionTier.PREMIUM]: false,
      [SubscriptionTier.FOUNDER]: true,
    },
  },
];

// ══════════════════════════════════
// FAQ DATA
// ══════════════════════════════════

const FAQS = [
  {
    q: "Can I cancel my subscription anytime?",
    a: "Yes, you can cancel your subscription at any time. You'll continue to have access until the end of your billing period.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major credit cards (Visa, Mastercard, Amex) and PayPal through our secure payment processor, Stripe.",
  },
  {
    q: "Is my payment information secure?",
    a: "Absolutely. We use Stripe, a globally trusted payment processor. We never store your credit card information on our servers.",
  },
  {
    q: "What is the Founder tier?",
    a: "Founder tier is a limited-time offer for early adopters. It gives you lifetime access to all premium features at a one-time cost. Only 500 spots available.",
  },
  {
    q: "Can I change my plan later?",
    a: "Yes, you can upgrade or downgrade your plan at any time. If you upgrade, you'll be charged the prorated amount for the remainder of the month.",
  },
];
