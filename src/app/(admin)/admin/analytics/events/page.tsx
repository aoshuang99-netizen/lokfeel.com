"use client";

import { useState, useEffect, useCallback } from "react";
import { Activity, TrendingUp, Filter, RefreshCw, Search, Download, Zap, ChevronRight } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface EventItem {
  id: string;
  event: string;
  eventCategory: string;
  userId: string | null;
  sessionId: string;
  pagePath: string;
  platform: string;
  country: string | null;
  ipAddress: string | null;
  createdAt: string;
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  user: "#0071e3",
  match: "#5856d6",
  chat: "#34c759",
  revenue: "#ff9500",
  admin: "#ff3b30",
  system: "#86868b",
  other: "#af52de",
};

const CATEGORY_LABELS: Record<string, string> = {
  user: "用户",
  match: "匹配",
  chat: "聊天",
  revenue: "收入",
  admin: "管理",
  system: "系统",
  other: "其他",
};

const TOOLTIP_STYLE = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e5e7",
  borderRadius: "8px",
  color: "#1d1d1f",
  fontSize: "12px",
  padding: "8px 12px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
};

export default function AnalyticsEventsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filterEvent, setFilterEvent] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [search, setSearch] = useState("");

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (filterEvent) params.set("event", filterEvent);
      if (filterCategory) params.set("category", filterCategory);
      if (search) params.set("search", search);

      const res = await fetch(`/api/admin/analytics/events?${params}`, { credentials: "include" });
      const json = await res.json();
      if (json.success) {
        setEvents(json.data);
        setMeta(json.meta);
      } else {
        toast.error(json.error?.message || "加载失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setLoading(false);
    }
  }, [page, filterEvent, filterCategory, search]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">事件分析</h1>
          <p className="text-[#86868b] text-sm mt-0.5">埋点事件数据查询与分析</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchEvents} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-[#e5e5e7] hover:border-[#0071e3]/30 text-sm text-[#1d1d1f] transition-all">
            <RefreshCw className={`w-3.5 h-3.5 text-[#86868b] ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>
      </div>

      {/* Stats cards */}
      {meta && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-[#e5e5e7] bg-white p-4">
            <p className="text-[11px] text-[#86868b] uppercase tracking-wide font-medium">总事件数</p>
            <p className="text-2xl font-bold text-[#1d1d1f] mt-1">{meta.total.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-[#e5e5e7] bg-white p-4">
            <p className="text-[11px] text-[#86868b] uppercase tracking-wide font-medium">当前页</p>
            <p className="text-2xl font-bold text-[#1d1d1f] mt-1">{meta.page} / {meta.totalPages}</p>
          </div>
          <div className="rounded-xl border border-[#e5e5e7] bg-white p-4">
            <p className="text-[11px] text-[#86868b] uppercase tracking-wide font-medium">每页条数</p>
            <p className="text-2xl font-bold text-[#1d1d1f] mt-1">{meta.pageSize}</p>
          </div>
          <div className="rounded-xl border border-[#e5e5e7] bg-white p-4">
            <p className="text-[11px] text-[#86868b] uppercase tracking-wide font-medium">筛选条件</p>
            <p className="text-sm font-semibold text-[#1d1d1f] mt-1">
              {[filterCategory, filterEvent, search].filter(Boolean).length || "无"}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#86868b]" />
          <input
            type="text"
            placeholder="搜索事件名..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#e5e5e7] bg-white text-[#1d1d1f] placeholder:text-[#86868b] focus:outline-none focus:border-[#0071e3]/40"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm rounded-lg border border-[#e5e5e7] bg-white text-[#1d1d1f]"
        >
          <option value="">所有分类</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="事件名精确匹配..."
          value={filterEvent}
          onChange={(e) => { setFilterEvent(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm rounded-lg border border-[#e5e5e7] bg-white text-[#1d1d1f] placeholder:text-[#86868b] focus:outline-none focus:border-[#0071e3]/40 w-48"
        />
      </div>

      {/* Event Table */}
      <div className="rounded-xl border border-[#e5e5e7] bg-white overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : events.length === 0 ? (
          <div className="p-12 text-center">
            <Activity className="w-10 h-10 text-[#e5e5e7] mx-auto mb-3" />
            <p className="text-[#86868b] text-sm">暂无事件数据</p>
            <p className="text-[#86868b] text-xs mt-1">前端埋点SDK接入后数据将自动上报</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#e5e5e7] bg-[#f5f5f7]">
                    <th className="text-left py-2.5 px-3 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">时间</th>
                    <th className="text-left py-2.5 px-3 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">事件名</th>
                    <th className="text-left py-2.5 px-3 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">分类</th>
                    <th className="text-left py-2.5 px-3 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">用户ID</th>
                    <th className="text-left py-2.5 px-3 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">页面</th>
                    <th className="text-left py-2.5 px-3 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">国家</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((evt) => (
                    <tr key={evt.id} className="border-b border-[#e5e5e7]/50 hover:bg-[#f5f5f7] transition-colors">
                      <td className="py-2 px-3 text-xs text-[#86868b] whitespace-nowrap font-mono">{formatTime(evt.createdAt)}</td>
                      <td className="py-2 px-3">
                        <span className="text-xs font-medium text-[#1d1d1f]">{evt.event}</span>
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ backgroundColor: `${CATEGORY_COLORS[evt.eventCategory] || CATEGORY_COLORS.other}15`, color: CATEGORY_COLORS[evt.eventCategory] || CATEGORY_COLORS.other }}
                        >
                          {CATEGORY_LABELS[evt.eventCategory] || evt.eventCategory}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-[#6e6e73] font-mono max-w-[150px] truncate">{evt.userId || "—"}</td>
                      <td className="py-2 px-3 text-xs text-[#6e6e73] max-w-[200px] truncate">{evt.pagePath || "—"}</td>
                      <td className="py-2 px-3 text-xs text-[#86868b]">{evt.country || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {meta && meta.totalPages > 1 && (
              <div className="px-4 py-2.5 border-t border-[#e5e5e7] flex items-center justify-between bg-[#fafafa]">
                <p className="text-[11px] text-[#86868b]">
                  共 {meta.total.toLocaleString()} 条，第 {meta.page} / {meta.totalPages} 页
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-2.5 py-1 text-xs rounded-md border border-[#e5e5e7] disabled:opacity-30 hover:bg-[#f5f5f7] transition-all"
                  >
                    上一页
                  </button>
                  <span className="px-2 text-xs text-[#86868b]">{page}</span>
                  <button
                    onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                    disabled={page >= meta.totalPages}
                    className="px-2.5 py-1 text-xs rounded-md border border-[#e5e5e7] disabled:opacity-30 hover:bg-[#f5f5f7] transition-all"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
