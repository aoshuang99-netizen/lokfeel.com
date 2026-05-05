/**
 * PingPong Checkout Client Library
 * 
 * API Key: sp_d4ec5580a8e0437288fe4caa1e692226 (Public Key)
 * API Secret: b0603d739469443d548a6a63b1bf12a78e9e0da6
 * 
 * TODO: Verify all API endpoints with official PingPong documentation at:
 * - https://docs.pingpongx.com/
 * - https://acquirer-api-docs-v4.pingpongx.com/
 */

import crypto from "crypto";
import { db } from "./db";

// ═══ Configuration ══════════════════════════════════════
interface PingPongConfig {
  apiKey: string;      // Public key (sp_xxx)
  apiSecret: string;   // Secret key
  merchantId: string;
  env: "sandbox" | "production";
}

// ═══ API Response Types ═══════════════════════════════════
export interface PingPongCreateSessionResponse {
  code: number;
  message: string;
  data?: {
    checkoutUrl: string;      // Hosted checkout page URL
    merchantTransactionId: string;
    amount: number;
    currency: string;
    status: string;
  };
}

export interface PingPongWebhookPayload {
  eventType: "PAYMENT_SUCCESS" | "PAYMENT_FAILED" | "REFUND_SUCCESS";
  merchantTransactionId: string;
  transactionId: string;
  amount: number;
  currency: string;
  status: string;
  timestamp: number;
  signature: string;
}

// ═══ Main Client Class ════════════════════════════════════
export class PingPongClient {
  private config: PingPongConfig;
  private baseUrl: string;

  constructor(config: PingPongConfig) {
    this.config = config;
    // TODO: Verify exact base URL with PingPong docs
    this.baseUrl =
      config.env === "production"
        ? "https://gateway.pingpongx.com"
        : "https://gateway-test.pingpongx.com";
  }

  // ════════════════════════════════════════════════════════
  // Signature Generation (HMAC-SHA256)
  // ════════════════════════════════════════════════════════

  /**
   * Generate HMAC-SHA256 signature
   * 
   * TODO: Verify exact signature algorithm with PingPong docs
   * Common pattern for payment APIs:
   * 1. Concatenate: apiKey + timestamp + body
   * 2. HMAC-SHA256 with apiSecret
   * 3. Convert to hex string
   * 
   * May also use:
   * - MD5(apiKey + timestamp + secret)
   * - RSA-SHA256 with private key
   */
  private generateSignature(body: string, timestamp: string): string {
    // TODO: Verify exact signature format with PingPong docs
    const signString = `${this.config.apiKey}${timestamp}${body}`;
    
    return crypto
      .createHmac("sha256", this.config.apiSecret)
      .update(signString)
      .digest("hex");
  }

  // ════════════════════════════════════════════════════════
  // API Request Helper
  // ════════════════════════════════════════════════════════

  private async request<T>(
    endpoint: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    body?: unknown
  ): Promise<T> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = body ? JSON.stringify(body) : "";
    const signature = this.generateSignature(payload, timestamp);

    // TODO: Verify exact header names with PingPong docs
    // Common header patterns:
    // - Authorization: Token {apiKey}
    // - X-API-Key + X-Timestamp + X-Signature
    // - apikey + timestamp + sign
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-API-Key": this.config.apiKey,
      "X-Timestamp": timestamp,
      "X-Signature": signature,
    };

    const url = `${this.baseUrl}${endpoint}`;
    console.log(`[PingPong] ${method} ${url}`);

    const response = await fetch(url, {
      method,
      headers,
      body: payload || undefined,
    });

    const responseText = await response.text();
    console.log(`[PingPong] Response (${response.status}):`, responseText);

    if (!response.ok) {
      throw new Error(`PingPong API Error (${response.status}): ${responseText}`);
    }

    return JSON.parse(responseText);
  }

  // ════════════════════════════════════════════════════════
  // Create Checkout Session (One-time or Subscription)
  // ════════════════════════════════════════════════════════

  /**
   * Create a hosted checkout session
   * 
   * TODO: Verify endpoint URL with PingPong documentation
   * Possible endpoints (need verification):
   * - POST /checkout/api/create
   * - POST /api/v1/checkout/session
   * - POST /gateway/api/unifiedPayment
   * 
   * Based on research: PingPong supports "Recurring API" for subscriptions
   */
  async createCheckoutSession(params: {
    merchantTransactionId: string;
    amount: number;
    currency: string;
    description: string;
    successUrl: string;
    cancelUrl: string;
    planId?: string;  // For subscription/recurring payment
    customerEmail?: string;
    customerId?: string;
  }): Promise<PingPongCreateSessionResponse> {
    // TODO: Verify endpoint URL with PingPong docs
    const endpoint = "/checkout/api/create";
    
    const payload: Record<string, unknown> = {
      merchantId: this.config.merchantId,
      merchantTransactionId: params.merchantTransactionId,
      amount: params.amount,
      currency: params.currency,
      description: params.description,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
    };

    // Add subscription/recurring parameters if planId is provided
    if (params.planId) {
      payload["bizType"] = "Recurring";  // TODO: Verify with PingPong docs
      payload["planId"] = params.planId;
    }

    if (params.customerEmail) {
      payload["customerEmail"] = params.customerEmail;
    }

    if (params.customerId) {
      payload["customerId"] = params.customerId;
    }

    return this.request<PingPongCreateSessionResponse>(endpoint, "POST", payload);
  }

  // ════════════════════════════════════════════════════════
  // Query Transaction Status
  // ════════════════════════════════════════════════════════

  /**
   * Query transaction status by merchantTransactionId
   * 
   * TODO: Verify endpoint URL with PingPong docs
   */
  async queryTransaction(merchantTransactionId: string): Promise<unknown> {
    const endpoint = "/transaction/api/query";  // TODO: Verify with docs
    
    return this.request(endpoint, "POST", {
      merchantId: this.config.merchantId,
      merchantTransactionId,
    });
  }

  // ════════════════════════════════════════════════════════
  // Verify Webhook Signature
  // ════════════════════════════════════════════════════════

  /**
   * Verify webhook notification signature
   * 
   * TODO: Verify exact verification method with PingPong docs
   * Common pattern:
   * 1. Extract signature from header
   * 2. Recompute: HMAC-SHA256(payload, webhookSecret)
   * 3. Compare with received signature
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    // TODO: Verify with PingPong docs - may use different algorithm
    const expectedSignature = crypto
      .createHmac("sha256", process.env.PINGPONG_WEBHOOK_SECRET!)
      .update(payload)
      .digest("hex");
    
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(expectedSignature, "hex")
      );
    } catch {
      return false;
    }
  }
}

// ════════════════════════════════════════════════════════
// Factory Function
// ════════════════════════════════════════════════════════

export function createPingPongClient(): PingPongClient {
  const config: PingPongConfig = {
    apiKey: process.env.PINGPONG_API_KEY!,
    apiSecret: process.env.PINGPONG_API_SECRET!,
    merchantId: process.env.PINGPONG_MERCHANT_ID!,
    env: (process.env.PINGPONG_ENVIRONMENT as "sandbox" | "production") || "sandbox",
  };

  return new PingPongClient(config);
}
