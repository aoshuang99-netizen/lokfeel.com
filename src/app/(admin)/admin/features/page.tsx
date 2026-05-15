"use client";

import { useState } from "react";
import { ToggleLeft, ToggleRight, Plus, RefreshCw, ShieldAlert, Zap, Globe, Users } from "lucide-react";
import { toast } from "sonner";

interface FeatureFlag {
  id: string;
  name: string;
  key: string;
  description: string;
  enabled: boolean;
  rollout: number; // 0-100 percentage
  category: "matching" | "ui" | "experiment" | "infra";
  updatedAt: string;
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  matching: { label: "匹配", color: "#0071e3" },
  ui: { label: "界面", color: "#5856d6" },
  experiment: { label: "实验", color: "#ff9500" },
  infra: { label: "基础设施", color: "#34c759" },
};

export default function FeaturesPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([
    { id: "1", name: "AI 匹配增强", key: "ai_matching_v2", description: "使用改进的AI算法进行匹配推荐", enabled: true, rollout: 50, category: "matching", updatedAt: new Date().toISOString() },
    { id: "2", name: "新用户引导流程", key: "onboarding_v3", description: "简化的三步引导流程（实验性）", enabled: false, rollout: 0, category: "ui", updatedAt: new Date().toISOString() },
    { id: "3", name: "视频通话功能", key: "video_call", description: "一对一视频通话功能", enabled: false, rollout: 0, category: "experiment", updatedAt: new Date().toISOString() },
    { id: "4", name: "暗黑模式", key: "dark_mode", description: "全局暗黑模式UI", enabled: true, rollout: 100, category: "ui", updatedAt: new Date().toISOString() },
    { id: "5", name: "WebSocket 实时通知", key: "ws_realtime", description: "基于WebSocket的实时消息推送", enabled: true, rollout: 100, category: "infra", updatedAt: new Date().toISOString() },
  ]);
  const [loading, setLoading] = useState(false);

  const toggleFlag = async (id: string) => {
    setFlags(prev => prev.map(f => f.id === id ? { ...f, enabled: !f.enabled, updatedAt: new Date().toISOString() } : f));
    toast.success("功能开关已更新");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f]">功能开关</h1>
          <p className="text-[#86868b] text-sm mt-0.5">Feature Flags 管理与灰度发布</p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0071e3] text-white text-sm font-medium hover:bg-[#0077ed] transition-colors">
          <Plus className="w-3.5 h-3.5" /> 新建开关
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "总开关数", value: String(flags.length), icon: ToggleRight, color: "#0071e3" },
          { label: "已启用", value: String(flags.filter(f => f.enabled).length), icon: Zap, color: "#34c759" },
          { label: "灰度中", value: String(flags.filter(f => f.enabled && f.rollout < 100).length), icon: Users, color: "#ff9500" },
          { label: "已禁用", value: String(flags.filter(f => !f.enabled).length), icon: ToggleLeft, color: "#86868b" },
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

      {/* Feature Flags List */}
      <div className="rounded-xl border border-[#e5e5e7] bg-white overflow-hidden">
        <div className="divide-y divide-[#e5e5e7]">
          {flags.map((flag) => {
            const catCfg = CATEGORY_CONFIG[flag.category] || CATEGORY_CONFIG.infra;
            return (
              <div key={flag.id} className="p-4 hover:bg-[#f5f5f7] transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-[#1d1d1f]">{flag.name}</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ backgroundColor: `${catCfg.color}10`, color: catCfg.color }}>
                        {catCfg.label}
                      </span>
                      <code className="text-[10px] px-1.5 py-0.5 rounded bg-[#f5f5f7] text-[#86868b] font-mono">{flag.key}</code>
                    </div>
                    <p className="text-xs text-[#6e6e73]">{flag.description}</p>
                    {flag.enabled && flag.rollout < 100 && (
                      <div className="mt-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-[#e5e5e7]">
                            <div className="h-1.5 rounded-full bg-[#ff9500] transition-all" style={{ width: `${flag.rollout}%` }} />
                          </div>
                          <span className="text-[10px] text-[#ff9500] font-medium">{flag.rollout}%</span>
                        </div>
                      </div>
                    )}
                    <p className="text-[10px] text-[#86868b] mt-1.5">
                      更新于 {new Date(flag.updatedAt).toLocaleString("zh-CN")}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleFlag(flag.id)}
                    className={`ml-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      flag.enabled
                        ? "bg-[#34c75910] text-[#34c759] hover:bg-[#34c75920]"
                        : "bg-[#f5f5f7] text-[#86868b] hover:bg-[#e5e5e7]"
                    }`}
                  >
                    {flag.enabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                    {flag.enabled ? "已启用" : "已禁用"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
