"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, RotateCcw, MessageCircle } from "lucide-react";

export default function SubscriptionCancelPage() {
  const router = useRouter();

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-4">
        {/* Cancelled icon */}
        <div className="w-16 h-16 rounded-full bg-foreground-subtle/10 flex items-center justify-center mx-auto mb-6">
          <RotateCcw className="w-8 h-8 text-foreground-muted" />
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-2">No worries!</h1>
        <p className="text-foreground-muted mb-8">
          Your checkout was cancelled. You haven&apos;t been charged. 
          You can upgrade to Premium anytime when you&apos;re ready.
        </p>

        {/* Remind what they're missing */}
        <div className="glass-card p-5 mb-6 text-left">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            What Premium unlocks:
          </h3>
          <ul className="space-y-2">
            {[
              "5 matches per week (vs 3 free)",
              "Unlimited messages (vs 2 per match)",
              "Priority matching — get seen first",
              "See who already liked you",
              "Travel mode — match in any city",
              "Rematch with expired connections",
            ].map((text, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-foreground-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => router.push("/dashboard/subscription")}
            className="btn-primary px-8 py-3 inline-flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Plans
          </button>
        </div>
      </div>
    </div>
  );
}
