import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/with-permission";

// In-memory mock data (replace with DB in production)
const rules: Array<{
  id: string;
  name: string;
  metric: string;
  condition: "gt" | "lt" | "eq";
  threshold: number;
  severity: "critical" | "warning" | "info";
  enabled: boolean;
  createdAt: string;
}> = [
  { id: "rule-1", name: "API 错误率告警", metric: "error_rate", condition: "gt", threshold: 1, severity: "critical", enabled: true, createdAt: new Date(Date.now() - 86400000 * 7).toISOString() },
  { id: "rule-2", name: "响应时间过长", metric: "latency_p95", condition: "gt", threshold: 500, severity: "warning", enabled: true, createdAt: new Date(Date.now() - 86400000 * 14).toISOString() },
  { id: "rule-3", name: "活跃用户骤降", metric: "active_users", condition: "lt", threshold: 100, severity: "warning", enabled: true, createdAt: new Date(Date.now() - 86400000 * 3).toISOString() },
  { id: "rule-4", name: "新注册用户为0", metric: "new_users", condition: "eq", threshold: 0, severity: "info", enabled: false, createdAt: new Date(Date.now() - 86400000).toISOString() },
];

const events: Array<{
  id: string;
  ruleId: string;
  ruleName: string;
  severity: "critical" | "warning" | "info";
  message: string;
  value: number;
  threshold: number;
  status: "active" | "resolved" | "muted";
  triggeredAt: string;
  resolvedAt?: string;
}> = [
  { id: "evt-1", ruleId: "rule-1", ruleName: "API 错误率告警", severity: "critical", message: "API 错误率超过 1%，当前 2.3%", value: 2.3, threshold: 1, status: "active", triggeredAt: new Date(Date.now() - 3600000).toISOString() },
  { id: "evt-2", ruleId: "rule-2", ruleName: "响应时间过长", severity: "warning", message: "P95 响应时间超过 500ms，当前 620ms", value: 620, threshold: 500, status: "active", triggeredAt: new Date(Date.now() - 7200000).toISOString() },
  { id: "evt-3", ruleId: "rule-1", ruleName: "API 错误率告警", severity: "critical", message: "API 错误率超过 1%，当前 1.5%", value: 1.5, threshold: 1, status: "resolved", triggeredAt: new Date(Date.now() - 86400000).toISOString(), resolvedAt: new Date(Date.now() - 82800000).toISOString() },
];

export const GET = withPermission("system.health")(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "events";

    if (type === "rules") {
      return NextResponse.json({ success: true, data: rules });
    }

    const severity = searchParams.get("severity");
    const status = searchParams.get("status");

    let filtered = [...events];
    if (severity) filtered = filtered.filter(e => e.severity === severity);
    if (status) filtered = filtered.filter(e => e.status === status);

    return NextResponse.json({ success: true, data: filtered });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: (error as Error).message } },
      { status: 500 }
    );
  }
});

export const POST = withPermission("system.config.edit")(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { name, metric, condition, threshold, severity } = body;

    if (!name || !metric || !condition || threshold === undefined || !severity) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Missing required fields" } },
        { status: 400 }
      );
    }

    const newRule = {
      id: `rule-${Date.now()}`,
      name,
      metric,
      condition: condition as "gt" | "lt" | "eq",
      threshold: Number(threshold),
      severity: severity as "critical" | "warning" | "info",
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    rules.push(newRule);
    return NextResponse.json({ success: true, data: newRule });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: (error as Error).message } },
      { status: 500 }
    );
  }
});

export const PATCH = withPermission("system.config.edit")(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { id, status, enabled } = body;

    // Update event status
    if (id && status) {
      const event = events.find(e => e.id === id);
      if (event) {
        event.status = status as "active" | "resolved" | "muted";
        if (status === "resolved") {
          event.resolvedAt = new Date().toISOString();
        }
        return NextResponse.json({ success: true, data: event });
      }
    }

    // Update rule enabled state
    if (id && enabled !== undefined) {
      const rule = rules.find(r => r.id === id);
      if (rule) {
        rule.enabled = Boolean(enabled);
        return NextResponse.json({ success: true, data: rule });
      }
    }

    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Alert not found" } },
      { status: 404 }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: (error as Error).message } },
      { status: 500 }
    );
  }
});

export const DELETE = withPermission("system.config.edit")(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Missing id parameter" } },
        { status: 400 }
      );
    }

    const idx = rules.findIndex(r => r.id === id);
    if (idx !== -1) {
      rules.splice(idx, 1);
      return NextResponse.json({ success: true, data: { id } });
    }

    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Rule not found" } },
      { status: 404 }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: (error as Error).message } },
      { status: 500 }
    );
  }
});
