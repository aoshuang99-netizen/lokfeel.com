"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, Plus, AlertTriangle, AlertCircle, Info, Check, Trash2, Filter, RefreshCw, Settings } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// Brand Colors — Apple-style light theme
const C = {
  primary: "#0071e3",
  secondary: "#5856d6",
  success: "#34c759",
  warning: "#ff9500",
  danger: "#ff3b30",
  bgLight: "#f5f5f7",
  border: "#e5e5e7",
  textMuted: "#86868b",
  textPrimary: "#1d1d1f",
  textSecondary: "#6e6e73",
};

type AlertSeverity = "critical" | "warning" | "info";
type AlertStatus = "active" | "resolved" | "muted";

interface AlertRule {
  id: string;
  name: string;
  metric: string;
  condition: "gt" | "lt" | "eq";
  threshold: number;
  severity: AlertSeverity;
  enabled: boolean;
  createdAt: Date;
}

interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  message: string;
  value: number;
  threshold: number;
  status: AlertStatus;
  triggeredAt: Date;
  resolvedAt?: Date;
}

// Mock alert rules
const MOCK_RULES: AlertRule[] = [
  { id: "rule-1", name: "API 错误率告警", metric: "error_rate", condition: "gt", threshold: 1, severity: "critical", enabled: true, createdAt: new Date(Date.now() - 86400000 * 7) },
  { id: "rule-2", name: "响应时间过长", metric: "latency_p95", condition: "gt", threshold: 500, severity: "warning", enabled: true, createdAt: new Date(Date.now() - 86400000 * 14) },
  { id: "rule-3", name: "活跃用户骤降", metric: "active_users", condition: "lt", threshold: 100, severity: "warning", enabled: true, createdAt: new Date(Date.now() - 86400000 * 3) },
  { id: "rule-4", name: "新注册用户为0", metric: "new_users", condition: "eq", threshold: 0, severity: "info", enabled: false, createdAt: new Date(Date.now() - 86400000 * 1) },
];

// Mock alert events
const MOCK_EVENTS: AlertEvent[] = [
  { id: "evt-1", ruleId: "rule-1", ruleName: "API 错误率告警", severity: "critical", message: "API 错误率超过 1%，当前 2.3%", value: 2.3, threshold: 1, status: "active", triggeredAt: new Date(Date.now() - 3600000) },
  { id: "evt-2", ruleId: "rule-2", ruleName: "响应时间过长", severity: "warning", message: "P95 响应时间超过 500ms，当前 620ms", value: 620, threshold: 500, status: "active", triggeredAt: new Date(Date.now() - 7200000) },
  { id: "evt-3", ruleId: "rule-1", ruleName: "API 错误率告警", severity: "critical", message: "API 错误率超过 1%，当前 1.5%", value: 1.5, threshold: 1, status: "resolved", triggeredAt: new Date(Date.now() - 86400000), resolvedAt: new Date(Date.now() - 82800000) },
];

export default function AlertsPage() {
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [activeTab, setActiveTab] = useState<"events" | "rules">("events");
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 600));
    setRules(MOCK_RULES);
    setEvents(MOCK_EVENTS);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleRule = (ruleId: string) => {
    setRules(prev => prev.map(r => 
      r.id === ruleId ? { ...r, enabled: !r.enabled } : r
    ));
    toast.success("告警规则已更新");
  };

  const handleResolveEvent = (eventId: string) => {
    setEvents(prev => prev.map(e =>
      e.id === eventId ? { ...e, status: "resolved", resolvedAt: new Date() } : e
    ));
    toast.success("告警已标记为已解决");
  };

  const handleMuteEvent = (eventId: string) => {
    setEvents(prev => prev.map(e =>
      e.id === eventId ? { ...e, status: "muted" } : e
    ));
    toast.info("告警已静默");
  };

  const handleDeleteRule = (ruleId: string) => {
    setRules(prev => prev.filter(r => r.id !== ruleId));
    toast.success("告警规则已删除");
  };

  const getSeverityIcon = (severity: AlertSeverity) => {
    switch (severity) {
      case "critical":
        return <AlertTriangle className="w-4 h-4 text-[#ff3b30]" />;
      case "warning":
        return <AlertCircle className="w-4 h-4 text-[#ff9500]" />;
      default:
        return <Info className="w-4 h-4 text-[#0071e3]" />;
    }
  };

  const getSeverityBg = (severity: AlertSeverity) => {
    switch (severity) {
      case "critical":
        return "bg-[#ff3b30]";
      case "warning":
        return "bg-[#ff9500]";
      default:
        return "bg-[#0071e3]";
    }
  };

  const getStatusBadge = (status: AlertStatus) => {
    switch (status) {
      case "active":
        return <span className="px-2 py-0.5 bg-[#ff3b30] text-white text-xs rounded-full">活跃</span>;
      case "resolved":
        return <span className="px-2 py-0.5 bg-[#34c759] text-white text-xs rounded-full">已解决</span>;
      case "muted":
        return <span className="px-2 py-0.5 bg-[#86868b] text-white text-xs rounded-full">已静默</span>;
    }
  };

  const filteredEvents = events.filter(e => {
    if (severityFilter !== "all" && e.severity !== severityFilter) return false;
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    return true;
  });

  const activeAlerts = events.filter(e => e.status === "active");

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      {/* Header */}
      <div className="bg-white border-b border-[#e5e5e7] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#ff9500] to-[#ff3b30] flex items-center justify-center">
                  <Bell className="w-5 h-5 text-white" />
                </div>
                {activeAlerts.length > 0 && (
                  <div className="absolute -top-1 -right-1 w-5 h-5 bg-[#ff3b30] text-white text-xs rounded-full flex items-center justify-center">
                    {activeAlerts.length}
                  </div>
                )}
              </div>
              <div>
                <h1 className="text-xl font-semibold text-[#1d1d1f]">告警系统</h1>
                <p className="text-sm text-[#6e6e73]">
                  {activeAlerts.length} 个活跃告警 · {rules.filter(r => r.enabled).length} 条规则已启用
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={fetchData}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-[#e5e5e7] rounded-lg text-sm text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                刷新
              </button>
              <button className="flex items-center gap-2 px-4 py-2 bg-[#0071e3] text-white rounded-lg text-sm hover:bg-[#0077ed] transition-colors">
                <Plus className="w-4 h-4" />
                创建规则
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => setActiveTab("events")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "events"
                ? "bg-[#0071e3] text-white"
                : "bg-white text-[#6e6e73] hover:bg-[#f5f5f7]"
            }`}
          >
            告警事件 ({events.length})
          </button>
          <button
            onClick={() => setActiveTab("rules")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "rules"
                ? "bg-[#0071e3] text-white"
                : "bg-white text-[#6e6e73] hover:bg-[#f5f5f7]"
            }`}
          >
            告警规则 ({rules.length})
          </button>
        </div>

        {/* Events Tab */}
        {activeTab === "events" && (
          <>
            {/* Filters */}
            <div className="flex items-center gap-4 mb-4">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-[#6e6e73]" />
                <span className="text-sm text-[#6e6e73]">筛选:</span>
              </div>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as AlertSeverity | "all")}
                className="px-3 py-1.5 bg-white border border-[#e5e5e7] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
              >
                <option value="all">全部严重程度</option>
                <option value="critical">严重</option>
                <option value="warning">警告</option>
                <option value="info">信息</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as AlertStatus | "all")}
                className="px-3 py-1.5 bg-white border border-[#e5e5e7] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
              >
                <option value="all">全部状态</option>
                <option value="active">活跃</option>
                <option value="resolved">已解决</option>
                <option value="muted">已静默</option>
              </select>
            </div>

            {/* Events List */}
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center border border-[#e5e5e7]">
                <Bell className="w-12 h-12 mx-auto mb-4 text-[#e5e5e7]" />
                <h3 className="text-lg font-medium text-[#1d1d1f] mb-2">暂无告警</h3>
                <p className="text-sm text-[#6e6e73]">所有系统运行正常</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredEvents.map(event => (
                  <div
                    key={event.id}
                    className={`bg-white rounded-xl p-4 border border-[#e5e5e7] ${
                      event.status === "active" ? "border-l-4" : ""
                    }`}
                    style={{
                      borderLeftColor: event.status === "active" ? getSeverityBg(event.severity) : undefined
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        {getSeverityIcon(event.severity)}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-[#1d1d1f]">{event.ruleName}</h3>
                            {getStatusBadge(event.status)}
                          </div>
                          <p className="text-sm text-[#6e6e73]">{event.message}</p>
                          <p className="text-xs text-[#86868b] mt-2">
                            触发时间: {event.triggeredAt.toLocaleString()}
                            {event.resolvedAt && ` · 解决时间: ${event.resolvedAt.toLocaleString()}`}
                          </p>
                        </div>
                      </div>
                      {event.status === "active" && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleResolveEvent(event.id)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-[#34c759] text-white text-sm rounded-lg hover:bg-[#2db84d] transition-colors"
                          >
                            <Check className="w-4 h-4" />
                            解决
                          </button>
                          <button
                            onClick={() => handleMuteEvent(event.id)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-white border border-[#e5e5e7] text-[#6e6e73] text-sm rounded-lg hover:bg-[#f5f5f7] transition-colors"
                          >
                            静默
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Rules Tab */}
        {activeTab === "rules" && (
          <div className="bg-white rounded-2xl border border-[#e5e5e7] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#f5f5f7]">
                    <th className="px-4 py-3 text-left text-sm font-medium text-[#6e6e73]">规则名称</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-[#6e6e73]">条件</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-[#6e6e73]">严重程度</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-[#6e6e73]">状态</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-[#6e6e73]">创建时间</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-[#6e6e73]">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-t border-[#e5e5e7]">
                        <td className="px-4 py-3"><Skeleton className="h-6 w-32" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-6 w-24" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-6 w-16" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-6 w-12" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-6 w-24" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-6 w-20" /></td>
                      </tr>
                    ))
                  ) : rules.map(rule => (
                    <tr key={rule.id} className="border-t border-[#e5e5e7]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[#1d1d1f]">{rule.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-[#6e6e73]">
                        {rule.metric} {rule.condition === "gt" ? ">" : rule.condition === "lt" ? "<" : "="} {rule.threshold}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {getSeverityIcon(rule.severity)}
                          <span className={`text-sm ${
                            rule.severity === "critical" ? "text-[#ff3b30]" :
                            rule.severity === "warning" ? "text-[#ff9500]" : "text-[#0071e3]"
                          }`}>
                            {rule.severity === "critical" ? "严重" : rule.severity === "warning" ? "警告" : "信息"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleRule(rule.id)}
                          className={`relative w-10 h-5 rounded-full transition-colors ${
                            rule.enabled ? "bg-[#34c759]" : "bg-[#e5e5e7]"
                          }`}
                        >
                          <div
                            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                              rule.enabled ? "left-5 translate-x-0" : "left-0.5"
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-[#6e6e73]">
                        {rule.createdAt.toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button className="p-1.5 hover:bg-[#f5f5f7] rounded-lg transition-colors">
                            <Settings className="w-4 h-4 text-[#6e6e73]" />
                          </button>
                          <button
                            onClick={() => handleDeleteRule(rule.id)}
                            className="p-1.5 hover:bg-[#f5f5f7] rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4 text-[#ff3b30]" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
