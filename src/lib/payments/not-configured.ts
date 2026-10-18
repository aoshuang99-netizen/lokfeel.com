import { NextResponse } from "next/server";

import {
  missingForChannel,
  readPaymentAvailability,
  type PaymentChannel,
} from "./availability";

/** 稳定的机器可读错误码：前端/探针/监控都按它判断，而不是靠文案匹配。 */
export const PAYMENT_NOT_CONFIGURED = "PAYMENT_NOT_CONFIGURED" as const;

/**
 * 统一的「该通道尚未接入」响应。
 *
 * 语义：**503 Service Unavailable**，不是 500。
 *   · 500 表示「代码坏了」，会触发告警、把未接入误报成事故；
 *   · 503 表示「这项能力当前不可用」，与「数据库连不上」同族，但带
 *     `PAYMENT_NOT_CONFIGURED` 这个码就能被精确区分。
 *
 * 兼容性：body 同时保留扁平的 `error` 字段。
 *   订阅页的历史逻辑是 `data.error` + 正则匹配 "not configured"，
 *   改字段名会让页面从「友好提示」退化成「Failed to load plans」。
 *   新增字段只做加法，不动既有键。
 */
export function paymentNotConfigured(
  channel: PaymentChannel,
  options: { error?: string } = {},
): NextResponse {
  const availability = readPaymentAvailability();

  return NextResponse.json(
    {
      ok: false,
      code: PAYMENT_NOT_CONFIGURED,
      channel,
      // 只回变量名，不回值
      missing: missingForChannel(channel),
      error: options.error ?? "Payment system is not configured. Please try again later.",
      // 便于运维一眼看出「是这一个通道没接，还是整体都还没接」
      allChannelsConfigured: availability.configured,
    },
    {
      status: 503,
      headers: {
        // 接入后应立刻生效，不能被 CDN 缓存住
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
