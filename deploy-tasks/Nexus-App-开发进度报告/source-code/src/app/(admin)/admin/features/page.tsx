"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, CheckCircle, XCircle, AlertCircle, Search, ToggleLeft, ToggleRight, Clock, Shield } from "lucide-react";

interface Feature {
  id: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  category: string;
  lastModified: string;
  modifiedBy?: string;
}

interface CategoryGroup {
  id: string;
  name: string;
  icon: string;
  features: Feature[];
  enabledCount: number;
  totalCount: number;
}

interface Stats {
  total: number;
  enabled: number;
  disabled: number;
}

export default function FeaturesPage() {
  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, enabled: 0, disabled: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [showOnlyDisabled, setShowOnlyDisabled] = useState(false);

  const fetchFeatures = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch("/api/admin/features", {
        signal: controller.signal,
        credentials: "include",
      });
      clearTimeout(timeoutId);

      if (res.status === 401 || res.status === 403) {
        setError("访问被拒绝，请使用管理员账号登录");
        return;
      }

      const json = await res.json();
      if (json.success && json.data) {
        setCategories(json.data.categories || []);
        setStats(json.data.stats || { total: 0, enabled: 0, disabled: 0 });
      } else {
        setError(json.error?.message || "加载功能列表失败");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("请求超时，请稍后重试");
      } else {
        setError("网络错误，请检查网络连接");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  const handleToggle = async (feature: Feature) => {
    setTogglingId(feature.id);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          featureId: feature.id,
          enabled: !feature.enabled,
        }),
      });

      const json = await res.json();
      if (json.success) {
        // 更新本地状态
        setCategories((prev) =>
          prev.map((cat) => ({
            ...cat,
            features: cat.features.map((f) =>
              f.id === feature.id ? { ...f, enabled: !f.enabled } : f
            ),
            enabledCount: cat.features.reduce(
              (acc, f) => acc + (f.id === feature.id ? (!f.enabled ? 1 : 0) : (f.enabled ? 1 : 0)),
              0
            ),
          }))
        );
        setStats((prev) => ({
          ...prev,
          enabled: prev.enabled + (feature.enabled ? -1 : 1),
          disabled: prev.disabled + (feature.enabled ? 1 : -1),
        }));
      } else {
        setError(json.error?.message || "更新失败");
      }
    } catch {
      setError("网络错误，更新失败");
    } finally {
      setTogglingId(null);
    }
  };

  // 过滤功能
  const filteredCategories = categories
    .map((cat) => {
      let features = cat.features;
      if (filterCategory !== "all" && cat.id !== filterCategory) {
        return { ...cat, features: [] };
      }
      if (searchQuery) {
        features = features.filter(
          (f) =>
            f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            f.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
            f.description.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }
      if (showOnlyDisabled) {
        features = features.filter((f) => !f.enabled);
      }
      return { ...cat, features };
    })
    .filter((cat) => cat.features.length > 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-foreground-muted">加载功能配置中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-foreground mb-4">{error}</p>
          <button onClick={fetchFeatures} className="btn-primary">
            <RefreshCw className="w-4 h-4 mr-2" />重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">功能管理</h1>
          <p className="text-foreground-muted">管理系统功能开关和配置</p>
        </div>
        <button onClick={fetchFeatures} className="btn-secondary">
          <RefreshCw className="w-4 h-4 mr-2" />刷新
        </button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground-muted text-sm">总功能数</p>
              <p className="text-2xl font-bold text-foreground">{stats.total}</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ToggleLeft className="w-5 h-5 text-primary" />
            </div>
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground-muted text-sm">已启用</p>
              <p className="text-2xl font-bold text-green-500">{stats.enabled}</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-500" />
            </div>
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground-muted text-sm">已禁用</p>
              <p className="text-2xl font-bold text-red-500">{stats.disabled}</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-red-500" />
            </div>
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground-muted text-sm">启用率</p>
              <p className="text-2xl font-bold text-primary">
              {stats.total > 0 ? Math.round((stats.enabled / stats.total) * 100) : 0}%
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
          </div>
        </div>
      </div>

      {/* 搜索和筛选 */}
      <div className="glass-card p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
            <input
              type="text"
              placeholder="搜索功能名称、代码或描述..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-background border border-card-border rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="flex gap-4">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-4 py-2 bg-background border border-card-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="all">全部分类</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.icon} {cat.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyDisabled}
                onChange={(e) => setShowOnlyDisabled(e.target.checked)}
                className="w-4 h-4 rounded border-card-border bg-background text-primary focus:ring-primary/50"
              />
              <span className="text-foreground text-sm">仅显示已禁用</span>
            </label>
          </div>
        </div>
      </div>

      {/* 功能列表 */}
      <div className="space-y-6">
        {filteredCategories.map((category) => (
          <div key={category.id} className="glass-card">
            <div className="p-4 border-b border-card-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{category.icon}</span>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">{category.name}</h2>
                    <p className="text-sm text-foreground-muted">
                      {category.enabledCount}/{category.totalCount} 已启用
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-background rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 transition-all duration-300"
                      style={{
                        width: `${(category.enabledCount / category.totalCount) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="divide-y divide-card-border">
              {category.features.map((feature) => (
                <div
                  key={feature.id}
                  className="p-4 flex items-center justify-between hover:bg-background/50 transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-foreground">{feature.name}</h3>
                      <code className="px-2 py-0.5 bg-background rounded text-xs text-foreground-muted">
                        {feature.code}
                      </code>
                    </div>
                    <p className="text-sm text-foreground-muted mt-1">{feature.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-foreground-muted">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(feature.lastModified).toLocaleString("zh-CN")}
                      </span>
                      {feature.modifiedBy && (
                        <span>修改者: {feature.modifiedBy}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => handleToggle(feature)}
                      disabled={togglingId === feature.id}
                      className={`relative p-2 rounded-lg transition-all ${
                        feature.enabled
                          ? "bg-green-500/10 text-green-500 hover:bg-green-500/20"
                          : "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                      } ${togglingId === feature.id ? "opacity-50 cursor-not-allowed" : ""}`}
                      title={feature.enabled ? "点击禁用" : "点击启用"}
                    >
                      {togglingId === feature.id ? (
                        <Loader2 className="w-6 h-6 animate-spin" />
                      ) : feature.enabled ? (
                        <ToggleRight className="w-8 h-8" />
                      ) : (
                        <ToggleLeft className="w-8 h-8" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {filteredCategories.length === 0 && (
        <div className="glass-card p-12 text-center">
          <AlertCircle className="w-12 h-12 text-foreground-muted mx-auto mb-4" />
          <p className="text-foreground-muted">没有找到匹配的功能</p>
        </div>
      )}
    </div>
  );
}
