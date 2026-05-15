"use client";

import { useState, useEffect, useCallback } from "react";
import { FileText, Search, Filter, RefreshCw, Eye, CheckCircle, XCircle, Flag, AlertTriangle, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface ContentItem {
  id: string;
  type: "profile" | "photo" | "bio" | "report";
  userId: string;
  userName: string;
  status: "pending" | "approved" | "rejected" | "flagged";
  summary: string;
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "待审核", color: "#ff9500", bg: "#ff950010" },
  approved: { label: "已通过", color: "#34c759", bg: "#34c75910" },
  rejected: { label: "已拒绝", color: "#ff3b30", bg: "#ff3b3010" },
  flagged: { label: "已标记", color: "#0071e3", bg: "#0071e310" },
};

export default function ContentPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const fetchContent = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/content?${params}`, { credentials: "include" });
      const json = await res.json();
      if (json.success) {
        setItems(json.data || []);
      } else {
        toast.error(json.error?.message || "加载失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => { fetchContent(); }, [fetchContent]);

  const handleAction = async (id: string, action: "approve" | "reject" | "flag") => {
    try {
      const res = await fetch(`/api/admin/content/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
        credentials: "include",
      });
      if (res.ok) {
        toast.success(action === "approve" ? "已通过" : action === "reject" ? "已拒绝" : "已标记");
        fetchContent();
      }
    } catch {
      toast.error("操作失败");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">内容审核</h1>
          <p className="text-[#86868b] text-sm mt-0.5">审核用户资料、照片和举报内容</p>
        </div>
        <button onClick={fetchContent} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-[#e5e5e7] hover:border-[#0071e3]/30 text-sm text-[#1d1d1f] transition-all">
          <RefreshCw className={`w-3.5 h-3.5 text-[#86868b] ${loading ? "animate-spin" : ""}`} /> 刷新
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Object.entries(STATUS_CONFIG).map(([key, config]) => (
          <button
            key={key}
            onClick={() => setFilter(filter === key ? "all" : key)}
            className={`rounded-xl border p-4 text-left transition-all ${
              filter === key ? "border-[#0071e3]/40 bg-[#0071e3]/3" : "border-[#e5e5e7] bg-white hover:border-[#0071e3]/20"
            }`}
          >
            <p className="text-[11px] text-[#86868b] uppercase tracking-wide font-medium">{config.label}</p>
            <p className="text-2xl font-bold text-[#1d1d1f] mt-1">—</p>
          </button>
        ))}
      </div>

      {/* Filter & Search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#86868b]" />
          <input
            type="text" placeholder="搜索用户名或内容..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#e5e5e7] bg-white text-[#1d1d1f] placeholder:text-[#86868b] focus:outline-none focus:border-[#0071e3]/40"
          />
        </div>
      </div>

      {/* Content List */}
      <div className="rounded-xl border border-[#e5e5e7] bg-white overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-10 h-10 text-[#e5e5e7] mx-auto mb-3" />
            <p className="text-[#1d1d1f] font-medium text-sm">暂无待审核内容</p>
            <p className="text-[#86868b] text-xs mt-1">当用户提交新资料或照片时将出现在此</p>
          </div>
        ) : (
          <div className="divide-y divide-[#e5e5e7]">
            {items.map((item) => {
              const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
              return (
                <div key={item.id} className="p-4 hover:bg-[#f5f5f7] transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-[#1d1d1f]">{item.userName}</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ backgroundColor: statusCfg.bg, color: statusCfg.color }}>
                          {statusCfg.label}
                        </span>
                        <span className="text-[10px] text-[#86868b] uppercase">{item.type}</span>
                      </div>
                      <p className="text-xs text-[#6e6e73]">{item.summary}</p>
                    </div>
                    {item.status === "pending" && (
                      <div className="flex items-center gap-1 ml-4">
                        <button onClick={() => handleAction(item.id, "approve")} className="p-1.5 rounded-md hover:bg-[#34c75910] text-[#86868b] hover:text-[#34c759] transition-colors" title="通过">
                          <CheckCircle className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleAction(item.id, "reject")} className="p-1.5 rounded-md hover:bg-[#ff3b3010] text-[#86868b] hover:text-[#ff3b30] transition-colors" title="拒绝">
                          <XCircle className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleAction(item.id, "flag")} className="p-1.5 rounded-md hover:bg-[#0071e310] text-[#86868b] hover:text-[#0071e3] transition-colors" title="标记">
                          <Flag className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-[#86868b] mt-2">
                    {new Date(item.createdAt).toLocaleString("zh-CN")}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
