"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Check, Sparkles, Crown, Zap, Flower2, Shield, Eye,
  MessageCircle, Filter, Ghost, Heart, MapPin, RotateCcw,
  Award, ArrowRight, Lock, CreditCard, Loader2, AlertCircle,
} from "lucide-react";
import { CardVerificationWall } from "@/components/payment/CardVerificationWall";

// ─── Constants ───────────────────────────────────────────────
const MONTHLY_PRICE = 19.99;
const YEARLY_PRICE = 149.99;
const MONTHLY_EQUIVALENT = YEARLY_PRICE / 12;
const SAVINGS_PCT = ((MONTHLY_PRICE * 12 - YEARLY_PRICE) / (MONTHLY_PRICE * 12)) * 100;

// ─── Feature Lists ───────────────────────────────────────────
const ladyFreeFeatures = [
  { icon: Heart, text: "5 matches per week", highlight: true },
  { icon: MessageCircle, text: "Unlimited messages", highlight: true },
  { icon: Eye, text: "See who liked you" },
  { icon: Filter, text: "Advanced relationship filters" },
  { icon: Shield, text: "Full Vault Timer control", highlight: true },
  { icon: Sparkles, text: "Full match explanation" },
  { icon: Ghost, text: "Incognito mode" },
  { icon: Check, text: "Read receipts" },
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

// ─── Types ───────────────────────────────────────────────────
type PaymentStatus = {
  plan: string;
  isActive: boolean;
  isPremium: boolean;
  isLadyFree: boolean;
  isFemale: boolean;
  hasStripeCustomer: boolean;
  cardVerified: boolean;
  subscription: {
    id: string;
    plan: string;
    status: string;
    startsAt: string;
    endsAt: string | null;
    cancelledAt: string | null;
    stripeCurrentPeriodEnd: string | null;
  } | null;
  recentPayments: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    description: string;
    createdAt: string;
  }>;
};

// ─── Component ───────────────────────────────────────────────
export default function SubscriptionPage() {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("yearly");
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null);
  const [showManageModal, setShowManageModal] = useState(false);

  // ═══ Fetch payment status ═══
  const fetchPaymentStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/payments/status");
      if (res.ok) {
        const data = await res.json();
        if (data.data) {
          setPaymentStatus(data.data);
        }
      }
    } catch {
      // Silent fail — page still works without status
    }
  }, []);

  useEffect(() => {
    fetchPaymentStatus();
  }, [fetchPaymentStatus]);

  const isFemaleUser = paymentStatus?.isFemale ?? false;
  const isPremiumUser = paymentStatus?.isPremium ?? false;
  const isLadyFreeUser = paymentStatus?.isLadyFree ?? false;
  const isCancelled = paymentStatus?.subscription?.cancelledAt != null;
  const cardVerified = paymentStatus?.cardVerified ?? false;

  // ═══ Handle subscribe — redirect to Stripe Checkout ═══
  const handleSubscribe = async (plan: string) => {
    setError(null);
    setIsLoading(plan);

    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = data.message || data.error || "Failed to create checkout session";
        setError(msg);
        setIsLoading(null);
        return;
      }

      // Redirect to Stripe Checkout
      const checkoutUrl = data.data?.checkoutUrl;
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      } else {
        setError("No checkout URL received");
        setIsLoading(null);
      }
    } catch (err) {
      setError("Network error. Please try again.");
      setIsLoading(null);
    }
  };

  // ═══ Handle manage subscription — redirect to Stripe Portal ═══
  const handleManageSubscription = async () => {
    setIsLoading("portal");
    try {
      const res = await fetch("/api/payments/portal", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.data?.portalUrl) {
        window.location.href = data.data.portalUrl;
      } else {
        setError(data.message || "Failed to open billing portal");
        setIsLoading(null);
      }
    } catch {
      setError("Network error. Please try again.");
      setIsLoading(null);
    }
  };

  // ═══ Determine current plan label ═══
  const currentPlanLabel = isPremiumUser
    ? (paymentStatus?.subscription?.plan === "PREMIUM_YEARLY" ? "Premium Yearly" : "Premium Monthly")
    : isLadyFreeUser
      ? "Lady Free"
      : "Free";

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* ═══ Header ═══ */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          {isPremiumUser ? "You're Premium ✨" : "Upgrade Your Experience"}
        </h1>
        <p className="text-foreground-muted">
          {isPremiumUser
            ? isCancelled
              ? "Your subscription ends at the current period. Resubscribe anytime."
              : "You have full access to all premium features."
            : "Unlock premium features to find your perfect match faster"}
        </p>
      </div>

      {/* ═══ Error Banner ═══ */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/5">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-500">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">✕</button>
        </div>
      )}

      {/* ═══ Ladies Never Pay Banner ═══ */}
      {!isPremiumUser && (
        <div className="relative overflow-hidden rounded-2xl p-6 text-center"
          style={{ background: "linear-gradient(135deg, #4c1d95, #8b5cf6, #c084fc)" }}>
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: "radial-gradient(circle at 20% 80%, rgba(139, 92, 246, 0.3) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(76, 29, 149, 0.3) 0%, transparent 50%)" }} />
          <div className="relative">
            <Flower2 className="w-8 h-8 mx-auto mb-3 text-white" />
            <h2 className="text-xl font-bold text-white mb-1">Ladies Never Pay</h2>
            <p className="text-white/80 text-sm max-w-md mx-auto">
              Women get premium-level features completely free — because you deserve the best experience, always.
              {!cardVerified && " Card verification is required for safety."}
            </p>
          </div>
        </div>
      )}

      {/* ═══ Current Plan Card ═══ */}
      <div className="glass-card p-6 text-center">
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-background-tertiary flex items-center justify-center">
            {isPremiumUser ? (
              <Crown className="w-5 h-5 text-primary" />
            ) : isLadyFreeUser ? (
              <Flower2 className="w-5 h-5 text-primary" />
            ) : (
              <Sparkles className="w-5 h-5 text-foreground-muted" />
            )}
          </div>
          <div className="text-left">
            <p className="text-sm text-foreground-muted">Current Plan</p>
            <p className="text-xl font-bold text-foreground">{currentPlanLabel}</p>
          </div>
        </div>
        {isPremiumUser && paymentStatus?.subscription?.stripeCurrentPeriodEnd && (
          <p className="text-xs text-foreground-muted mt-2">
            {isCancelled ? "Access until" : "Renews on"}{" "}
            {new Date(paymentStatus.subscription.stripeCurrentPeriodEnd).toLocaleDateString("en-US", {
              year: "numeric", month: "long", day: "numeric",
            })}
          </p>
        )}
        {isLadyFreeUser && (
          <p className="text-sm text-primary mt-2 flex items-center justify-center gap-1">
            <Flower2 className="w-4 h-4" />
            You have premium-level access at no cost
          </p>
        )}
        {isPremiumUser && !isCancelled && (
          <button
            onClick={handleManageSubscription}
            disabled={isLoading === "portal"}
            className="mt-3 text-sm text-foreground-muted hover:text-foreground transition-colors flex items-center gap-1.5 mx-auto"
          >
            {isLoading === "portal" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CreditCard className="w-3.5 h-3.5" />
            )}
            Manage subscription
          </button>
        )}
        {isCancelled && (
          <button
            onClick={() => handleSubscribe("PREMIUM_MONTHLY")}
            className="mt-3 btn-primary text-sm px-6 py-2 inline-flex items-center gap-2"
          >
            <Zap className="w-4 h-4" />
            Resubscribe
          </button>
        )}
      </div>

      {/* ═══ Card Verification Required ═══ */}
      {!cardVerified && !isPremiumUser && (
        <div className="glass-card border-primary/30 p-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-secondary/5" />
          <div className="relative">
            <CardVerificationWall
              variant="inline"
              title={isLadyFreeUser ? "Verify Your Card to Continue" : "Card Verification Required"}
              description={
                isLadyFreeUser
                  ? "Your Lady Free plan is free forever! We just need to verify your identity with a card — no charges, ever."
                  : "Verify your card to keep using LokFee! after your free matches. Identity verification only — no charges."
              }
            />
          </div>
        </div>
      )}

      {/* ═══ Billing Toggle (only for non-premium, non-female) ═══ */}
      {!isPremiumUser && !isFemaleUser && (
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
                Save {SAVINGS_PCT.toFixed(0)}%
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ═══ Pricing Cards — Three Column ═══ */}
      <div className="grid md:grid-cols-3 gap-5">
        {/* ─── Basic Free ─── */}
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
            {basicFreeFeatures.map((f, i) => (
              <li key={i} className="flex items-center gap-2.5 text-xs text-foreground">
                <f.icon className="w-4 h-4 text-foreground-subtle flex-shrink-0" />
                {f.text}
              </li>
            ))}
          </ul>
          <button className="btn-secondary w-full text-sm opacity-50 cursor-not-allowed" disabled>
            {!isPremiumUser && !isLadyFreeUser ? "Current Plan" : "Downgrade"}
          </button>
        </div>

        {/* ─── Lady Free (Highlighted) ─── */}
        <div className="glass-card p-6 border-primary/50 relative overflow-hidden flex flex-col">
          <div className="absolute -inset-px bg-gradient-to-b from-primary via-secondary to-primary opacity-15 rounded-2xl" />
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-secondary/5 rounded-2xl" />
          <div className="absolute top-3 right-3 z-10">
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ background: "linear-gradient(135deg, #4c1d95, #8b5cf6)", color: "white" }}>
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
              {ladyFreeFeatures.map((f, i) => (
                <li key={i} className="flex items-center gap-2.5 text-xs text-foreground">
                  <f.icon className={`w-4 h-4 flex-shrink-0 ${f.highlight ? "text-primary" : "text-primary/60"}`} />
                  <span className={f.highlight ? "font-medium" : ""}>{f.text}</span>
                </li>
              ))}
            </ul>
            {isLadyFreeUser ? (
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

        {/* ─── Premium ─── */}
        <div className="glass-card p-6 border-primary/30 relative overflow-hidden flex flex-col">
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
                  ${billingCycle === "monthly" ? MONTHLY_PRICE.toFixed(2) : MONTHLY_EQUIVALENT.toFixed(2)}
                </span>
                <span className="text-foreground-muted text-sm">/month</span>
              </div>
              {billingCycle === "yearly" && (
                <p className="text-xs text-foreground-muted mt-1">
                  Billed ${YEARLY_PRICE.toFixed(2)} yearly
                </p>
              )}
            </div>
            <ul className="space-y-2.5 mb-6 flex-1">
              {premiumFeatures.map((f, i) => (
                <li key={i} className="flex items-center gap-2.5 text-xs text-foreground">
                  <f.icon className={`w-4 h-4 flex-shrink-0 ${f.highlight ? "text-secondary" : "text-primary/60"}`} />
                  <span className={f.highlight ? "font-medium" : ""}>{f.text}</span>
                </li>
              ))}
            </ul>
            {isPremiumUser ? (
              <div className="text-center text-sm text-primary font-medium py-2.5">
                ✨ Active
              </div>
            ) : (
              <button
                onClick={() => handleSubscribe(billingCycle === "monthly" ? "PREMIUM_MONTHLY" : "PREMIUM_YEARLY")}
                disabled={isLoading !== null || isFemaleUser}
                className="btn-primary w-full text-sm flex items-center justify-center gap-2 relative overflow-hidden group"
              >
                {isLoading === "PREMIUM_MONTHLY" || isLoading === "PREMIUM_YEARLY" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Redirecting to checkout...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 group-hover:hidden" />
                    <ArrowRight className="w-4 h-4 hidden group-hover:block" />
                    Upgrade to Premium
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Feature Comparison Table ═══ */}
      <div className="max-w-3xl mx-auto">
        <h2 className="text-lg font-semibold text-foreground mb-4 text-center">Full Feature Comparison</h2>
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border">
                <th className="text-left p-3 text-foreground-muted font-medium">Feature</th>
                <th className="text-center p-3 text-foreground-muted font-medium">Free</th>
                <th className="text-center p-3 font-medium" style={{ color: "#8b5cf6" }}>
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
                  ${billingCycle === "monthly" ? MONTHLY_PRICE.toFixed(2) : MONTHLY_EQUIVALENT.toFixed(2)}/mo
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ Trust Badges ═══ */}
      <div className="flex flex-wrap justify-center gap-6 text-center">
        {[
          { icon: Check, text: "Cancel anytime", color: "text-success" },
          { icon: Lock, text: "Secure payment via Stripe", color: "text-success" },
          { icon: Shield, text: "7-day refund guarantee", color: "text-success" },
          { icon: Flower2, text: "Women always free", color: "text-primary" },
          { icon: CreditCard, text: "Card verify only — no charges", color: "text-primary" },
        ].map((badge, i) => (
          <div key={i} className="flex items-center gap-2 text-foreground-subtle text-sm">
            <badge.icon className={`w-4 h-4 ${badge.color}`} />
            {badge.text}
          </div>
        ))}
      </div>

      {/* ═══ Recent Payments (for Premium users) ═══ */}
      {isPremiumUser && paymentStatus?.recentPayments && paymentStatus.recentPayments.length > 0 && (
        <div className="max-w-2xl mx-auto">
          <h2 className="text-lg font-semibold text-foreground mb-4 text-center">Payment History</h2>
          <div className="glass-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border">
                  <th className="text-left p-3 text-foreground-muted font-medium">Date</th>
                  <th className="text-left p-3 text-foreground-muted font-medium">Description</th>
                  <th className="text-right p-3 text-foreground-muted font-medium">Amount</th>
                  <th className="text-right p-3 text-foreground-muted font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {paymentStatus.recentPayments.map((p, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-background-tertiary/30" : ""}>
                    <td className="p-3 text-foreground">
                      {new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="p-3 text-foreground">{p.description}</td>
                    <td className="p-3 text-right text-foreground font-medium">
                      ${p.amount.toFixed(2)}
                    </td>
                    <td className="p-3 text-right">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        p.status === "SUCCEEDED" ? "bg-success/20 text-success" : "bg-red-500/20 text-red-500"
                      }`}>
                        {p.status === "SUCCEEDED" ? "Paid" : "Failed"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ FAQ ═══ */}
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
              a: "Yes, you can cancel your Premium subscription at any time. You'll retain premium access until the end of your billing period. No questions asked.",
            },
            {
              q: "What payment methods do you accept?",
              a: "We accept all major credit cards, debit cards, and Apple Pay / Google Pay through our secure payment provider, Stripe.",
            },
            {
              q: "Is there a refund policy?",
              a: "We offer a 7-day money-back guarantee. If you're not satisfied with Premium, contact us within 7 days for a full refund.",
            },
            {
              q: "How do I switch between monthly and yearly?",
              a: "You can switch billing cycles through the subscription management portal. The change takes effect at your next billing date.",
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
