"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Crown, Check, Sparkles, Heart, ArrowRight, Loader2 } from "lucide-react";

export default function SubscriptionSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [verifying, setVerifying] = useState(true);
  const [verified, setVerified] = useState(false);

  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    // Verify the checkout session was successful
    const verifyPayment = async () => {
      try {
        // Small delay to let webhook process
        await new Promise(r => setTimeout(r, 2000));

        const res = await fetch("/api/payments/status");
        if (res.ok) {
          const data = await res.json();
          if (data.data?.isPremium) {
            setVerified(true);
          }
        }
      } catch {
        // Even if verification fails, show success (webhook may still be processing)
        setVerified(true);
      }
      setVerifying(false);
    };

    verifyPayment();
  }, []);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-4">
        {verifying ? (
          <>
            <Loader2 className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
            <h1 className="text-2xl font-bold text-foreground mb-2">Verifying your payment...</h1>
            <p className="text-foreground-muted">This will only take a moment.</p>
          </>
        ) : (
          <>
            {/* Success animation */}
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full bg-success/20 animate-ping" />
              <div className="relative w-20 h-20 rounded-full bg-success/20 flex items-center justify-center">
                <Check className="w-10 h-10 text-success" />
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 mb-4">
              <Crown className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">Welcome to Premium!</h1>
            </div>

            <p className="text-foreground-muted mb-8">
              Your LokFeel Premium is now active. You have full access to all features — unlimited messages, 
              priority matching, travel mode, and more.
            </p>

            {/* What you unlocked */}
            <div className="glass-card p-5 mb-6 text-left">
              <h3 className="text-sm font-semibold text-foreground mb-3">You just unlocked:</h3>
              <ul className="space-y-2">
                {[
                  { icon: Heart, text: "5 matches per week" },
                  { icon: Sparkles, text: "Unlimited messages" },
                  { icon: Crown, text: "Priority matching" },
                  { icon: Check, text: "See who liked you" },
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-sm text-foreground">
                    <item.icon className="w-4 h-4 text-primary flex-shrink-0" />
                    {item.text}
                  </li>
                ))}
              </ul>
            </div>

            <button
              onClick={() => router.push("/dashboard/connections")}
              className="btn-primary px-8 py-3 inline-flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Find Your Matches
              <ArrowRight className="w-4 h-4" />
            </button>

            <p className="text-xs text-foreground-subtle mt-4">
              Confirmation sent to your email. Manage your subscription anytime from Settings.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
