export const dynamic = 'force-dynamic';
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth";
import { success, badRequest, serverError } from "@/lib/api-response";
import Stripe from "stripe";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();

    const subscription = await db.subscription.findFirst({
      where: { userId: user.id },
    });

    if (!subscription?.stripeCustomerId) {
      return badRequest("No Stripe customer found. Please subscribe first.");
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: "2026-03-25.dahlia",
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.lokfeel.com";

    // ═══ Create portal with configuration ═══
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${appUrl}/dashboard/subscription`,
      configuration: await getOrCreatePortalConfig(stripe),
    });

    return success({ portalUrl: session.url });
  } catch (error) {
    console.error("[Portal] Error:", error);
    return serverError("Failed to create portal session");
  }
}

// ═══ Portal configuration (cached per process) ═══
let portalConfigId: string | null = null;

async function getOrCreatePortalConfig(stripe: Stripe): Promise<string> {
  if (portalConfigId) return portalConfigId;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.lokfeel.com";

  try {
    // Try to find existing configuration
    const configs = await stripe.billingPortal.configurations.list({ limit: 100 });
    const existing = configs.data.find(c => c.active);

    if (existing) {
      portalConfigId = existing.id;
      return portalConfigId;
    }

    // Create new configuration
    const config = await stripe.billingPortal.configurations.create({
      business_profile: {
        headline: "LokFeel Premium — Manage your subscription",
        privacy_policy_url: `${appUrl}/privacy`,
        terms_of_service_url: `${appUrl}/terms`,
      },
      features: {
        subscription_update: {
          enabled: true,
          default_allowed_updates: ["price", "promotion_code"],
          products: [],
        },
        subscription_cancel: {
          enabled: true,
          mode: "at_period_end",
          cancellation_reason: {
            enabled: true,
            options: [
              "too_expensive",
              "missing_features",
              "switched_service",
              "unused",
              "other",
            ],
          },
        },
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
      },
    });

    portalConfigId = config.id;
    return portalConfigId;
  } catch (error) {
    console.error("[Portal] Config creation failed, using default:", error);
    // Fallback: no configuration, use default portal
    return "";
  }
}
