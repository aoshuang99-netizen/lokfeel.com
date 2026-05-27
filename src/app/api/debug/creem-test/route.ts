export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { Creem } from "creem";

export async function GET() {
  const results: Record<string, any> = {};

  // 1. Check env vars
  const vars = [
    "CREEM_API_KEY",
    "CREEM_ENV",
    "CREEM_MONTHLY_PRODUCT_ID",
    "CREEM_YEARLY_PRODUCT_ID",
    "CREEM_WEBHOOK_SECRET",
    "CREEM_SUCCESS_URL",
  ];
  vars.forEach((v) => {
    const val = process.env[v];
    if (val) {
      results[v] = `OK (len=${val.length}, prefix=${val.slice(0, 8)}...)`;
    } else {
      results[v] = "EMPTY";
    }
  });

  // 2. Test API key connection
  if (process.env.CREEM_API_KEY) {
    try {
      const env = (process.env.CREEM_ENV || "test") as "production" | "test";
      const serverIdx = env === "test" ? 1 : 0;
      const creem = new Creem({
        apiKey: process.env.CREEM_API_KEY,
        serverIdx,
      });

      const products = await creem.products.search(1, 20);
      const data = (products as any)?.data || [];
      results["Products API"] = `Connected! Found ${data.length} products`;

      if (data.length > 0) {
        results["Product List"] = data.map((p: any) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          billing_type: p.billing_type,
          amount: p.amount,
          currency: p.currency,
        }));
      }
    } catch (e: any) {
      results["Products API"] = "Error: " + e.message;
    }
  } else {
    results["Products API"] = "SKIPPED (no API key)";
  }

  // 3. Test checkout creation (dry run)
  if (process.env.CREEM_API_KEY && process.env.CREEM_MONTHLY_PRODUCT_ID) {
    try {
      const env = (process.env.CREEM_ENV || "test") as "production" | "test";
      const serverIdx = env === "test" ? 1 : 0;
      const creem = new Creem({
        apiKey: process.env.CREEM_API_KEY,
        serverIdx,
      });

      // Just verify the product exists
      const product = await creem.products.get(
        process.env.CREEM_MONTHLY_PRODUCT_ID
      );
      results["Monthly Product"] = `Exists: ${(product as any)?.name || "unknown"}`;
    } catch (e: any) {
      results["Monthly Product"] = "Error: " + e.message;
    }
  }

  if (process.env.CREEM_API_KEY && process.env.CREEM_YEARLY_PRODUCT_ID) {
    try {
      const env = (process.env.CREEM_ENV || "test") as "production" | "test";
      const serverIdx = env === "test" ? 1 : 0;
      const creem = new Creem({
        apiKey: process.env.CREEM_API_KEY,
        serverIdx,
      });

      const product = await creem.products.get(
        process.env.CREEM_YEARLY_PRODUCT_ID
      );
      results["Yearly Product"] = `Exists: ${(product as any)?.name || "unknown"}`;
    } catch (e: any) {
      results["Yearly Product"] = "Error: " + e.message;
    }
  }

  return NextResponse.json({ success: true, results });
}
