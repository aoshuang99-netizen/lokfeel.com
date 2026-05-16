"use client";

import { useState, useEffect, useCallback } from "react";
import { Activity, Users, Calendar, TrendingUp, TrendingDown, RefreshCw, Download } from "lucide-react";
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

// Mock retention data
const generateRetentionData = () => {
  const cohorts = [];
  const now = new Date();
  
  for (let i = 0; i < 8; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i * 7);
    const cohortSize = Math.floor(200 + Math.random() * 100);
    
    const retention = [];
    let prev = 100;
    for (let d = 0; d <= 4; d++) {
      if (d === 0) {
        retention.push(100);
      } else {
        const drop = Math.random() * 15 + 5;
        prev = Math.max(prev - drop, 10);
        retention.push(Math.round(prev));
      }
    }
    
    cohorts.push({
      id: `cohort-${i}`,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      size: cohortSize,
      retention,
    });
  }
  return cohorts;
};

const COHORT_HEADERS = ["Day 0", "Day 7", "Day 14", "Day 21", "Day 28"];

export default function RetentionAnalysisPage() {
  const [loading, setLoading] = useState(true);
  const [cohorts, setCohorts] = useState<ReturnType<typeof generateRetentionData>>([]);
  const [dateRange, setDateRange] = useState("30d");
  const [selectedCohort, setSelectedCohort] = useState<string | null>(null);

  const fetchRetentionData = useCallback(async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    setCohorts(generateRetentionData());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRetentionData();
  }, [fetchRetentionData]);

  const handleExport = () => {
    const csv = [
      ["Cohort", "Size", ...COHORT_HEADERS].join(","),
      ...cohorts.map(c => [c.label, c.size, ...c.retention.map(r => `${r}%`)].join(","))
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `retention-cohorts-${dateRange}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getColor = (rate: number) => {
    if (rate >= 60) return C.success;
    if (rate >= 40) return C.primary;
    if (rate >= 20) return C.warning;
    return C.danger;
  };

  const avgRetention = cohorts.length > 0 
    ? cohorts.reduce((sum, c) => sum + c.retention[1] || 0, 0) / cohorts.length 
    : 0;

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      {/* Header */}
      <div className="bg-white border-b border-[#e5e5e7] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#34c759] to-[#30d158] flex items-center justify-center">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-[#1d1d1f]">留存分析</h1>
                <p className="text-sm text-[#6e6e73]">用户留存 cohort 分析</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
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
                onClick={fetchRetentionData}
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
        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-2xl p-5 border border-[#e5e5e7]">
            <div className="flex items-center gap-3 mb-3">
              <Users className="w-5 h-5 text-[#0071e3]" />
              <span className="text-sm text-[#6e6e73]">最新 Cohort 规模</span>
            </div>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold text-[#1d1d1f]">
                {cohorts[0]?.size.toLocaleString()}
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl p-5 border border-[#e5e5e7]">
            <div className="flex items-center gap-3 mb-3">
              <Calendar className="w-5 h-5 text-[#5856d6]" />
              <span className="text-sm text-[#6e6e73]">Cohort 数量</span>
            </div>
            {loading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-2xl font-bold text-[#1d1d1f]">{cohorts.length}</div>
            )}
          </div>
          <div className="bg-white rounded-2xl p-5 border border-[#e5e5e7]">
            <div className="flex items-center gap-3 mb-3">
              <TrendingUp className="w-5 h-5 text-[#34c759]" />
              <span className="text-sm text-[#6e6e73]">Day 7 平均留存</span>
            </div>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-[#34c759]">{avgRetention.toFixed(1)}%</div>
            )}
          </div>
          <div className="bg-white rounded-2xl p-5 border border-[#e5e5e7]">
            <div className="flex items-center gap-3 mb-3">
              <Activity className="w-5 h-5 text-[#ff9500]" />
              <span className="text-sm text-[#6e6e73]">留存趋势</span>
            </div>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[#34c759]" />
                <span className="text-2xl font-bold text-[#34c759]">+2.3%</span>
              </div>
            )}
          </div>
        </div>

        {/* Cohort Table */}
        {loading ? (
          <div className="bg-white rounded-2xl p-6 border border-[#e5e5e7]">
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#e5e5e7] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#f5f5f7]">
                    <th className="px-4 py-3 text-left text-sm font-medium text-[#6e6e73]">Cohort</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-[#6e6e73]">规模</th>
                    {COHORT_HEADERS.map((header, idx) => (
                      <th key={idx} className="px-4 py-3 text-center text-sm font-medium text-[#6e6e73]">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map((cohort, cohortIdx) => (
                    <tr
                      key={cohort.id}
                      className={`border-t border-[#e5e5e7] cursor-pointer transition-colors ${
                        selectedCohort === cohort.id ? "bg-[#f0f7ff]" : "hover:bg-[#fafafa]"
                      }`}
                      onClick={() => setSelectedCohort(selectedCohort === cohort.id ? null : cohort.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#1d1d1f]">
                            {cohort.label}
                          </span>
                          {cohortIdx === 0 && (
                            <span className="px-1.5 py-0.5 bg-[#34c759] text-white text-xs rounded">
                              最新
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-[#6e6e73]">
                        {cohort.size.toLocaleString()}
                      </td>
                      {cohort.retention.map((rate, dayIdx) => (
                        <td
                          key={dayIdx}
                          className="px-4 py-3 text-center"
                        >
                          <div
                            className="inline-flex items-center justify-center px-2 py-1 rounded-lg text-sm font-medium"
                            style={{
                              backgroundColor: `${getColor(rate)}15`,
                              color: getColor(rate),
                            }}
                          >
                            {rate}%
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Heatmap Legend */}
        {!loading && (
          <div className="mt-6 bg-white rounded-2xl p-4 border border-[#e5e5e7]">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#6e6e73]">留存率热力图</span>
              <div className="flex items-center gap-1">
                <div className="w-6 h-6 rounded bg-[#ff3b30]/15 flex items-center justify-center">
                  <span className="text-xs text-[#ff3b30]">&lt;20%</span>
                </div>
                <div className="w-6 h-6 rounded bg-[#ff9500]/15 flex items-center justify-center">
                  <span className="text-xs text-[#ff9500]">20-40%</span>
                </div>
                <div className="w-6 h-6 rounded bg-[#0071e3]/15 flex items-center justify-center">
                  <span className="text-xs text-[#0071e3]">40-60%</span>
                </div>
                <div className="w-6 h-6 rounded bg-[#34c759]/15 flex items-center justify-center">
                  <span className="text-xs text-[#34c759]">&gt;60%</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
