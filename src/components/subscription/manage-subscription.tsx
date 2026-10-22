"use client";

/**
 * 管理订阅 · 取消入口（V18-04）
 * ═══════════════════════════════════════════════════════════════════════
 * 这个组件存在的理由
 * ------------
 * `/refunds` 第 105 行原本写着「去 Account Settings → Manage Subscription 取消」，
 * 而那个界面**从来不存在**。这是一条指错门的指路牌：用户按它走，走不到。
 *
 * 两种修法：把文案删掉（等于承认"不能取消"），或把门修出来。这里选修门。
 *
 * 三条设计约束
 * ------------
 * ① **按钮状态必须来自服务端判定**，不是前端猜。
 *    组件挂载时先 `GET /api/payments/cancel`，服务端与 `POST` 共用同一套判定
 *    （`evaluate`），所以「能点」与「点了能成」不会错位。
 *    一个永远可点、点了才说"不行"的按钮，比没有按钮更伤人。
 *
 * ② **两步确认**，而且第二步要把话说清楚：
 *    期末取消 = 当期权益**仍在**，到期不再续费。不是"立刻断权"。
 *    这两句如果不说，用户以为自己在退款。
 *
 * ③ **每一种失败都说人话**，并且不留"成功"的错觉。
 *    503（没接支付）/ 409（归属不明 / Creem 管理 / 无服务商记录）各自不同，
 *    对应的下一步也不同 —— 该找客服的就说找客服。
 *
 * 无障碍与移动端
 * ------------
 * · 所有可点元素 `min-h-11`（44px），符合 V18-06 触控目标口径；
 * · 结果区 `aria-live="polite"`，屏幕阅读器能听到状态变化；
 * · 文案里不写 ASCII 裸引号（`react/no-unescaped-entities` 会判红）。
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** 与服务端 `CancelEligibility` 对齐（不引服务端模块：那是 node-only 的依赖链） */
type Reason =
  | "READY"
  | "ALREADY_SCHEDULED"
  | "NO_ACTIVE_SUBSCRIPTION"
  | "NO_REMOTE_SUBSCRIPTION"
  | "PAYMENT_NOT_CONFIGURED"
  | "PROVIDER_AMBIGUOUS"
  | "PROVIDER_NOT_SELF_SERVICE";

interface Eligibility {
  hasActive: boolean;
  alreadyScheduled: boolean;
  cancellable: boolean;
  provider: "stripe" | "creem" | "none" | "ambiguous";
  reason: Reason;
  message: string;
}

interface PostResult {
  ok: boolean;
  code?: string;
  error?: string;
  message?: string;
  currentPeriodEnd?: string | null;
  alreadyScheduled?: boolean;
}

const SUPPORT_MAIL = "mailto:billing@lokfeel.com";

/**
 * 每种理由给一句**能照着做**的话，而不是一句道歉。
 *
 * 用完整的 `Record<Reason, string>`（而不是 `Exclude<Reason, "READY">`）是有意的：
 * 索引时 `e.reason` 的类型就是 `Reason`，把 READY 排除掉会让 `REASON_HINT[e.reason]`
 * 直接编译不过（TS7053），只能靠断言糊过去 —— 那等于用 `as` 掩盖一个真实的分支。
 * 这里给 READY 一个空串，README/ALREADY 各归各位，不做特殊判断。
 */
const REASON_HINT: Record<Reason, string> = {
  READY: "",
  ALREADY_SCHEDULED: "",
  NO_ACTIVE_SUBSCRIPTION: "There is nothing to cancel right now.",
  NO_REMOTE_SUBSCRIPTION:
    "This plan was granted manually, so there is no automatic renewal to stop.",
  PAYMENT_NOT_CONFIGURED:
    "Payments are not enabled on this deployment yet, so no subscription can exist here.",
  PROVIDER_AMBIGUOUS:
    "More than one payment provider is configured, so we cannot tell which one holds this subscription.",
  PROVIDER_NOT_SELF_SERVICE:
    "This subscription is managed by Creem and self-service cancellation is not available yet.",
};

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function ManageSubscription() {
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PostResult | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/payments/cancel", { cache: "no-store" });
      if (!res.ok) {
        // 未登录（401）也走这里：不把内部错误摔到用户脸上
        setLoadError("We could not load your subscription status.");
        return;
      }
      const data = (await res.json()) as Eligibility & { ok: boolean };
      setEligibility(data);
      setLoadError(null);
    } catch {
      setLoadError("We could not load your subscription status.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/payments/cancel", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as PostResult;
      setResult({ ...data, ok: res.ok && data.ok !== false });
      if (res.ok) {
        setConfirming(false);
        // 成功后重新取一次判定：不靠本地状态"假装"已经取消
        await load();
      }
    } catch {
      setResult({ ok: false, error: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  // ── 加载中 ────────────────────────────────
  if (!eligibility && !loadError) {
    return (
      <Card className="bg-background-secondary border-card-border">
        <CardContent className="flex items-center gap-3 py-6 text-sm text-foreground-muted">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>Checking your subscription…</span>
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className="bg-background-secondary border-card-border">
        <CardContent className="py-6 text-sm text-foreground-muted">{loadError}</CardContent>
      </Card>
    );
  }

  const e = eligibility as Eligibility;
  const successDate = formatDate(result?.currentPeriodEnd);

  return (
    <Card className="bg-background-secondary border-card-border" id="manage-subscription">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-foreground">
          <ShieldQuestion className="w-4 h-4 text-primary" aria-hidden="true" />
          Manage subscription
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!e.hasActive && (
          <p className="text-sm text-foreground-muted">
            You do not have an active subscription. Nothing will be charged.
          </p>
        )}

        {e.hasActive && e.alreadyScheduled && (
          <p className="flex items-start gap-2 text-sm text-foreground-muted">
            <CheckCircle2 className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" aria-hidden="true" />
            <span>
              Renewal is already cancelled. You keep access until the end of the current billing
              period, and you will not be charged again.
            </span>
          </p>
        )}

        {e.hasActive && !e.alreadyScheduled && e.cancellable && !confirming && (
          <>
            <p className="text-sm text-foreground-muted">
              Cancelling stops the next renewal. You keep access until the end of the current
              billing period — this is not an immediate downgrade.
            </p>
            <Button
              variant="outline"
              className="min-h-11 w-full sm:w-auto"
              onClick={() => setConfirming(true)}
            >
              Cancel renewal
            </Button>
          </>
        )}

        {e.hasActive && !e.alreadyScheduled && e.cancellable && confirming && (
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              Confirm: stop renewing this subscription at the end of the current period?
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="destructive"
                className="min-h-11 w-full sm:w-auto"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    Cancelling…
                  </>
                ) : (
                  "Yes, cancel renewal"
                )}
              </Button>
              <Button
                variant="ghost"
                className="min-h-11 w-full sm:w-auto border border-card-border"
                onClick={() => setConfirming(false)}
                disabled={submitting}
              >
                Keep my subscription
              </Button>
            </div>
          </div>
        )}

        {e.hasActive && !e.cancellable && e.reason !== "ALREADY_SCHEDULED" && (
          <div className="flex items-start gap-2 text-sm text-foreground-muted">
            <AlertTriangle
              className="w-4 h-4 mt-0.5 text-foreground-subtle flex-shrink-0"
              aria-hidden="true"
            />
            <span>
              {REASON_HINT[e.reason] || e.message}{" "}
              <a href={SUPPORT_MAIL} className="text-primary hover:underline">
                Contact billing support
              </a>{" "}
              and we will handle it manually.
            </span>
          </div>
        )}

        {/* 结果区：成功/失败都必须说清楚发生了什么 */}
        <div aria-live="polite" className="text-sm">
          {result?.ok && (
            <p className="flex items-start gap-2 text-foreground">
              <CheckCircle2
                className="w-4 h-4 mt-0.5 text-primary flex-shrink-0"
                aria-hidden="true"
              />
              <span>
                {result.alreadyScheduled
                  ? "Cancellation was already scheduled."
                  : "Done. Renewal has been cancelled" +
                    (successDate ? ` and access continues until ${successDate}.` : ".")}
              </span>
            </p>
          )}
          {result && !result.ok && (
            <p className="flex items-start gap-2 text-destructive">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>
                We could not cancel automatically: {result.error || "unknown error."}{" "}
                <a href={SUPPORT_MAIL} className="underline">
                  Contact billing support
                </a>
                .
              </span>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
