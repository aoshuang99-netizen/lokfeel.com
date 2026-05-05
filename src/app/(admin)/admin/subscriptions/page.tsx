"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, Filter, Download, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle } from "lucide-react";

const colors = {
  bg: "#0a0a0f",
  card: "rgba(15, 15, 25, 0.95)",
  border: "rgba(255, 255, 255, 0.08)",
  text: "#e4e4e7",
  textMuted: "rgba(255, 255, 255, 0.45)",
  textSecondary: "rgba(255, 255, 255, 0.65)",
  input: "rgba(255, 255, 255, 0.05)",
  inputBorder: "rgba(255, 255, 255, 0.12)",
  inputFocus: "rgba(59, 130, 246, 0.5)",
  primary: "#3b82f6",
  primaryHover: "#2563eb",
  success: "#22c55e",
  warning: "#f59e0b",
  error: "#ef4444",
};

interface Subscription {
  id: string;
  userId: string;
  userName: string;
  plan: string;
  status: "active" | "cancelled" | "past_due" | "trialing";
  amount: number;
  currency: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  stripeSubscriptionId: string;
  createdAt: string;
}

export default function AdminSubscriptionsPage() {
  const router = useRouter();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  const fetchSubscriptions = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/subscriptions");
      const data = await res.json();
      if (data.success) {
        setSubscriptions(data.subscriptions || []);
      }
    } catch (error) {
      console.error("[Admin Subscriptions] Fetch error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefund = async (subscriptionId: string) => {
    if (!confirm("确定要退款吗？此操作不可撤销。")) return;

    try {
      const res = await fetch(`/api/admin/subscriptions/${subscriptionId}/refund`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        alert("退款成功");
        fetchSubscriptions();
      } else {
        alert(`退款失败: ${data.error}`);
      }
    } catch (error) {
      console.error("[Admin Subscriptions] Refund error:", error);
      alert("退款失败，请重试");
    }
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { color: string; icon: typeof CheckCircle; text: string }> = {
      active: { color: colors.success, icon: CheckCircle, text: "活跃" },
      cancelled: { color: colors.error, icon: XCircle, text: "已取消" },
      past_due: { color: colors.warning, icon: AlertCircle, text: "逾期" },
      trialing: { color: colors.primary, icon: Clock, text: "试用中" },
    };
    const { color, icon: Icon, text } = config[status] || config.active;
    return (
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 8px",
        borderRadius: "6px",
        fontSize: "12px",
        fontWeight: "500",
        background: `${color}15`,
        color: color,
      }}>
        <Icon size={12} />
        {text}
      </span>
    );
  };

  const filteredSubscriptions = subscriptions.filter((sub) => {
    const matchesSearch = search === "" ||
      sub.userName?.toLowerCase().includes(search.toLowerCase()) ||
      sub.userId.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || sub.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, padding: "24px" }}>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <button
          onClick={() => router.push("/admin")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "none",
            border: "none",
            color: colors.textMuted,
            cursor: "pointer",
            fontSize: "14px",
            marginBottom: "16px",
          }}
        >
          <ArrowLeft size={16} />
          返回仪表盘
        </button>
        <h1 style={{
          fontSize: "28px",
          fontWeight: "bold",
          color: colors.text,
          margin: "0 0 8px",
        }}>
          订阅管理
        </h1>
        <p style={{ color: colors.textMuted, margin: 0, fontSize: "14px" }}>
          管理用户订阅，处理退款和取消请求
        </p>
      </div>

      {/* Filters */}
      <div style={{
        display: "flex",
        gap: "12px",
        marginBottom: "24px",
        flexWrap: "wrap",
      }}>
        <div style={{ position: "relative", flex: "1", maxWidth: "400px" }}>
          <Search size={16} style={{
            position: "absolute",
            left: "12px",
            top: "50%",
            transform: "translateY(-50%)",
            color: colors.textMuted,
          }} />
          <input
            type="text"
            placeholder="搜索用户..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px 10px 36px",
              background: colors.input,
              border: `1px solid ${colors.inputBorder}`,
              borderRadius: "8px",
              color: colors.text,
              fontSize: "14px",
              outline: "none",
            }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: "10px 12px",
            background: colors.input,
            border: `1px solid ${colors.inputBorder}`,
            borderRadius: "8px",
            color: colors.text,
            fontSize: "14px",
            outline: "none",
            cursor: "pointer",
          }}
        >
          <option value="all">所有状态</option>
          <option value="active">活跃</option>
          <option value="cancelled">已取消</option>
          <option value="past_due">逾期</option>
          <option value="trialing">试用中</option>
        </select>
        <button
          onClick={fetchSubscriptions}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "10px 16px",
            background: colors.input,
            border: `1px solid ${colors.inputBorder}`,
            borderRadius: "8px",
            color: colors.text,
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          <RefreshCw size={14} />
          刷新
        </button>
      </div>

      {/* Subscriptions Table */}
      <div style={{
        background: colors.card,
        borderRadius: "12px",
        border: `1px solid ${colors.border}`,
        overflow: "hidden",
      }}>
        {loading ? (
          <div style={{ padding: "48px", textAlign: "center", color: colors.textMuted }}>
            加载中...
          </div>
        ) : filteredSubscriptions.length === 0 ? (
          <div style={{ padding: "48px", textAlign: "center", color: colors.textMuted }}>
            暂无订阅数据
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", color: colors.textMuted, fontWeight: "500" }}>
                    用户
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", color: colors.textMuted, fontWeight: "500" }}>
                    方案
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", color: colors.textMuted, fontWeight: "500" }}>
                    状态
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", color: colors.textMuted, fontWeight: "500" }}>
                    金额
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", color: colors.textMuted, fontWeight: "500" }}>
                    周期
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", color: colors.textMuted, fontWeight: "500" }}>
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredSubscriptions.map((sub) => (
                  <tr key={sub.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={{ padding: "12px 16px", color: colors.text, fontSize: "14px" }}>
                      {sub.userName || sub.userId}
                    </td>
                    <td style={{ padding: "12px 16px", color: colors.text, fontSize: "14px" }}>
                      {sub.plan}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {getStatusBadge(sub.status)}
                    </td>
                    <td style={{ padding: "12px 16px", color: colors.text, fontSize: "14px" }}>
                      {sub.amount} {sub.currency.toUpperCase()}
                    </td>
                    <td style={{ padding: "12px 16px", color: colors.textMuted, fontSize: "13px" }}>
                      {new Date(sub.currentPeriodStart).toLocaleDateString()} - {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {sub.status === "active" && (
                        <button
                          onClick={() => handleRefund(sub.id)}
                          style={{
                            padding: "6px 12px",
                            background: `${colors.error}15`,
                            border: `1px solid ${colors.error}30`,
                            borderRadius: "6px",
                            color: colors.error,
                            fontSize: "12px",
                            cursor: "pointer",
                          }}
                        >
                          退款
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
