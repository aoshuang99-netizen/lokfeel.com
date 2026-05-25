"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Crown, Check, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ════════════════════════════════════
// TYPES
// ════════════════════════════════════

interface CreemProduct {
  id: string;
  name: string;
  price: number;        // 单位：分
  priceDisplay: string;
  currency: string;
  billingPeriod: string;
  mode: string;
  status: string;
  isSubscription: boolean;
}

// ════════════════════════════════════
// SUBSCRIPTION PAGE — 动态产品
// ════════════════════════════════════

export default function SubscriptionPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [products, setProducts] = useState<CreemProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  // Fetch products from Creem API
  useEffect(() => {
    if (status === "loading") return;
    if (!session) { setLoading(false); return; }

    fetch("/api/payments/creem/products")
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          // 只显示订阅型产品（非 one_time）
          const subs = (data.products || []).filter(
            (p: CreemProduct) => p.isSubscription && p.status === "active"
          );
          setProducts(subs);
        } else {
          setError(data.error || "Failed to load products");
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [session, status]);

  const currentTier = (session?.user as any)?.subscriptionTier || "FREE";

  const handleSelectProduct = async (product: CreemProduct) => {
    setCheckoutLoading(product.id);
    try {
      const res = await fetch("/api/payments/creem/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create checkout session");
      }

      const { checkoutUrl } = await res.json();
      if (!checkoutUrl) throw new Error("No checkout URL returned");
      window.location.href = checkoutUrl;
    } catch (error: any) {
      console.error("Checkout error:", error);
      alert(error.message || "Failed to start checkout. Please try again.");
      setCheckoutLoading(null);
    }
  };

  // ── Loading ─────────────────────────────
  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  // ── Not signed in ─────────────────────
  if (!session) {
    router.push("/login");
    return null;
  }

  return (
    <div className="min-h-screen py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12 animate-fadeIn">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-6 shadow-lg shadow-primary/20">
            <Crown className="w-8 h-8 text-background" />
          </div>
          <h1 className="text-4xl font-bold text-foreground mb-3 font-display">
            Choose Your Plan
          </h1>
          <p className="text-foreground-muted text-lg max-w-2xl mx-auto">
            Unlock premium features and accelerate your dating journey
          </p>
        </div>

        {/* Current Tier Badge */}
        <div className="text-center mb-8 animate-fadeIn" style={{ animationDelay: "100ms" }}>
          <Badge variant="outline" className="text-sm px-4 py-1">
            Current Plan: <span className="text-primary font-bold ml-1">{currentTier}</span>
          </Badge>
        </div>

        {/* Error */}
        {error && (
          <div className="max-w-md mx-auto mb-8 p-4 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center animate-fadeIn">
            {error}
          </div>
        )}

        {/* Product Cards */}
        {products.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12 animate-fadeIn" style={{ animationDelay: "200ms" }}>
            {products.map((product, index) => {
              const isCurrent = currentTier !== "FREE" && index === 1; // 简单判断
              const isPopular = product.billingPeriod === "yearly";
              return (
                <div
                  key={product.id}
                  className={`animate-fadeInUp`}
                  style={{ animationDelay: `${index * 100 + 300}ms` }}
                >
                  <Card
                    className={`relative overflow-hidden h-full flex flex-col transition-all duration-300 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10
                      ${isPopular ? "border-primary/50 shadow-lg shadow-primary/20 scale-105" : "border-card-border"}
                    `}
                  >
                    {isPopular && (
                      <div className="absolute top-0 right-0 bg-gradient-to-r from-primary to-secondary text-background text-[10px] font-bold px-3 py-1 rounded-bl-lg">
                        POPULAR
                      </div>
                    )}

                    <CardHeader className="text-center pb-4">
                      <CardTitle className="text-foreground text-xl font-bold font-display">
                        {product.name.replace("LokFeel ", "").replace(" - ", " ")}
                      </CardTitle>
                      <div className="mt-3">
                        <span className="text-4xl font-extrabold text-foreground font-display">
                          {product.priceDisplay}
                        </span>
                        <span className="text-foreground-muted ml-1">
                          /{product.billingPeriod === "monthly" ? "mo" : "yr"}
                        </span>
                      </div>
                    </CardHeader>

                    <CardContent className="flex-1 flex flex-col gap-4">
                      <ul className="space-y-2 flex-1">
                        <li className="flex items-center gap-2 text-sm text-foreground-muted">
                          <Check className="w-4 h-4 text-primary flex-shrink-0" />
                          <span>Unlimited matches</span>
                        </li>
                        <li className="flex items-center gap-2 text-sm text-foreground-muted">
                          <Check className="w-4 h-4 text-primary flex-shrink-0" />
                          <span>Who likes me</span>
                        </li>
                        <li className="flex items-center gap-2 text-sm text-foreground-muted">
                          <Check className="w-4 h-4 text-primary flex-shrink-0" />
                          <span>Advanced filters</span>
                        </li>
                        <li className="flex items-center gap-2 text-sm text-foreground-muted">
                          <Check className="w-4 h-4 text-primary flex-shrink-0" />
                          <span>Priority showcase</span>
                        </li>
                      </ul>

                      <Button
                        onClick={() => handleSelectProduct(product)}
                        disabled={checkoutLoading !== null}
                        className={`w-full mt-auto ${isPopular ? "btn-primary" : "btn-ghost border border-card-border hover:border-primary/30"}`}
                      >
                        {checkoutLoading === product.id ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Processing...
                          </>
                        ) : isCurrent ? (
                          "Current Plan"
                        ) : (
                          <>
                            Upgrade to {product.name.replace("LokFeel ", "").split(" ")[0]}
                            <ArrowRight className="w-4 h-4 ml-2" />
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        ) : !loading && !error ? (
          <div className="text-center py-12 animate-fadeIn">
            <p className="text-foreground-muted">No subscription plans available. Please check back later.</p>
          </div>
        ) : null}

        {/* FAQ Section */}
        <div className="mt-16 max-w-3xl mx-auto animate-fadeIn" style={{ animationDelay: "400ms" }}>
          <h2 className="text-2xl font-bold text-foreground mb-6 text-center font-display">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4">
            {FAQS.map((faq, i) => (
              <Card key={i} className="bg-background-secondary border-card-border hover:border-primary/20 transition-colors">
                <CardHeader>
                  <CardTitle className="text-base text-foreground">{faq.q}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground-muted leading-relaxed">{faq.a}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════
// FAQ DATA
// ════════════════════════════════════

const FAQS = [
  {
    q: "Can I cancel my subscription anytime?",
    a: "Yes, you can cancel your subscription at any time. You'll continue to have access until the end of your billing period.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major credit cards (Visa, Mastercard, Amex) and PayPal through our secure payment processor, Creem.",
  },
  {
    q: "Is my payment information secure?",
    a: "Absolutely. We use Creem, a globally trusted payment processor. We never store your credit card information on our servers.",
  },
  {
    q: "Can I change my plan later?",
    a: "Yes, you can upgrade or downgrade your plan at any time. If you upgrade, you'll be charged the prorated amount for the remainder of the month.",
  },
];
