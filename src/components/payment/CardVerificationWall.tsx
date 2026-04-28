"use client";

import { useState } from "react";
import { CreditCard, Shield, Lock, Loader2, Check, AlertCircle, X } from "lucide-react";

interface CardVerificationWallProps {
  /** Called after successful verification */
  onSuccess?: () => void;
  /** Whether this is a modal overlay or inline */
  variant?: "modal" | "inline";
  /** Custom title */
  title?: string;
  /** Custom description */
  description?: string;
}

export function CardVerificationWall({
  onSuccess,
  variant = "modal",
  title = "Verify Your Identity",
  description = "Add a credit card to continue using LokFeel. This is for identity verification only — you will NOT be charged.",
}: CardVerificationWallProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"init" | "stripe" | "success">("init");
  const [showIframe, setShowIframe] = useState(false);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);

  const handleVerify = async () => {
    setError(null);
    setIsLoading(true);

    try {
      // 1. Create SetupIntent
      const res = await fetch("/api/payments/verify-card", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.message || "Failed to create verification session");
      }

      // Already verified?
      if (data.data?.message === "Card already verified") {
        setStep("success");
        onSuccess?.();
        return;
      }

      const { clientSecret, setupIntentId } = data.data || {};

      if (!clientSecret) {
        throw new Error("No client secret received from server");
      }

      // 2. Load Stripe.js dynamically
      setStep("stripe");

      // 3. Open Stripe hosted verification in a new approach:
      // We'll use Stripe's embedded checkout form via redirect
      const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

      if (!stripePublishableKey) {
        throw new Error("Payment system not configured. Please contact support.");
      }

      // Load Stripe.js
      const stripeScript = document.createElement("script");
      stripeScript.src = "https://js.stripe.com/v3/";
      document.head.appendChild(stripeScript);

      await new Promise<void>((resolve, reject) => {
        stripeScript.onload = () => resolve();
        stripeScript.onerror = () => reject(new Error("Failed to load Stripe"));
      });

      // @ts-ignore
      const stripe = window.Stripe(stripePublishableKey);

      // Use Stripe's confirmCardSetup which shows an embedded form
      const { setupIntent: confirmedIntent, error: stripeError } = await stripe.confirmCardSetup(
        clientSecret,
        {
          payment_method_data: {
            // Let Stripe collect billing details
            billing_details: {},
          },
        },
        {
          // This makes Stripe show its own payment element UI
          handleActions: true,
        }
      );

      if (stripeError) {
        throw new Error(stripeError.message || "Card verification failed");
      }

      if (confirmedIntent && confirmedIntent.status === "succeeded") {
        // 4. Confirm verification with our backend
        const confirmRes = await fetch("/api/payments/confirm-verification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setupIntentId: confirmedIntent.id }),
        });

        const confirmData = await confirmRes.json();

        if (!confirmRes.ok) {
          throw new Error(confirmData.error || confirmData.message || "Failed to confirm verification");
        }

        setStep("success");
        onSuccess?.();

        // Auto-redirect after 2s
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        throw new Error("Card verification did not complete. Please try again.");
      }
    } catch (err) {
      console.error("[CardVerification] Error:", err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      setStep("init");
    } finally {
      setIsLoading(false);
    }
  };

  const content = (
    <div className="space-y-5">
      {/* Header */}
      <div className="text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{
            background: "linear-gradient(135deg, oklch(68% .14 40), oklch(72% .12 20))",
            boxShadow: "0 8px 24px oklch(68% .14 40 / 0.25)",
          }}
        >
          {step === "success" ? (
            <Check className="w-8 h-8 text-white" />
          ) : (
            <CreditCard className="w-8 h-8 text-white" />
          )}
        </div>
        <h2 className="text-xl font-bold text-foreground font-display">
          {step === "success" ? "Verified! ✨" : title}
        </h2>
        <p className="text-sm text-foreground-muted mt-1">
          {step === "success"
            ? "Your identity is verified. Full access unlocked."
            : description}
        </p>
      </div>

      {/* Success state */}
      {step === "success" && (
        <div className="p-4 rounded-xl bg-success/10 border border-success/20 text-center">
          <p className="text-success font-medium text-sm">
            Redirecting to your dashboard...
          </p>
        </div>
      )}

      {/* Trust signals */}
      {step === "init" && (
        <>
          <div className="space-y-3">
            {[
              { icon: Shield, text: "Identity verification only — no charges", color: "text-success" },
              { icon: Lock, text: "Secured by Stripe (PCI DSS compliant)", color: "text-success" },
              { icon: CreditCard, text: "Any major credit or debit card works", color: "text-primary" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-background-secondary/50">
                <item.icon className={`w-5 h-5 ${item.color} flex-shrink-0`} />
                <span className="text-sm text-foreground">{item.text}</span>
              </div>
            ))}
          </div>

          {/* Why we ask */}
          <div className="p-3 rounded-xl bg-primary/5 border border-primary/10">
            <p className="text-xs text-foreground-muted leading-relaxed">
              <strong className="text-foreground">Why do we ask for this?</strong>{" "}
              Card verification helps us ensure every user is a real person, creating a safer and more trustworthy community for everyone.
            </p>
          </div>
        </>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/5">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      {/* CTA Button */}
      {step !== "success" && (
        <button
          onClick={handleVerify}
          disabled={isLoading}
          className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-base"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {step === "stripe" ? "Verifying your card..." : "Loading..."}
            </>
          ) : (
            <>
              <CreditCard className="w-5 h-5" />
              Verify My Card
            </>
          )}
        </button>
      )}

      {/* Fine print */}
      {step === "init" && (
        <p className="text-[10px] text-foreground-faint text-center leading-relaxed">
          By continuing, you agree to our card verification process. Your card will not be charged.
          This is solely for identity and age verification purposes.
        </p>
      )}
    </div>
  );

  if (variant === "modal") {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        style={{ background: "rgba(255, 250, 245, 0.94)", backdropFilter: "blur(10px)" }}>
        <div className="glass-card p-8 max-w-md w-full border-primary/30 shadow-xl relative">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-8 max-w-md mx-auto border-primary/30">
      {content}
    </div>
  );
}
