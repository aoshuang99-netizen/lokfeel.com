"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, Plus, Users, Shield, Trash2, UserPlus, AlertCircle, Check, Search, Crown } from "lucide-react";

interface AdminUser {
  id: string;
  userId: string;
  username: string;
  email: string;
  roles: string[];
  expiresAt: string | null;
  createdAt: string;
  assignedBy?: string;
}

interface AvailableRole {
  name: string;
  description: string;
}

const AVAILABLE_ROLES: AvailableRole[] = [
  { name: "SUPER_ADMIN", description: "超级管理员，拥有所有权限" },
  { name: "ADMIN", description: "管理员，拥有大部分权限" },
  { name: "MODERATOR", description: "版主，内容审核权限" },
  { name: "ANALYST", description: "分析师，数据查看权限" },
];

export default function AdminsPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch("/api/admin/rbac/users", {
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
        setAdmins(json.data.admins || []);
        if (json.data.currentAdmin) {
          setCurrentAdminId(json.data.currentAdmin.id);
        }
      } else {
        setError(json.error?.message || "加载管理员列表失败");
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
    fetchAdmins();
  }, [fetchAdmins]);

  const handleAssignRole = async (userId: string, role: string) => {
    setActionLoading(`${userId}-${role}`);
    try {
      const res = await fetch("/api/admin/rbac/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId, role }),
      });

      const json = await res.json();
      if (json.success) {
        fetchAdmins();
      }
    } catch {
      setError("分配角色失败");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevokeRole = async (userId: string, role: string) => {
    if (!confirm(`确定要撤销用户 ${userId} 的 ${role} 角色吗？`)) return;

    setActionLoading(`${userId}-${role}-revoke`);
    try {
      const res = await fetch(`/api/admin/rbac/users/${userId}/${role}`, {
        method: "DELETE",
        credentials: "include",
      });

      const json = await res.json();
      if (json.success) {
        fetchAdmins();
      }
    } catch {
      setError("撤销角色失败");
    } finally {
      setActionLoading(null);
    }
  };

  const filteredAdmins = admins.filter((admin) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      admin.username.toLowerCase().includes(query) ||
      admin.email.toLowerCase().includes(query) ||
      admin.roles.some((r) => r.toLowerCase().includes(query))
    );
  });

  const getRoleColor = (role: string) => {
    switch (role) {
      case "SUPER_ADMIN":
        return "bg-red-500/10 text-red-500 border-red-500/20";
      case "ADMIN":
        return "bg-orange-500/10 text-orange-500 border-orange-500/20";
      case "MODERATOR":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "ANALYST":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      default:
        return "bg-foreground-muted/10 text-foreground-muted border-foreground-muted/20";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-foreground-muted">加载管理员列表...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">管理员用户</h1>
          <p className="text-foreground-muted">管理系统管理员账户和权限分配</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAdmins} className="btn-secondary">
            <RefreshCw className="w-4 h-4 mr-2" />刷新
          </button>
          <button onClick={() => setShowAddModal(true)} className="btn-primary">
            <UserPlus className="w-4 h-4 mr-2" />添加管理员
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">管理员总数</p>
          <p className="text-2xl font-bold text-foreground">{admins.length}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">超级管理员</p>
          <p className="text-2xl font-bold text-red-500">
            {admins.filter((a) => a.roles.includes("SUPER_ADMIN")).length}
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">管理员</p>
          <p className="text-2xl font-bold text-orange-500">
            {admins.filter((a) => a.roles.includes("ADMIN")).length}
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">版主</p>
          <p className="text-2xl font-bold text-blue-500">
            {admins.filter((a) => a.roles.includes("MODERATOR")).length}
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">分析师</p>
          <p className="text-2xl font-bold text-green-500">
            {admins.filter((a) => a.roles.includes("ANALYST")).length}
          </p>
        </div>
      </div>

      {/* 搜索 */}
      <div className="glass-card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <input
            type="text"
            placeholder="搜索用户名、邮箱或角色..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-background border border-card-border rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="glass-card p-4 border border-red-500/20 bg-red-500/10">
          <div className="flex items-center gap-2 text-red-500">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* 管理员列表 */}
      <div className="glass-card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-background/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">用户</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">角色</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">有效期</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">分配时间</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-foreground-muted uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {filteredAdmins.map((admin) => {
                const isCurrentAdmin = admin.id === currentAdminId;
                return (
                  <tr key={admin.id} className={`hover:bg-background/30 ${isCurrentAdmin ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Users className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{admin.username}</span>
                            {isCurrentAdmin && (
                              <span className="px-2 py-0.5 text-xs rounded bg-primary/10 text-primary flex items-center gap-1">
                                <Crown className="w-3 h-3" /> 当前
                              </span>
                            )}
                          </div>
                          <span className="text-sm text-foreground-muted">{admin.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {admin.roles.map((role) => (
                          <span
                            key={role}
                            className={`px-2 py-0.5 text-xs rounded border ${getRoleColor(role)}`}
                          >
                            {role}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted text-sm">
                      {admin.expiresAt ? (
                        new Date(admin.expiresAt) < new Date() ? (
                          <span className="text-red-500">已过期</span>
                        ) : (
                          new Date(admin.expiresAt).toLocaleDateString("zh-CN")
                        )
                      ) : (
                        <span className="text-green-500">永久</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground-muted text-sm">
                      {new Date(admin.createdAt).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {/* 添加角色按钮 */}
                        <div className="relative group">
                          <button
                            className="p-2 hover:bg-primary/10 rounded-lg text-primary"
                            title="分配角色"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                          <div className="absolute right-0 top-full mt-1 w-48 bg-background border border-card-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                            {AVAILABLE_ROLES.filter((r) => !admin.roles.includes(r.name)).map((role) => (
                              <button
                                key={role.name}
                                onClick={() => handleAssignRole(admin.userId, role.name)}
                                disabled={actionLoading === `${admin.userId}-${role.name}`}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-background/50 flex items-center justify-between"
                              >
                                <span className={`${getRoleColor(role.name)} px-2 py-0.5 text-xs rounded`}>
                                  {role.name}
                                </span>
                                {actionLoading === `${admin.userId}-${role.name}` ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Check className="w-3 h-3 text-green-500" />
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* 撤销角色按钮 */}
                        {admin.roles.map((role) => (
                          <button
                            key={role}
                            onClick={() => handleRevokeRole(admin.userId, role)}
                            disabled={isCurrentAdmin && role === "SUPER_ADMIN" || actionLoading === `${admin.userId}-${role}-revoke`}
                            className={`p-2 hover:bg-red-500/10 rounded-lg ${
                              isCurrentAdmin && role === "SUPER_ADMIN"
                                ? "text-foreground-muted cursor-not-allowed"
                                : "text-red-500"
                            }`}
                            title={isCurrentAdmin && role === "SUPER_ADMIN" ? "无法撤销自己的超级管理员角色" : `撤销 ${role}`}
                          >
                            {actionLoading === `${admin.userId}-${role}-revoke` ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredAdmins.length === 0 && !loading && (
          <div className="p-8 text-center">
            <Users className="w-12 h-12 text-foreground-muted mx-auto mb-4" />
            <p className="text-foreground-muted mb-4">
              {searchQuery ? "没有找到匹配的管理员" : "暂无管理员"}
            </p>
            <button onClick={() => setShowAddModal(true)} className="btn-primary">
              <UserPlus className="w-4 h-4 mr-2" />添加管理员
            </button>
          </div>
        )}
      </div>

      {/* 添加管理员模态框 */}
      {showAddModal && (
        <AddAdminModal
          onClose={() => setShowAddModal(false)}
          onAdd={(userId, role) => {
            setShowAddModal(false);
            handleAssignRole(userId, role);
          }}
        />
      )}
    </div>
  );
}

function AddAdminModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (userId: string, role: string) => void;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("ADMIN");
  const [searching, setSearching] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (userId && role) {
      onAdd(userId, role);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="glass-card w-full max-w-md">
        <div className="p-6">
          <h2 className="text-xl font-bold text-foreground mb-4">添加管理员</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-foreground mb-1">用户ID *</label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="输入用户ID"
                required
              />
              <p className="text-xs text-foreground-muted mt-1">
                在用户管理页面查看用户的ID
              </p>
            </div>

            <div>
              <label className="block text-sm text-foreground mb-1">分配角色 *</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {AVAILABLE_ROLES.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} - {r.description}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button type="button" onClick={onClose} className="btn-secondary">
                取消
              </button>
              <button type="submit" className="btn-primary">
                <UserPlus className="w-4 h-4 mr-2" />添加
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
