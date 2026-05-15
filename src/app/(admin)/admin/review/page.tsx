"use client";

import { useState, useEffect, useCallback } from "react";
import { Shield, AlertTriangle, UserX, UserCheck, Eye, Search, RefreshCw, Flag, Camera, MessageSquare, Ban } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface ReportItem {
  id: string;
  type: "report" | "photo_verify" | "flagged";
  severity: "high" | "medium" | "low";
  reporter: string;
  targetUser: string;
  targetUserId: string;
  reason: string;
  description: string;
  status: "pending" | "reviewing" | "resolved" | "dismissed";
  createdAt: string;
}

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: "高", color: "#ff3b30", bg: "#ff3b3010" },
  medium: { label: "中", color: "#ff9500", bg: "#ff950010" },
  low: { label: "低", color: "#0071e3", bg: "#0071e310" },
};

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Shield }> = {
  report: { label: "用户举报", icon: Flag },
  photo_verify: { label: "照片验证", icon: Camera },
  flagged: { label: "系统标记", icon: AlertTriangle },
};

const MOCK_REPORTS: ReportItem[] = [
  { id:"R001",type:"report",severity:"high",reporter:"用户A",targetUser:"用户X",targetUserId:"user_x",reason:"骚扰行为",description:"该用户发送了多条不适当的消息给其他用户",status:"pending",createdAt:"2026-05-15T10:00:00Z" },
  { id:"R002",type:"report",severity:"medium",reporter:"用户B",targetUser:"用户Y",targetUserId:"user_y",reason:"虚假资料",description:"用户资料照片与本人不符，疑似使用他人照片",status:"pending",createdAt:"2026-05-15T09:30:00Z" },
  { id:"R003",type:"photo_verify",severity:"high",reporter:"系统",targetUser:"用户Z",targetUserId:"user_z",reason:"照片审核",description:"上传的照片包含不适当内容，需要人工审核",status:"pending",createdAt:"2026-05-15T09:00:00Z" },
  { id:"R004",type:"flagged",severity:"medium",reporter:"系统",targetUser:"用户W",targetUserId:"user_w",reason:"异常行为",description:"该用户在短时间内大量发送匹配请求，疑似机器人",status:"pending",createdAt:"2026-05-15T08:00:00Z" },
  { id:"R005",type:"report",severity:"low",reporter:"用户C",targetUser:"用户V",targetUserId:"user_v",reason:"垃圾信息",description:"发送商业推广链接",status:"reviewing",createdAt:"2026-05-14T22:00:00Z" },
  { id:"R006",type:"photo_verify",severity:"low",reporter:"系统",targetUser:"用户U",targetUserId:"user_u",reason:"照片质量",description:"用户照片质量较低，建议引导更换",status:"pending",createdAt:"2026-05-14T20:00:00Z" },
  { id:"R007",type:"report",severity:"high",reporter:"用户D",targetUser:"用户T",targetUserId:"user_t",reason:"诈骗行为",description:"用户试图引导其他用户到外部平台进行金钱交易",status:"resolved",createdAt:"2026-05-14T18:00:00Z" },
  { id:"R008",type:"flagged",severity:"high",reporter:"系统",targetUser:"用户S",targetUserId:"user_s",reason:"未成年保护",description:"系统检测该用户可能未满18岁",status:"dismissed",createdAt:"2026-05-14T16:00:00Z" },
];

export default function ReviewPage() {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    // Simulate API fetch
    const timer = setTimeout(() => {
      setReports(MOCK_REPORTS);
      setLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const filtered = reports.filter(r => {
    if (filter !== "all" && filter !== r.status) return false;
    if (search && !r.targetUser.toLowerCase().includes(search.toLowerCase()) && !r.reason.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: reports.length,
    pending: reports.filter(r => r.status === "pending").length,
    high: reports.filter(r => r.severity === "high" && r.status === "pending").length,
    resolved: reports.filter(r => r.status === "resolved").length,
  };

  const handleAction = (id: string, action: "review" | "warn" | "ban" | "dismiss") => {
    setReports(prev => prev.map(r => {
      if (r.id !== id) return r;
      if (action === "review") return { ...r, status: "reviewing" as const };
      if (action === "dismiss") return { ...r, status: "dismissed" as const };
      return { ...r, status: "resolved" as const };
    }));
    const labels: Record<string, string> = { review: "开始审核", warn: "已发送警告", ban: "已封禁用户", dismiss: "已忽略" };
    toast.success(labels[action] || "操作成功");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">用户审核</h1>
          <p className="text-[#86868b] text-sm mt-0.5">举报处理 · 照片验证 · 安全审查</p>
        </div>
        <button onClick={() => { setLoading(true); setTimeout(() => { setReports(MOCK_REPORTS); setLoading(false); }, 300); }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-[#e5e5e7] hover:border-[#0071e3]/30 text-sm text-[#1d1d1f] transition-all">
          <RefreshCw className={`w-3.5 h-3.5 text-[#86868b] ${loading ? "animate-spin" : ""}`} /> 刷新
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "待处理", value: stats.pending, icon: AlertTriangle, color: "#ff9500" },
          { label: "高优先级", value: stats.high, icon: Shield, color: "#ff3b30" },
          { label: "审核中", value: reports.filter(r=>r.status==="reviewing").length, icon: Eye, color: "#0071e3" },
          { label: "已处理", value: stats.resolved + reports.filter(r=>r.status==="dismissed").length, icon: UserCheck, color: "#34c759" },
        ].map((s, i) => (
          <button
            key={i}
            onClick={() => setFilter(filter === s.label ? "all" : (s.label === "待处理" ? "pending" : s.label === "高优先级" ? "high" : s.label === "审核中" ? "reviewing" : "resolved"))}
            className={`rounded-xl border p-4 text-left transition-all ${filter === (s.label === "待处理" ? "pending" : s.label === "高优先级" ? "high" : s.label === "审核中" ? "reviewing" : "resolved") ? "border-[#0071e3]/40 bg-[#0071e3]/3" : "border-[#e5e5e7] bg-white hover:border-[#0071e3]/20"}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${s.color}10` }}>
                <s.icon className="w-3.5 h-3.5" style={{ color: s.color }} />
              </div>
              <p className="text-[11px] text-[#86868b] uppercase tracking-wide font-medium">{s.label}</p>
            </div>
            <p className="text-2xl font-bold text-[#1d1d1f] ml-9">{s.value}</p>
          </button>
        ))}
      </div>

      {/* Filter & Search */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={filter} onChange={e => setFilter(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-[#e5e5e7] bg-white text-[#1d1d1f]">
          <option value="all">全部状态</option>
          <option value="pending">待处理</option>
          <option value="reviewing">审核中</option>
          <option value="resolved">已处理</option>
          <option value="dismissed">已忽略</option>
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#86868b]" />
          <input type="text" placeholder="搜索用户名或原因..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#e5e5e7] bg-white text-[#1d1d1f] placeholder:text-[#86868b] focus:outline-none focus:border-[#0071e3]/40" />
        </div>
      </div>

      {/* Reports List */}
      <div className="rounded-xl border border-[#e5e5e7] bg-white overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-20 w-full"/>)}</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Shield className="w-10 h-10 text-[#e5e5e7] mx-auto mb-3" />
            <p className="text-[#1d1d1f] font-medium text-sm">暂无审核项</p>
            <p className="text-[#86868b] text-xs mt-1">当用户举报或系统标记时将出现在此</p>
          </div>
        ) : (
          <div className="divide-y divide-[#e5e5e7]">
            {filtered.map((item) => {
              const sev = SEVERITY_CONFIG[item.severity] || SEVERITY_CONFIG.low;
              const typ = TYPE_CONFIG[item.type] || TYPE_CONFIG.report;
              const Icon = typ.icon;
              return (
                <div key={item.id} className="p-4 hover:bg-[#f5f5f7] transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: sev.bg }}>
                      <Icon className="w-4 h-4" style={{ color: sev.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-semibold text-[#1d1d1f]">{item.targetUser}</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: sev.bg, color: sev.color }}>{sev.label}优先级</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#f5f5f7] text-[#86868b]">{typ.label}</span>
                        <code className="text-[10px] text-[#86868b]">{item.id}</code>
                      </div>
                      <p className="text-xs text-[#6e6e73] mb-1"><strong>原因:</strong> {item.reason}</p>
                      <p className="text-xs text-[#86868b]">{item.description}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px] text-[#86868b]">举报人: {item.reporter}</span>
                        <span className="text-[10px] text-[#86868b]">{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
                      </div>
                    </div>
                    {item.status === "pending" && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => handleAction(item.id, "review")} className="px-2.5 py-1.5 rounded-lg bg-[#0071e3] text-white text-[11px] font-medium hover:bg-[#0077ed] transition-colors">审核</button>
                        <button onClick={() => handleAction(item.id, "warn")} className="px-2.5 py-1.5 rounded-lg border border-[#e5e5e7] text-[#86868b] text-[11px] font-medium hover:bg-[#ff950010] hover:text-[#ff9500] hover:border-[#ff9500]/30 transition-colors">警告</button>
                        <button onClick={() => handleAction(item.id, "dismiss")} className="px-2.5 py-1.5 rounded-lg border border-[#e5e5e7] text-[#86868b] text-[11px] font-medium hover:text-[#1d1d1f] transition-colors">忽略</button>
                      </div>
                    )}
                    {item.status === "reviewing" && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => handleAction(item.id, "warn")} className="px-2.5 py-1.5 rounded-lg border border-[#e5e5e7] text-[#86868b] text-[11px] font-medium hover:bg-[#ff950010] hover:text-[#ff9500] transition-colors">警告</button>
                        <button onClick={() => handleAction(item.id, "ban")} className="px-2.5 py-1.5 rounded-lg bg-[#ff3b30] text-white text-[11px] font-medium hover:bg-[#e03500] transition-colors">封禁</button>
                        <button onClick={() => handleAction(item.id, "dismiss")} className="px-2.5 py-1.5 rounded-lg border border-[#e5e5e7] text-[#86868b] text-[11px] font-medium transition-colors">忽略</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
