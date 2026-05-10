"use client";

import { useState, type ReactNode } from "react";
import { Lock, Crown, Zap, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ══════════════════════════════════
// SUBSCRIPTION TIERS
// ══════════════════════════════════

export enum SubscriptionTier {
  FREE = "FREE",
  PLUS = "PLUS",
  PREMIUM = "PREMIUM",
  FOUNDER = "FOUNDER", // Lifetime
}

interface PaywallProps {
  feature: string;
  description?: string;
  currentTier?: SubscriptionTier;
  requiredTier?: SubscriptionTier;
  children?: React.ReactNode;
  fallback?: React.ReactNode;
}

// ══════════════════════════════════
// TIER CONFIGURATION
// ══════════════════════════════════

const TIER_CONFIG = {
  [SubscriptionTier.FREE]: {
    name: "Free",
    price: "$0",
    color: "text-gray-400",
    bgColor: "bg-gray-500/10",
    borderColor: "border-gray-500/20",
  },
  [SubscriptionTier.PLUS]: {
    name: "Plus",
    price: "$9.99/mo",
    color: "text-primary",
    bgColor: "bg-primary/10",
    borderColor: "border-primary/30",
  },
  [SubscriptionTier.PREMIUM]: {
    name: "Premium",
    price: "$19.99/mo",
    color: "text-accent",
    bgColor: "bg-accent/10",
    borderColor: "border-accent/30",
    popular: true,
  },
  [SubscriptionTier.FOUNDER]: {
    name: "Founder",
    price: "$99 (Lifetime)",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    limited: true,
  },
};

const FEATURE_ACCESS: Record<string, SubscriptionTier> = {
  "unlimited_matches": SubscriptionTier.PLUS,
  "who_likes_me": SubscriptionTier.PLUS,
  "advanced_filters": SubscriptionTier.PLUS,
  "vault_extend": SubscriptionTier.PLUS,
  "priority_showcase": SubscriptionTier.PREMIUM,
  "read_receipts": SubscriptionTier.PREMIUM,
  "incognito_mode": SubscriptionTier.PREMIUM,
  "founder_badge": SubscriptionTier.FOUNDER,
};

// ══════════════════════════════════
// PAYWALL COMPONENT — Blurs content
// ══════════════════════════════════

export function Paywall({
  feature,
  description,
  currentTier = SubscriptionTier.FREE,
  requiredTier,
  children,
  fallback,
}: PaywallProps) {
  const required = requiredTier || FEATURE_ACCESS[feature] || SubscriptionTier.PLUS;
  const hasAccess = getTierLevel(currentTier) >= getTierLevel(required);

  if (hasAccess) {
    return <>{children}</>;
  }

  // Show fallback or default paywall
  if (fallback) {
    return <>{fallback}</>;
  }

  return <PaywallPreview feature={feature} description={description} requiredTier={required} />;
}

// ══════════════════════════════════
// PAYWALL PREVIEW — Shows blurred content
// ══════════════════════════════════

function PaywallPreview({
  feature,
  description,
  requiredTier,
  children,
}: {
  feature: string;
  description?: string;
  requiredTier: SubscriptionTier;
  children?: ReactNode;
}) {
  const config = TIER_CONFIG[requiredTier];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/5">
      {/* Blurred Content */}
      <div className="blur-md pointer-events-none opacity-50">
        {children}
      </div>

      {/* Overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="text-center p-6 max-w-sm">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-white" />
          </div>

          <h3 className="text-lg font-bold text-foreground mb-2">
            Premium Feature
          </h3>

          <p className="text-sm text-foreground-muted mb-1">
            {description || `Unlock ${feature} to access this feature`}
          </p>

          <div className="mb-6">
            <Badge className={`${config.bgColor} ${config.color} border-0`}>
              {config.name} Required
            </Badge>
          </div>

          <Button
            onClick={() => {
              // TODO: Redirect to subscription page
              window.location.href = "/dashboard/subscription";
            }}
            className="btn-primary w-full"
          >
            <Crown className="w-4 h-4 mr-2" />
            Upgrade to {config.name}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════
// UPGRADE PROMPT — Non-blocking suggestion
// ══════════════════════════════════

export function UpgradePrompt({
  feature,
  currentTier = SubscriptionTier.FREE,
}: {
  feature: string;
  currentTier?: SubscriptionTier;
}) {
  const required = FEATURE_ACCESS[feature] || SubscriptionTier.PLUS;
  const hasAccess = getTierLevel(currentTier) >= getTierLevel(required);

  if (hasAccess) return null;

  const config = TIER_CONFIG[required];

  return (
    <div className="bg-gradient-to-r from-primary/10 to-accent/10 rounded-2xl p-4 border border-primary/20 mb-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
          <Zap className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            Unlock this feature
          </p>
          <p className="text-xs text-foreground-muted mt-0.5">
            Upgrade to {config.name} to access {feature}
          </p>
        </div>
        <Button size="sm" className="btn-primary text-xs">
          Upgrade
        </Button>
      </div>
    </div>
  );
}

// ══════════════════════════════════
// SUBSCRIPTION CARD — Pricing display
// ══════════════════════════════════

export function SubscriptionCard({
  tier,
  currentTier,
  onSelect,
}: {
  tier: SubscriptionTier;
  currentTier?: SubscriptionTier;
  onSelect: (tier: SubscriptionTier) => void;
}) {
  const config = TIER_CONFIG[tier];
  const isCurrent = currentTier === tier;
  const tierLevel = getTierLevel(tier);
  const currentLevel = getTierLevel(currentTier || SubscriptionTier.FREE);
  const canSelect = tierLevel > currentLevel;

  const isPopular = 'popular' in config && config.popular;

  return (
    <Card
      className={`relative overflow-hidden ${
        isPopular ? "border-primary/50 shadow-lg shadow-primary/20" : "border-white/5"
      }`}
    >
      {isPopular && (
        <div className="absolute top-0 right-0 bg-primary text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg">
          POPULAR
        </div>
      )}

      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-foreground">{config.name}</CardTitle>
          {isCurrent && (
            <Badge variant="outline" className="text-[10px]">
              Current
            </Badge>
          )}
        </div>
        <div className="text-2xl font-bold text-foreground">
          {config.price}
        </div>
      </CardHeader>

      <CardContent>
        <ul className="space-y-2 mb-6">
          {getFeaturesForTier(tier).map((feature, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-foreground-muted">
              <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
              {feature}
            </li>
          ))}
        </ul>

        <Button
          onClick={() => onSelect(tier)}
          disabled={!canSelect && !isCurrent}
          className={`w-full ${
            isPopular
              ? "btn-primary"
              : "btn-ghost border border-white/10 hover:border-primary/30"
          }`}
        >
          {isCurrent ? "Current Plan" : canSelect ? `Upgrade to ${config.name}` : "Downgrade"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ══════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════

function getTierLevel(tier: SubscriptionTier): number {
  const levels = {
    [SubscriptionTier.FREE]: 0,
    [SubscriptionTier.PLUS]: 1,
    [SubscriptionTier.PREMIUM]: 2,
    [SubscriptionTier.FOUNDER]: 3,
  };
  return levels[tier] || 0;
}

function getFeaturesForTier(tier: SubscriptionTier): string[] {
  const allFeatures = {
    [SubscriptionTier.FREE]: [
      "5 matches per week",
      "Basic filters",
      "Standard messaging",
    ],
    [SubscriptionTier.PLUS]: [
      "20 matches per week",
      "Who likes me",
      "Advanced filters",
      "Vault extend (+24h)",
      "Read receipts",
    ],
    [SubscriptionTier.PREMIUM]: [
      "Unlimited matches",
      "Priority showcase",
      "Incognito mode",
      "See who viewed you",
      "Custom privacy settings",
    ],
    [SubscriptionTier.FOUNDER]: [
      "Lifetime access",
      "Founder badge",
      "All Premium features",
      "Early access to new features",
      "Direct support line",
    ],
  };

  const tierFeatures = allFeatures[tier] || [];
  const lowerTier = tier === SubscriptionTier.FOUNDER
    ? SubscriptionTier.PREMIUM
    : tier === SubscriptionTier.PREMIUM
    ? SubscriptionTier.PLUS
    : SubscriptionTier.FREE;

  const lowerFeatures = allFeatures[lowerTier] || [];

  // Return only the new features for this tier
  return tierFeatures.filter(f => !lowerFeatures.includes(f));
}

// ══════════════════════════════════
// EXAMPLE: Usage in a component
// ══════════════════════════════════

/*
// In dashboard/page.tsx:
import { Paywall } from "@/components/subscription/paywall";

<Paywall feature="who_likes_me" currentTier={userTier}>
  <WhoLikesMeList />
</Paywall>

// Or use UpgradePrompt for non-blocking suggestion:
import { UpgradePrompt } from "@/components/subscription/paywall";

<UpgradePrompt feature="unlimited_matches" currentTier={userTier} />
*/
