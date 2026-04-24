"use client";

import { useState, useEffect } from "react";
import { Check, Sparkles, Crown, Zap, Flower2, Shield, Eye, MessageCircle, Filter, Ghost, Heart, MapPin, RotateCcw, Award } from "lucide-react";

// ─── Plan Features ─────────────────────────────────────────────────
const ladyFreeFeatures = [
  { icon: Heart, text: "5 matches per week", highlight: true },
  { icon: MessageCircle, text: "Unlimited messages", highlight: true },
  { icon: Eye, text: "See who liked you", highlight: false },
  { icon: Filter, text: "Advanced relationship filters", highlight: false },
  { icon: Shield, text: "Full Vault Timer control", highlight: true },
  { icon: Sparkles, text: "Full match explanation", highlight: false },
  { icon: Ghost, text: "Incognito mode", highlight: false },
  { icon: Check, text: "Read receipts", highlight: false },
];

const basicFreeFeatures = [
  { icon: Heart, text: "3 matches per week" },
  { icon: MessageCircle, text: "2 messages per match" },
  { icon: Sparkles, text: "Basic match score" },
  { icon: Shield, text: "View-only Vault access" },
];

const premiumFeatures = [
  { icon: Heart, text: "5 matches per week" },
  { icon: MessageCircle, text: "Unlimited messages" },
  { icon: Eye, text: "See who liked you" },
  { icon: Filter, text: "Advanced relationship filters" },
  { icon: Sparkles, text: "Full match explanation" },
  { icon: Ghost, text: "Incognito mode" },
  { icon: Check, text: "Read receipts" },
  { icon: Zap, text: "Priority matching", highlight: true },
  { icon: MapPin, text: "Travel mode", highlight: true },
  { icon: RotateCcw, text: "Rematch expired matches", highlight: true },
  { icon: Award, text: "Premium badge", highlight: true },
];

export default function SubscriptionPage() {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("yearly");
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [userGender, setUserGender] = useState<"woman" | "man" | "other" | null>(null);

  const monthlyPrice = 19.99;
  const yearlyPrice = 149.99;
  const monthlyEquivalent = yearlyPrice / 12;
  const savings = ((monthlyPrice * 12 - yearlyPrice) / (monthlyPrice * 12)) * 100;

  // Detect user gender
  useEffect(() => {
    async function detectGender() {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json();
          const gender = data?.user?.gender?.toLowerCase();
          if (gender === "woman" || gender === "female" || gender === "trans_woman") {
            setUserGender("woman");
          } else if (gender === "man" || gender === "male" || gender === "trans_man") {
            setUserGender("man");
          } else {
            setUserGender("other");
          }
        }
      } catch {
        setUserGender(null);
      }
    }
    detectGender();
  }, []);

  const isFemaleUser = userGender === "woman";

  const handleSubscribe = async (plan: string) => {
    setIsLoading(plan);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    alert(`Would redirect to Stripe Checkout for ${plan} plan`);
    setIsLoading(null);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground mb-2">Upgrade Your Experience</h1>
        <p className="text-foreground-muted">Unlock premium features to find your perfect match faster</p>
      </div>

      {/* Ladies First Banner */}
      <div className="relative overflow-hidden rounded-2xl p-6 text-center"
        style={{ background: "linear-gradient(135deg, oklch(68% .14 40), oklch(72% .12 20), oklch(75% .12 350))" }}>
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "radial-gradient(circle at 20% 80%, oklch(80% .15 350) 0%, transparent 50%), radial-gradient(circle at 80% 20%, oklch(75% .14 40) 0%, transparent 50%)" }} />
        <div className="relative">
          <Flower2 className="w-8 h-8 mx-auto mb-3 text-white" />
          <h2 className="text-xl font-bold text-white mb-1">Ladies Never Pay</h2>
          <p className="text-white/80 text-sm max-w-md mx-auto">
            Women get premium-level features completely free — because you deserve the best experience, always.
          </p>
        </div>
      </div>

      {/* Current Plan Banner */}
      <div className="glass-card p-6 text-center">
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-background-tertiary flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-foreground-muted" />
          </div>
          <div>
            <p className="text-sm text-foreground-muted">Current Plan</p>
            <p className="text-xl font-bold text-foreground">
              {isFemaleUser ? "Lady Free" : "Free"}
            </p>
          </div>
        </div>
        {isFemaleUser && (
          <p className="text-sm text-primary mt-2 flex items-center justify-center gap-1">
            <Flower2 className="w-4 h-4" />
            You have premium-level access at no cost
          </p>
        )}
      </div>

      {/* Billing Toggle */}
      {!isFemaleUser && (
        <div className="flex justify-center">
          <div className="glass-card p-1 inline-flex">
            <button
              onClick={() => setBillingCycle("monthly")}
              className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${
                billingCycle === "monthly"
                  ? "bg-gradient-to-r from-primary to-secondary text-foreground"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle("yearly")}
              className={`px-6 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                billingCycle === "yearly"
                  ? "bg-gradient-to-r from-primary to-secondary text-foreground"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              Yearly
              <span className="text-xs bg-success/20 text-success px-2 py-0.5 rounded-full">
                Save {savings.toFixed(0)}%
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Pricing Cards — Three Column */}
      <div className="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
        {/* Basic Free — Left */}
        <div className="glass-card p-6 flex flex-col">
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-foreground mb-1">Free</h3>
            <p className="text-foreground-muted text-xs">Get started with basics</p>
          </div>

          <div className="mb-5">
            <span className="text-3xl font-bold text-foreground">$0</span>
            <span className="text-foreground-muted text-sm">/month</span>
          </div>

          <ul className="space-y-2.5 mb-6 flex-1">
            {basicFreeFeatures.map((feature, idx) => (
              <li key={idx} className="flex items-center gap-2.5 text-xs text-foreground">
                <feature.icon className="w-4 h-4 text-foreground-subtle flex-shrink-0" />
                {feature.text}
              </li>
            ))}
          </ul>

          <button className="btn-secondary w-full text-sm" disabled>
            Current Plan
          </button>
        </div>

        {/* Lady Free — Center (Highlighted) */}
        <div className="glass-card p-6 border-primary/50 relative overflow-hidden flex flex-col">
          {/* Glow Effect */}
          <div className="absolute -inset-px bg-gradient-to-b from-primary via-secondary to-primary opacity-15 rounded-2xl" />
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-secondary/5 rounded-2xl" />

          {/* Badge */}
          <div className="absolute top-3 right-3 z-10">
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ background: "linear-gradient(135deg, oklch(68% .14 40), oklch(72% .12 20))", color: "white" }}>
              <Flower2 className="w-3 h-3" />
              Women Only
            </span>
          </div>

          <div className="relative flex flex-col flex-1">
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-1">
                <Flower2 className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Lady Free</h3>
              </div>
              <p className="text-foreground-muted text-xs">Premium features, zero cost</p>
            </div>

            <div className="mb-5">
              <span className="text-3xl font-bold text-foreground">$0</span>
              <span className="text-foreground-muted text-sm">/forever</span>
            </div>

            <ul className="space-y-2.5 mb-6 flex-1">
              {ladyFreeFeatures.map((feature, idx) => (
                <li key={idx} className="flex items-center gap-2.5 text-xs text-foreground">
                  <feature.icon className={`w-4 h-4 flex-shrink-0 ${feature.highlight ? "text-primary" : "text-primary/60"}`} />
                  <span className={feature.highlight ? "font-medium" : ""}>{feature.text}</span>
                </li>
              ))}
            </ul>

            {isFemaleUser ? (
              <div className="btn-primary w-full text-sm text-center py-2.5 flex items-center justify-center gap-2 opacity-80 cursor-default">
                <Flower2 className="w-4 h-4" />
                You&apos;re All Set!
              </div>
            ) : (
              <div className="text-center text-xs text-foreground-subtle py-2.5 rounded-lg border border-card-border">
                Available for women only
              </div>
            )}
          </div>
        </div>

        {/* Premium — Right */}
        <div className="glass-card p-6 border-primary/30 relative overflow-hidden flex flex-col">
          {/* Popular Badge */}
          <div className="absolute top-3 right-3 z-10">
            <span className="badge badge-primary flex items-center gap-1 text-xs">
              <Crown className="w-3 h-3" />
              Best Value
            </span>
          </div>

          <div className="relative flex flex-col flex-1">
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-1">
                <Crown className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Premium</h3>
              </div>
              <p className="text-foreground-muted text-xs">Full power for serious seekers</p>
            </div>

            <div className="mb-5">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-foreground">
                  ${billingCycle === "monthly" ? monthlyPrice.toFixed(2) : monthlyEquivalent.toFixed(2)}
                </span>
                <span className="text-foreground-muted text-sm">/month</span>
              </div>
              {billingCycle === "yearly" && (
                <p className="text-xs text-foreground-muted mt-1">
                  Billed ${yearlyPrice.toFixed(2)} yearly
                </p>
              )}
            </div>

            <ul className="space-y-2.5 mb-6 flex-1">
              {premiumFeatures.map((feature, idx) => (
                <li key={idx} className="flex items-center gap-2.5 text-xs text-foreground">
                  <feature.icon className={`w-4 h-4 flex-shrink-0 ${feature.highlight ? "text-secondary" : "text-primary/60"}`} />
                  <span className={feature.highlight ? "font-medium" : ""}>{feature.text}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleSubscribe("premium")}
              disabled={isLoading !== null}
              className="btn-primary w-full text-sm flex items-center justify-center gap-2"
            >
              {isLoading === "premium" ? (
                <>
                  <span className="w-4 h-4 border-2 border-card-border border-t-foreground rounded-full animate-spin" />
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

      {/* Feature Comparison Table */}
      <div className="max-w-3xl mx-auto">
        <h2 className="text-lg font-semibold text-foreground mb-4 text-center">Full Feature Comparison</h2>
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border">
                <th className="text-left p-3 text-foreground-muted font-medium">Feature</th>
                <th className="text-center p-3 text-foreground-muted font-medium">Free</th>
                <th className="text-center p-3 font-medium" style={{ color: "oklch(68% .14 40)" }}>
                  <span className="flex items-center justify-center gap-1"><Flower2 className="w-3.5 h-3.5" /> Lady Free</span>
                </th>
                <th className="text-center p-3 text-foreground-muted font-medium">Premium</th>
              </tr>
            </thead>
            <tbody>
              {[
                { feature: "Weekly matches", free: "3", lady: "5", premium: "5" },
                { feature: "Messages per match", free: "2", lady: "Unlimited", premium: "Unlimited" },
                { feature: "See who liked you", free: "—", lady: "✓", premium: "✓" },
                { feature: "Advanced filters", free: "—", lady: "✓", premium: "✓" },
                { feature: "Match explanation", free: "Basic", lady: "Full", premium: "Full" },
                { feature: "Read receipts", free: "—", lady: "✓", premium: "✓" },
                { feature: "Vault Timer control", free: "View only", lady: "Full control", premium: "View only" },
                { feature: "Incognito mode", free: "—", lady: "✓", premium: "✓" },
                { feature: "Priority matching", free: "—", lady: "—", premium: "✓" },
                { feature: "Travel mode", free: "—", lady: "—", premium: "✓" },
                { feature: "Rematch", free: "—", lady: "—", premium: "✓" },
                { feature: "Premium badge", free: "—", lady: "—", premium: "✓" },
              ].map((row, idx) => (
                <tr key={idx} className={idx % 2 === 0 ? "bg-background-tertiary/30" : ""}>
                  <td className="p-3 text-foreground">{row.feature}</td>
                  <td className="p-3 text-center text-foreground-subtle">{row.free}</td>
                  <td className="p-3 text-center font-medium text-primary">{row.lady}</td>
                  <td className="p-3 text-center text-foreground">{row.premium}</td>
                </tr>
              ))}
              <tr className="border-t border-card-border">
                <td className="p-3 font-semibold text-foreground">Price</td>
                <td className="p-3 text-center font-bold text-foreground">$0</td>
                <td className="p-3 text-center font-bold text-primary">$0</td>
                <td className="p-3 text-center font-bold text-foreground">
                  ${billingCycle === "monthly" ? monthlyPrice.toFixed(2) : monthlyEquivalent.toFixed(2)}/mo
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Trust Badges */}
      <div className="flex flex-wrap justify-center gap-6 text-center">
        <div className="flex items-center gap-2 text-foreground-subtle text-sm">
          <Check className="w-4 h-4 text-success" />
          Cancel anytime
        </div>
        <div className="flex items-center gap-2 text-foreground-subtle text-sm">
          <Check className="w-4 h-4 text-success" />
          Secure payment via Stripe
        </div>
        <div className="flex items-center gap-2 text-foreground-subtle text-sm">
          <Check className="w-4 h-4 text-success" />
          7-day refund guarantee
        </div>
        <div className="flex items-center gap-2 text-foreground-subtle text-sm">
          <Flower2 className="w-4 h-4 text-primary" />
          Women always free
        </div>
      </div>

      {/* FAQ */}
      <div className="max-w-2xl mx-auto">
        <h2 className="text-lg font-semibold text-foreground mb-4 text-center">Frequently Asked Questions</h2>
        <div className="space-y-4">
          {[
            {
              q: "Why is Lady Free only for women?",
              a: "We believe women should have full access to safety and control features without any paywall. This also creates a healthier community where women feel valued and empowered.",
            },
            {
              q: "Can I cancel anytime?",
              a: "Yes, you can cancel your Premium subscription at any time. You'll retain premium access until the end of your billing period.",
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
              <h4 className="font-medium text-foreground mb-2">{faq.q}</h4>
              <p className="text-sm text-foreground-muted">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
