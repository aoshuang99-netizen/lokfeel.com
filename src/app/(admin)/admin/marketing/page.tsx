"use client";

import { useState } from "react";
import { Megaphone, Send, Clock, Users, BarChart3, Plus, RefreshCw, Tag, Percent } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export default function MarketingPage() {
  const [tab, setTab] = useState<"push" | "promo" | "history">("push");
  const [loading, setLoading] = useState(false);

  const handleSendPush = async () => {
    toast.info("推送通知功能即将上线");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">营销管理</h1>
          <p className="text-[#86868b] text-sm mt-0.5">推送通知、优惠券和营销活动管理</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-[#f5f5f7] w-fit">
        {[
          { key: "push", label: "推送通知", icon: Megaphone },
          { key: "promo", label: "优惠券", icon: Percent },
          { key: "history", label: "发送历史", icon: Clock },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.key ? "bg-white shadow-sm text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "push" && (
        <div className="space-y-4">
          {/* Quick stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "今日已发", value: "0", icon: Send, color: "#0071e3" },
              { label: "送达率", value: "—", icon: BarChart3, color: "#34c759" },
              { label: "点击率", value: "—", icon: Users, color: "#5856d6" },
              { label: "模板数", value: "0", icon: Megaphone, color: "#ff9500" },
            ].map((stat, i) => (
              <div key={i} className="rounded-xl border border-[#e5e5e7] bg-white p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${stat.color}10` }}>
                    <stat.icon className="w-3.5 h-3.5" style={{ color: stat.color }} />
                  </div>
                  <p className="text-[11px] text-[#86868b] uppercase tracking-wide font-medium">{stat.label}</p>
                </div>
                <p className="text-2xl font-bold text-[#1d1d1f] ml-9">{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Push compose */}
          <div className="rounded-xl border border-[#e5e5e7] bg-white p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
              <Send className="w-4 h-4 text-[#0071e3]" />
              新建推送通知
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#86868b] mb-1.5">标题</label>
                <input
                  type="text" placeholder="输入推送标题..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[#e5e5e7] bg-white text-[#1d1d1f] placeholder:text-[#86868b] focus:outline-none focus:border-[#0071e3]/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#86868b] mb-1.5">内容</label>
                <textarea
                  rows={3} placeholder="输入推送内容..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[#e5e5e7] bg-white text-[#1d1d1f] placeholder:text-[#86868b] focus:outline-none focus:border-[#0071e3]/40 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#86868b] mb-1.5">目标用户</label>
                  <select className="w-full px-3 py-2 text-sm rounded-lg border border-[#e5e5e7] bg-white text-[#1d1d1f]">
                    <option>全部用户</option>
                    <option>活跃用户 (7天)</option>
                    <option>付费用户</option>
                    <option>未付费用户</option>
                    <option>新注册用户 (3天)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#86868b] mb-1.5">定时发送</label>
                  <input type="datetime-local" className="w-full px-3 py-2 text-sm rounded-lg border border-[#e5e5e7] bg-white text-[#1d1d1f]" />
                </div>
              </div>
              <button
                onClick={handleSendPush}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0071e3] text-white text-sm font-medium hover:bg-[#0077ed] transition-colors"
              >
                <Send className="w-3.5 h-3.5" /> 发送推送
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "promo" && (
        <div className="rounded-xl border border-[#e5e5e7] bg-white p-12 text-center">
          <Percent className="w-12 h-12 text-[#e5e5e7] mx-auto mb-3" />
          <p className="text-[#1d1d1f] font-medium text-sm">优惠券管理</p>
          <p className="text-[#86868b] text-xs mt-1">创建和管理优惠码、折扣活动</p>
          <button className="mt-4 flex items-center gap-1.5 mx-auto px-4 py-2 rounded-lg bg-[#0071e3] text-white text-sm font-medium hover:bg-[#0077ed] transition-colors">
            <Plus className="w-3.5 h-3.5" /> 新建优惠券
          </button>
        </div>
      )}

      {tab === "history" && (
        <div className="rounded-xl border border-[#e5e5e7] bg-white p-12 text-center">
          <Clock className="w-12 h-12 text-[#e5e5e7] mx-auto mb-3" />
          <p className="text-[#1d1d1f] font-medium text-sm">发送历史</p>
          <p className="text-[#86868b] text-xs mt-1">暂无推送发送记录</p>
        </div>
      )}
    </div>
  );
}
