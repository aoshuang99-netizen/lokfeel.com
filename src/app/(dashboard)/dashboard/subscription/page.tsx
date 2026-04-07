"use client";

import { useState } from "react";
import { Check, Sparkles, Crown, Zap } from "lucide-react";

const freeFeatures = [
  "5 matches per week",
  "Basic profile",
  "Message with accepted matches",
  "View match explanations",
  "Basic filters",
];

const premiumFeatures = [
  "Unlimited matches",
  "Priority matching",
  "Full profile access",
  "Advanced filters",
  "Read receipts",
  "Unlimited messages",
  "See who liked you",
  "Travel mode",
  "Incognito mode",
];

export default function SubscriptionPage() {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("yearly");
  const [isLoading, setIsLoading] = useState<string | null>(null);

  const monthlyPrice = 9.99;
  const yearlyPrice = 79.99;
  const monthlyEquivalent = yearlyPrice / 12;
  const savings = ((monthlyPrice * 12 - yearlyPrice) / (monthlyPrice * 12)) * 100;

  const handleSubscribe = async (plan: string) => {
    setIsLoading(plan);
    // Simulate Stripe checkout
    await new Promise((resolve) => setTimeout(resolve, 2000));
    // In production, redirect to Stripe Checkout
    alert(`Would redirect to Stripe Checkout for ${plan} plan`);
    setIsLoading(null);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white mb-2">Upgrade Your Experience</h1>
        <p className="text-white/60">Unlock premium features to find your perfect match faster</p>
      </div>

      {/* Current Plan Banner */}
      <div className="glass-card p-6 text-center">
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white/60" />
          </div>
          <div>
            <p className="text-sm text-white/60">Current Plan</p>
            <p className="text-xl font-bold text-white">Free</p>
          </div>
        </div>
      </div>

      {/* Billing Toggle */}
      <div className="flex justify-center">
        <div className="glass-card p-1 inline-flex">
          <button
            onClick={() => setBillingCycle("monthly")}
            className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${
              billingCycle === "monthly"
                ? "bg-gradient-to-r from-primary to-secondary text-white"
                : "text-white/60 hover:text-white"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle("yearly")}
            className={`px-6 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
              billingCycle === "yearly"
                ? "bg-gradient-to-r from-primary to-secondary text-white"
                : "text-white/60 hover:text-white"
            }`}
          >
            Yearly
            <span className="text-xs bg-success/20 text-success px-2 py-0.5 rounded-full">
              Save {savings.toFixed(0)}%
            </span>
          </button>
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {/* Free Plan */}
        <div className="glass-card p-8">
          <div className="mb-6">
            <h3 className="text-xl font-semibold text-white mb-2">Free</h3>
            <p className="text-white/60 text-sm">Get started with basic features</p>
          </div>

          <div className="mb-6">
            <span className="text-4xl font-bold text-white">$0</span>
            <span className="text-white/60">/month</span>
          </div>

          <ul className="space-y-3 mb-8">
            {freeFeatures.map((feature, idx) => (
              <li key={idx} className="flex items-center gap-3 text-sm text-white/80">
                <Check className="w-5 h-5 text-success flex-shrink-0" />
                {feature}
              </li>
            ))}
          </ul>

          <button className="btn-secondary w-full" disabled>
            Current Plan
          </button>
        </div>

        {/* Premium Plan */}
        <div className="glass-card p-8 border-primary/50 relative overflow-hidden">
          {/* Popular Badge */}
          <div className="absolute top-4 right-4">
            <span className="badge badge-primary flex items-center gap-1">
              <Crown className="w-3 h-3" />
              Most Popular
            </span>
          </div>

          {/* Glow Effect */}
          <div className="absolute -inset-px bg-gradient-to-r from-primary via-secondary to-primary opacity-20 rounded-2xl" />
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-secondary/10 rounded-2xl" />

          <div className="relative">
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Crown className="w-6 h-6 text-primary" />
                <h3 className="text-xl font-semibold text-white">Premium</h3>
              </div>
              <p className="text-white/60 text-sm">Everything you need for meaningful connections</p>
            </div>

            <div className="mb-6">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-white">
                  ${billingCycle === "monthly" ? monthlyPrice.toFixed(2) : monthlyEquivalent.toFixed(2)}
                </span>
                <span className="text-white/60">/month</span>
              </div>
              {billingCycle === "yearly" && (
                <p className="text-sm text-white/60 mt-1">
                  Billed ${yearlyPrice.toFixed(2)} yearly
                </p>
              )}
            </div>

            <ul className="space-y-3 mb-8">
              {premiumFeatures.map((feature, idx) => (
                <li key={idx} className="flex items-center gap-3 text-sm text-white/80">
                  <Check className="w-5 h-5 text-primary flex-shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleSubscribe("premium")}
              disabled={isLoading !== null}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {isLoading === "premium" ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Upgrade to Premium
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Trust Badges */}
      <div className="flex flex-wrap justify-center gap-6 text-center">
        <div className="flex items-center gap-2 text-white/40 text-sm">
          <Check className="w-4 h-4 text-success" />
          Cancel anytime
        </div>
        <div className="flex items-center gap-2 text-white/40 text-sm">
          <Check className="w-4 h-4 text-success" />
          Secure payment via Stripe
        </div>
        <div className="flex items-center gap-2 text-white/40 text-sm">
          <Check className="w-4 h-4 text-success" />
          7-day refund guarantee
        </div>
      </div>

      {/* FAQ */}
      <div className="max-w-2xl mx-auto">
        <h2 className="text-lg font-semibold text-white mb-4 text-center">Frequently Asked Questions</h2>
        <div className="space-y-4">
          {[
            {
              q: "Can I cancel anytime?",
              a: "Yes, you can cancel your subscription at any time. You'll retain premium access until the end of your billing period.",
            },
            {
              q: "What payment methods do you accept?",
              a: "We accept all major credit cards, debit cards, and PayPal through our secure payment provider, Stripe.",
            },
            {
              q: "Is there a refund policy?",
              a: "We offer a 7-day money-back guarantee. If you're not satisfied with Premium, contact us within 7 days for a full refund.",
            },
          ].map((faq, idx) => (
            <div key={idx} className="glass-card p-4">
              <h4 className="font-medium text-white mb-2">{faq.q}</h4>
              <p className="text-sm text-white/60">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
