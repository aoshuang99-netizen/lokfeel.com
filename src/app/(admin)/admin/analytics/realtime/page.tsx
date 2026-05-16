"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Activity, Wifi, WifiOff, Users, Zap, Clock, RefreshCw, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

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

interface MetricData {
  name: string;
  value: number;
  change: number;
  trend: "up" | "down" | "stable";
  unit?: string;
}

interface AlertItem {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  timestamp: Date;
  acknowledged: boolean;
}

export default function RealtimeMonitorPage() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<MetricData[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 600));
    
    setMetrics([
      { name: "活跃用户", value: 1247, change: 12.5, trend: "up", unit: "人" },
      { name: "在线匹配", value: 89, change: -3.2, trend: "down", unit: "个" },
      { name: "消息/秒", value: 234, change: 8.7, trend: "up", unit: "条" },
      { name: "API 延迟", value: 45, change: -15.3, trend: "up", unit: "ms" },
      { name: "队列长度", value: 12, change: 0, trend: "stable", unit: "个" },
      { name: "错误率", value: 0.12, change: -50, trend: "up", unit: "%" },
    ]);

    setAlerts([
      {
        id: "alert-1",
        type: "info",
        message: "系统正常 - 所有服务运行正常",
        timestamp: new Date(),
        acknowledged: true,
      },
      {
        id: "alert-2",
        type: "warning",
        message: "匹配服务延迟略高 (P95: 120ms)",
        timestamp: new Date(Date.now() - 300000),
        acknowledged: false,
      },
    ]);

    setLastUpdate(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchInitialData();

    // Simulate WebSocket with polling
    const pollInterval = setInterval(() => {
      setMetrics(prev => prev.map(m => ({
        ...m,
        value: m.unit === "%" 
          ? Math.max(0, m.value + (Math.random() - 0.5) * 0.1)
          : m.name === "API 延迟"
          ? Math.max(10, m.value + (Math.random() - 0.5) * 10)
          : Math.max(0, m.value + Math.floor((Math.random() - 0.5) * 20)),
      })));
      setLastUpdate(new Date());
      setConnected(true);
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [fetchInitialData]);

  const acknowledgeAlert = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
  };

  const dismissAlert = (id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const getAlertIcon = (type: AlertItem["type"]) => {
    switch (type) {
      case "error":
        return <AlertTriangle className="w-4 h-4 text-[#ff3b30]" />;
      case "warning":
        return <AlertTriangle className="w-4 h-4 text-[#ff9500]" />;
      default:
        return <Activity className="w-4 h-4 text-[#0071e3]" />;
    }
  };

  const getAlertBg = (type: AlertItem["type"]) => {
    switch (type) {
      case "error":
        return "bg-[#ff3b30]/10 border-[#ff3b30]/30";
      case "warning":
        return "bg-[#ff9500]/10 border-[#ff9500]/30";
      default:
        return "bg-[#0071e3]/10 border-[#0071e3]/30";
    }
  };

  const getChangeColor = (change: number) => {
    if (change > 0) return "text-[#34c759]";
    if (change < 0) return "text-[#ff3b30]";
    return "text-[#6e6e73]";
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      {/* Header */}
      <div className="bg-white border-b border-[#e5e5e7] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#34c759] to-[#30d158] flex items-center justify-center">
                  <Activity className="w-5 h-5 text-white" />
                </div>
                <div
                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                    connected ? "bg-[#34c759]" : "bg-[#ff3b30]"
                  }`}
                />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-[#1d1d1f]">实时监控</h1>
                <div className="flex items-center gap-2 text-sm text-[#6e6e73]">
                  {connected ? (
                    <>
                      <Wifi className="w-3 h-3 text-[#34c759]" />
                      <span>已连接</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-3 h-3 text-[#ff3b30]" />
                      <span>未连接</span>
                    </>
                  )}
                  {lastUpdate && (
                    <span className="text-[#86868b]">
                      · 最后更新 {lastUpdate.toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={fetchInitialData}
              className="flex items-center gap-2 px-4 py-2 bg-[#0071e3] text-white rounded-lg text-sm hover:bg-[#0077ed] transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Live Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))
          ) : (
            metrics.map((metric, idx) => (
              <div
                key={idx}
                className="bg-white rounded-2xl p-4 border border-[#e5e5e7] relative overflow-hidden"
              >
                <div
                  className="absolute top-0 left-0 w-1 h-full"
                  style={{
                    background: `linear-gradient(180deg, ${
                      metric.trend === "up" ? C.success : metric.trend === "down" ? C.danger : C.textMuted
                    } 0%, transparent 100%)`
                  }}
                />
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-[#6e6e73]">{metric.name}</span>
                    <div
                      className={`w-2 h-2 rounded-full ${
                        connected ? "bg-[#34c759] animate-pulse" : "bg-[#ff3b30]"
                      }`}
                    />
                  </div>
                  <div className="text-2xl font-bold text-[#1d1d1f]">
                    {metric.unit === "%" 
                      ? metric.value.toFixed(2)
                      : metric.value.toLocaleString()}
                    {metric.unit && <span className="text-sm text-[#6e6e73] ml-1">{metric.unit}</span>}
                  </div>
                  <div className={`text-xs ${getChangeColor(metric.change)} mt-1`}>
                    {metric.change > 0 ? "+" : ""}{metric.change.toFixed(1)}%
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active Users Trend */}
          <div className="lg:col-span-2 bg-white rounded-2xl p-5 border border-[#e5e5e7]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#1d1d1f]">活跃用户趋势</h2>
              <div className="flex items-center gap-2 text-sm text-[#6e6e73]">
                <Clock className="w-4 h-4" />
                实时更新
              </div>
            </div>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <div className="h-48 flex items-end justify-between gap-1">
                {Array.from({ length: 20 }).map((_, i) => {
                  const height = 30 + Math.random() * 70;
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-t transition-all duration-300"
                      style={{
                        height: `${height}%`,
                        background: `linear-gradient(180deg, ${C.primary} 0%, ${C.secondary} 100%)`,
                        opacity: 0.6 + (i / 20) * 0.4,
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Alerts Panel */}
          <div className="bg-white rounded-2xl p-5 border border-[#e5e5e7]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#1d1d1f]">实时告警</h2>
              <span className="px-2 py-0.5 bg-[#ff3b30] text-white text-xs rounded-full">
                {alerts.filter(a => !a.acknowledged).length}
              </span>
            </div>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))
              ) : alerts.length === 0 ? (
                <div className="text-center py-8 text-[#6e6e73]">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">暂无告警</p>
                </div>
              ) : (
                alerts.map(alert => (
                  <div
                    key={alert.id}
                    className={`p-3 rounded-xl border ${getAlertBg(alert.type)} ${
                      alert.acknowledged ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {getAlertIcon(alert.type)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#1d1d1f]">{alert.message}</p>
                        <p className="text-xs text-[#86868b] mt-1">
                          {alert.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                      {!alert.acknowledged && (
                        <button
                          onClick={() => acknowledgeAlert(alert.id)}
                          className="text-xs text-[#0071e3] hover:underline"
                        >
                          确认
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* System Status */}
        {!loading && (
          <div className="mt-6 bg-white rounded-2xl p-5 border border-[#e5e5e7]">
            <h2 className="text-lg font-semibold text-[#1d1d1f] mb-4">服务状态</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { name: "API 服务", status: "healthy", latency: 45 },
                { name: "数据库", status: "healthy", latency: 12 },
                { name: "Redis 缓存", status: "healthy", latency: 2 },
                { name: "匹配引擎", status: "warning", latency: 120 },
              ].map((service, i) => (
                <div key={i} className="p-3 bg-[#f5f5f7] rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[#1d1d1f]">{service.name}</span>
                    <div className={`w-2 h-2 rounded-full ${
                      service.status === "healthy" ? "bg-[#34c759]" : "bg-[#ff9500]"
                    }`} />
                  </div>
                  <div className="text-xs text-[#6e6e73]">
                    延迟: {service.latency}ms
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
