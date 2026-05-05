"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, Plus, Search, Gift, Tag, Percent, Users, Calendar, Trash2, Edit, Pause, Play, AlertCircle, Copy } from "lucide-react";

interface Campaign {
  id: string;
  code: string;
  name: string;
  description: string;
  type: "promo_code" | "discount" | "bundle" | "referral" | "seasonal";
  status: "draft" | "active" | "paused" | "expired";
  discount?: {
    type: "percentage" | "fixed";
    value: number;
    minPurchase?: number;
  };
  startDate: string;
  endDate: string;
  targetAudience?: string;
  usageLimit?: number;
  usedCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  total: number;
  active: number;
  paused: number;
  expired: number;
  draft: number;
  totalUsage: number;
}

const typeIcons: Record<string, React.ReactNode> = {
  promo_code: <Tag className="w-4 h-4" />,
  discount: <Percent className="w-4 h-4" />,
  bundle: <Gift className="w-4 h-4" />,
  referral: <Users className="w-4 h-4" />,
  seasonal: <Calendar className="w-4 h-4" />,
};

const typeLabels: Record<string, string> = {
  promo_code: "优惠码",
  discount: "折扣",
  bundle: "套餐",
  referral: "推荐",
  seasonal: "季节性",
};

const statusColors: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-500",
  active: "bg-green-500/10 text-green-500",
  paused: "bg-yellow-500/10 text-yellow-500",
  expired: "bg-red-500/10 text-red-500",
};

const statusLabels: Record<string, string> = {
  draft: "草稿",
  active: "进行中",
  paused: "已暂停",
  expired: "已过期",
};

export default function MarketingPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, paused: 0, expired: 0, draft: 0, totalUsage: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(`/api/admin/marketing?${params}`, {
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
        setCampaigns(json.data.campaigns || []);
        setStats(json.data.stats || {});
      } else {
        setError(json.error?.message || "加载营销活动列表失败");
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
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleToggleStatus = async (campaign: Campaign, newStatus: string) => {
    setActionLoading(campaign.id);
    try {
      const res = await fetch("/api/admin/marketing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id: campaign.id,
          status: newStatus,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setCampaigns((prev) =>
          prev.map((c) => (c.id === campaign.id ? { ...c, status: newStatus as Campaign["status"] } : c))
        );
        fetchCampaigns();
      }
    } catch {
      setError("更新状态失败");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (campaign: Campaign) => {
    if (!confirm(`确定要删除活动 "${campaign.name}" 吗？此操作不可撤销。`)) return;

    setActionLoading(campaign.id);
    try {
      const res = await fetch(`/api/admin/marketing?id=${campaign.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      const json = await res.json();
      if (json.success) {
        setCampaigns((prev) => prev.filter((c) => c.id !== campaign.id));
        fetchCampaigns();
      }
    } catch {
      setError("删除失败");
    } finally {
      setActionLoading(null);
    }
  };

  const filteredCampaigns = campaigns.filter((c) => {
    const matchesSearch =
      !searchQuery ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-foreground-muted">加载营销活动...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">营销活动</h1>
          <p className="text-foreground-muted">管理推广活动、优惠码和促销策略</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchCampaigns} className="btn-secondary">
            <RefreshCw className="w-4 h-4 mr-2" />刷新
          </button>
          <button onClick={() => setShowCreateModal(true)} className="btn-primary">
            <Plus className="w-4 h-4 mr-2" />新建活动
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">总活动</p>
          <p className="text-2xl font-bold text-foreground">{stats.total}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">进行中</p>
          <p className="text-2xl font-bold text-green-500">{stats.active}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">已暂停</p>
          <p className="text-2xl font-bold text-yellow-500">{stats.paused}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">已过期</p>
          <p className="text-2xl font-bold text-red-500">{stats.expired}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">草稿</p>
          <p className="text-2xl font-bold text-gray-500">{stats.draft}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">总使用次数</p>
          <p className="text-2xl font-bold text-primary">{stats.totalUsage.toLocaleString()}</p>
        </div>
      </div>

      {/* 搜索和筛选 */}
      <div className="glass-card p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
            <input
              type="text"
              placeholder="搜索活动名称、代码或描述..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-background border border-card-border rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="flex gap-4">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 bg-background border border-card-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="all">全部状态</option>
              <option value="active">进行中</option>
              <option value="paused">已暂停</option>
              <option value="expired">已过期</option>
              <option value="draft">草稿</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-4 py-2 bg-background border border-card-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="all">全部类型</option>
              <option value="promo_code">优惠码</option>
              <option value="discount">折扣</option>
              <option value="bundle">套餐</option>
              <option value="referral">推荐</option>
              <option value="seasonal">季节性</option>
            </select>
          </div>
        </div>
      </div>

      {/* 活动列表 */}
      {error && (
        <div className="glass-card p-4 border border-red-500/20 bg-red-500/10">
          <div className="flex items-center gap-2 text-red-500">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {filteredCampaigns.map((campaign) => (
          <div key={campaign.id} className="glass-card overflow-hidden">
            <div className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xl">{typeIcons[campaign.type]}</span>
                    <h3 className="text-lg font-semibold text-foreground">{campaign.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[campaign.status]}`}>
                      {statusLabels[campaign.status]}
                    </span>
                    <span className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs font-medium">
                      {typeLabels[campaign.type]}
                    </span>
                  </div>
                  <p className="text-foreground-muted text-sm mb-3">{campaign.description}</p>

                  <div className="flex flex-wrap gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <code className="px-2 py-1 bg-background rounded font-mono text-foreground">
                        {campaign.code}
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(campaign.code)}
                        className="p-1 hover:bg-background rounded"
                        title="复制代码"
                      >
                        <Copy className="w-4 h-4 text-foreground-muted" />
                      </button>
                    </div>

                    {campaign.discount && (
                      <span className="text-foreground-muted">
                        优惠: {campaign.discount.type === "percentage" ? `${campaign.discount.value}%` : `$${campaign.discount.value}`}
                      </span>
                    )}

                    <span className="text-foreground-muted">
                      有效期: {new Date(campaign.startDate).toLocaleDateString("zh-CN")} - {new Date(campaign.endDate).toLocaleDateString("zh-CN")}
                    </span>

                    <span className="text-foreground-muted">
                      已使用: {campaign.usedCount.toLocaleString()}
                      {campaign.usageLimit && ` / ${campaign.usageLimit.toLocaleString()}`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {campaign.status === "active" && (
                    <button
                      onClick={() => handleToggleStatus(campaign, "paused")}
                      disabled={actionLoading === campaign.id}
                      className="p-2 hover:bg-yellow-500/10 rounded-lg text-yellow-500"
                      title="暂停"
                    >
                      {actionLoading === campaign.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                    </button>
                  )}
                  {campaign.status === "paused" && (
                    <button
                      onClick={() => handleToggleStatus(campaign, "active")}
                      disabled={actionLoading === campaign.id}
                      className="p-2 hover:bg-green-500/10 rounded-lg text-green-500"
                      title="启用"
                    >
                      {actionLoading === campaign.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={() => setEditingCampaign(campaign)}
                    className="p-2 hover:bg-primary/10 rounded-lg text-primary"
                    title="编辑"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(campaign)}
                    disabled={actionLoading === campaign.id}
                    className="p-2 hover:bg-red-500/10 rounded-lg text-red-500"
                    title="删除"
                  >
                    {actionLoading === campaign.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* 使用进度条 */}
              {campaign.usageLimit && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-foreground-muted mb-1">
                    <span>使用率</span>
                    <span>{Math.round((campaign.usedCount / campaign.usageLimit) * 100)}%</span>
                  </div>
                  <div className="w-full h-2 bg-background rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        campaign.usedCount / campaign.usageLimit > 0.9
                          ? "bg-red-500"
                          : campaign.usedCount / campaign.usageLimit > 0.7
                          ? "bg-yellow-500"
                          : "bg-green-500"
                      }`}
                      style={{ width: `${Math.min((campaign.usedCount / campaign.usageLimit) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {filteredCampaigns.length === 0 && !loading && (
        <div className="glass-card p-12 text-center">
          <Gift className="w-12 h-12 text-foreground-muted mx-auto mb-4" />
          <p className="text-foreground-muted">没有找到营销活动</p>
          <button onClick={() => setShowCreateModal(true)} className="btn-primary mt-4">
            <Plus className="w-4 h-4 mr-2" />创建第一个活动
          </button>
        </div>
      )}

      {/* 创建/编辑模态框 */}
      {(showCreateModal || editingCampaign) && (
        <CampaignModal
          campaign={editingCampaign}
          onClose={() => {
            setShowCreateModal(false);
            setEditingCampaign(null);
          }}
          onSave={() => {
            setShowCreateModal(false);
            setEditingCampaign(null);
            fetchCampaigns();
          }}
        />
      )}
    </div>
  );
}

function CampaignModal({
  campaign,
  onClose,
  onSave,
}: {
  campaign: Campaign | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [form, setForm] = useState({
    code: campaign?.code || "",
    name: campaign?.name || "",
    description: campaign?.description || "",
    type: campaign?.type || "discount",
    status: campaign?.status || "draft",
    discountType: campaign?.discount?.type || "percentage",
    discountValue: campaign?.discount?.value || 0,
    startDate: campaign?.startDate || new Date().toISOString().split("T")[0],
    endDate: campaign?.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    usageLimit: campaign?.usageLimit || "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const body = {
        code: form.code,
        name: form.name,
        description: form.description,
        type: form.type,
        status: form.status,
        discount: form.type === "referral" || form.type === "bundle" ? undefined : {
          type: form.discountType,
          value: form.discountValue,
        },
        startDate: form.startDate,
        endDate: form.endDate,
        usageLimit: form.usageLimit ? parseInt(form.usageLimit as string) : undefined,
      };

      const res = await fetch("/api/admin/marketing", {
        method: campaign ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(campaign ? { id: campaign.id, ...body } : body),
      });

      const json = await res.json();
      if (json.success) {
        onSave();
      }
    } catch {
      console.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="glass-card w-full max-w-lg max-h-[90vh] overflow-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-foreground mb-4">
            {campaign ? "编辑营销活动" : "创建营销活动"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-foreground mb-1">活动名称 *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-foreground mb-1">优惠码 *</label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-foreground mb-1">描述</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-foreground mb-1">类型</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as Campaign["type"] })}
                  className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="discount">折扣</option>
                  <option value="promo_code">优惠码</option>
                  <option value="bundle">套餐</option>
                  <option value="referral">推荐</option>
                  <option value="seasonal">季节性</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-foreground mb-1">状态</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as Campaign["status"] })}
                  className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="draft">草稿</option>
                  <option value="active">进行中</option>
                  <option value="paused">暂停</option>
                </select>
              </div>
            </div>
            {(form.type === "discount" || form.type === "promo_code" || form.type === "seasonal") && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-foreground mb-1">优惠类型</label>
                  <select
                    value={form.discountType}
                    onChange={(e) => setForm({ ...form, discountType: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="percentage">百分比</option>
                    <option value="fixed">固定金额</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-foreground mb-1">
                    {form.discountType === "percentage" ? "折扣比例(%)" : "金额($)"}
                  </label>
                  <input
                    type="number"
                    value={form.discountValue}
                    onChange={(e) => setForm({ ...form, discountValue: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    min="0"
                    max={form.discountType === "percentage" ? 100 : undefined}
                  />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-foreground mb-1">开始日期</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm text-foreground mb-1">结束日期</label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-foreground mb-1">使用次数限制</label>
              <input
                type="number"
                value={form.usageLimit}
                onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
                placeholder="留空表示无限制"
                className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                min="0"
              />
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <button type="button" onClick={onClose} className="btn-secondary">
                取消
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                保存
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
