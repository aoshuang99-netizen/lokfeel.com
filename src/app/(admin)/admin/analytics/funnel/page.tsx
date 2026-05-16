"use client";

import { useState, useEffect, useCallback } from "react";
import { Funnel, TrendingDown, Users, Target, RefreshCw, Download, ChevronDown } from "lucide-react";
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

// Mock funnel data
const MOCK_FUNNELS = [
  {
    id: "signup-flow",
    name: "注册转化漏斗",
    steps: [
      { name: "访问落地页", count: 10000, rate: 100 },
      { name: "点击注册", count: 3500, rate: 35 },
      { name: "填写基本信息", count: 2800, rate: 28 },
      { name: "完成身份验证", count: 2100, rate: 21 },
      { name: "首次匹配", count: 1800, rate: 18 },
      { name: "付费转化", count: 450, rate: 4.5 },
    ],
  },
  {
    id: "onboarding",
    name: "新手引导漏斗",
    steps: [
      { name: "新用户注册", count: 2100, rate: 100 },
      { name: "完善个人资料", count: 1680, rate: 80 },
      { name: "上传头像", count: 1470, rate: 70 },
      { name: "填写偏好设置", count: 1260, rate: 60 },
      { name: "完成首日任务", count: 945, rate: 45 },
    ],
  },
];

const PRESET_FUNNELS = [
  { id: "signup-flow", name: "注册转化漏斗" },
  { id: "onboarding", name: "新手引导漏斗" },
  { id: "matching", name: "匹配流程漏斗" },
  { id: "payment", name: "付费转化漏斗" },
];

export default function FunnelAnalysisPage() {
  const [loading, setLoading] = useState(true);
  const [selectedFunnel, setSelectedFunnel] = useState("signup-flow");
  const [funnelData, setFunnelData] = useState<typeof MOCK_FUNNELS[0] | null>(null);
  const [dateRange, setDateRange] = useState("30d");
  const [showPresets, setShowPresets] = useState(false);

  const fetchFunnelData = useCallback(async () => {
    setLoading(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 800));
    const data = MOCK_FUNNELS.find(f => f.id === selectedFunnel) || MOCK_FUNNELS[0];
    setFunnelData(data);
    setLoading(false);
  }, [selectedFunnel]);

  useEffect(() => {
    fetchFunnelData();
  }, [fetchFunnelData]);

  const handleExport = () => {
    if (!funnelData) return;
    const csv = [
      "步骤,用户数,转化率",
      ...funnelData.steps.map(s => `"${s.name}",${s.count},${s.rate}%"`)
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `funnel-${selectedFunnel}-${dateRange}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getDropRate = (idx: number) => {
    if (!funnelData || idx === 0) return 0;
    const prev = funnelData.steps[idx - 1].count;
    const curr = funnelData.steps[idx].count;
    return prev > 0 ? ((prev - curr) / prev * 100).toFixed(1) : "0";
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      {/* Header */}
      <div className="bg-white border-b border-[#e5e5e7] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#5856d6] to-[#0071e3] flex items-center justify-center">
                <Funnel className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-[#1d1d1f]">漏斗分析</h1>
                <p className="text-sm text-[#6e6e73]">分析用户转化路径</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Date Range Selector */}
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="px-3 py-2 bg-white border border-[#e5e5e7] rounded-lg text-sm text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
              >
                <option value="7d">最近 7 天</option>
                <option value="14d">最近 14 天</option>
                <option value="30d">最近 30 天</option>
                <option value="90d">最近 90 天</option>
              </select>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-[#e5e5e7] rounded-lg text-sm text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
              >
                <Download className="w-4 h-4" />
                导出
              </button>
              <button
                onClick={fetchFunnelData}
                className="flex items-center gap-2 px-4 py-2 bg-[#0071e3] text-white rounded-lg text-sm hover:bg-[#0077ed] transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                刷新
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Funnel Selector */}
        <div className="bg-white rounded-2xl p-4 mb-6 border border-[#e5e5e7]">
          <div className="relative">
            <button
              onClick={() => setShowPresets(!showPresets)}
              className="flex items-center justify-between w-full px-4 py-3 bg-[#f5f5f7] rounded-xl text-left"
            >
              <div className="flex items-center gap-3">
                <Target className="w-5 h-5 text-[#5856d6]" />
                <span className="font-medium text-[#1d1d1f]">
                  {funnelData?.name || "选择漏斗"}
                </span>
              </div>
              <ChevronDown className={`w-5 h-5 text-[#6e6e73] transition-transform ${showPresets ? "rotate-180" : ""}`} />
            </button>
            {showPresets && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl border border-[#e5e5e7] shadow-lg z-20">
                {PRESET_FUNNELS.map(funnel => (
                  <button
                    key={funnel.id}
                    onClick={() => {
                      setSelectedFunnel(funnel.id);
                      setShowPresets(false);
                    }}
                    className={`w-full px-4 py-3 text-left hover:bg-[#f5f5f7] first:rounded-t-xl last:rounded-b-xl ${
                      selectedFunnel === funnel.id ? "bg-[#f5f5f7] text-[#0071e3]" : "text-[#1d1d1f]"
                    }`}
                  >
                    {funnel.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Funnel Visualization */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        ) : funnelData ? (
          <div className="space-y-4">
            {funnelData.steps.map((step, idx) => {
              const widthPercent = step.rate;
              const dropRate = idx > 0 ? getDropRate(idx) : 0;
              return (
                <div key={idx} className="relative">
                  {/* Step Card */}
                  <div
                    className="bg-white rounded-2xl p-5 border border-[#e5e5e7] overflow-hidden relative"
                    style={{ width: `${Math.max(widthPercent, 15)}%` }}
                  >
                    <div
                      className="absolute inset-0 opacity-10"
                      style={{
                        background: `linear-gradient(90deg, ${C.primary} 0%, ${C.secondary} 100%)`
                      }}
                    />
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-[#6e6e73]">
                          步骤 {idx + 1}
                        </span>
                        {dropRate !== 0 && dropRate !== "0" && (
                          <span className="flex items-center gap-1 text-sm text-[#ff3b30]">
                            <TrendingDown className="w-3 h-3" />
                            -{dropRate}%
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-semibold text-[#1d1d1f] mb-2">{step.name}</h3>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-[#1d1d1f]">
                          {step.count.toLocaleString()}
                        </span>
                        <span className="text-sm text-[#6e6e73]">用户</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-[#f5f5f7] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${step.rate}%`,
                              background: `linear-gradient(90deg, ${C.primary}, ${C.secondary})`
                            }}
                          />
                        </div>
                        <span className="text-xs text-[#6e6e73]">{step.rate}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Connector Line */}
                  {idx < funnelData.steps.length - 1 && (
                    <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 top-full w-0.5 h-4 bg-[#e5e5e7]" />
                  )}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Summary Stats */}
        {!loading && funnelData && (
          <div className="mt-8 grid grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl p-5 border border-[#e5e5e7]">
              <div className="flex items-center gap-3 mb-3">
                <Users className="w-5 h-5 text-[#0071e3]" />
                <span className="text-sm text-[#6e6e73]">入口用户</span>
              </div>
              <div className="text-2xl font-bold text-[#1d1d1f]">
                {funnelData.steps[0]?.count.toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-2xl p-5 border border-[#e5e5e7]">
              <div className="flex items-center gap-3 mb-3">
                <Target className="w-5 h-5 text-[#34c759]" />
                <span className="text-sm text-[#6e6e73]">完成用户</span>
              </div>
              <div className="text-2xl font-bold text-[#1d1d1f]">
                {funnelData.steps[funnelData.steps.length - 1]?.count.toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-2xl p-5 border border-[#e5e5e7]">
              <div className="flex items-center gap-3 mb-3">
                <TrendingDown className="w-5 h-5 text-[#ff3b30]" />
                <span className="text-sm text-[#6e6e73]">总流失率</span>
              </div>
              <div className="text-2xl font-bold text-[#ff3b30]">
                {(
                  (1 -
                    funnelData.steps[funnelData.steps.length - 1].count /
                      funnelData.steps[0].count) *
                  100
                ).toFixed(1)}
                %
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
