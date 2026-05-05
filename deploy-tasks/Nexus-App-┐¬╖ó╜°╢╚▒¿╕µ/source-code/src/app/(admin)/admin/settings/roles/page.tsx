"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, Plus, Shield, Users, Trash2, Edit, AlertCircle, Check, X } from "lucide-react";

interface Role {
  id?: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  userCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

const SYSTEM_ROLES = [
  { name: "SUPER_ADMIN", description: "超级管理员，拥有所有权限，可管理所有系统资源", color: "bg-red-500/10 text-red-500 border-red-500/20" },
  { name: "ADMIN", description: "管理员，拥有大部分运营权限，可管理用户和内容", color: "bg-orange-500/10 text-orange-500 border-orange-500/20" },
  { name: "MODERATOR", description: "版主，负责内容审核和用户行为管理", color: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  { name: "ANALYST", description: "分析师，拥有数据分析查看权限", color: "bg-green-500/10 text-green-500 border-green-500/20" },
];

const availablePermissions = [
  "user.view", "user.view_detail", "user.edit", "user.delete",
  "match.view", "match.manual", "match.edit", "match.cancel",
  "content.report.view", "content.rule",
  "system.config.view", "system.config.edit",
  "analytics.view",
  "rbac.permission.view", "rbac.role.view", "rbac.role.edit", "rbac.role.delete", "rbac.user.assign", "rbac.user.revoke",
  "marketing.view", "marketing.edit", "marketing.delete",
  "audit.view",
];

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch("/api/admin/rbac/roles", {
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
        setRoles(json.data);
      } else {
        setError(json.error?.message || "加载角色列表失败");
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
    fetchRoles();
  }, [fetchRoles]);

  const handleDelete = async (roleName: string) => {
    if (!confirm(`确定要删除自定义角色 "${roleName}" 吗？此操作不可撤销。`)) return;

    setActionLoading(roleName);
    try {
      const res = await fetch(`/api/admin/rbac/roles?name=${roleName}`, {
        method: "DELETE",
        credentials: "include",
      });

      const json = await res.json();
      if (json.success) {
        setRoles((prev) => prev.filter((r) => r.name !== roleName));
      }
    } catch {
      setError("删除失败");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-foreground-muted">加载角色配置...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">角色管理</h1>
          <p className="text-foreground-muted">管理系统角色和自定义角色权限</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchRoles} className="btn-secondary">
            <RefreshCw className="w-4 h-4 mr-2" />刷新
          </button>
          <button onClick={() => setShowCreateModal(true)} className="btn-primary">
            <Plus className="w-4 h-4 mr-2" />新建角色
          </button>
        </div>
      </div>

      {error && (
        <div className="glass-card p-4 border border-red-500/20 bg-red-500/10">
          <div className="flex items-center gap-2 text-red-500">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* 系统角色 */}
      <div className="glass-card">
        <div className="p-4 border-b border-card-border">
          <h2 className="text-lg font-semibold text-foreground">系统角色</h2>
          <p className="text-sm text-foreground-muted">系统内置角色，无法删除或修改</p>
        </div>
        <div className="divide-y divide-card-border">
          {SYSTEM_ROLES.map((role) => (
            <div key={role.name} className="p-4 flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <Shield className={`w-5 h-5 ${role.color.split(" ")[1]}`} />
                  <h3 className="font-semibold text-foreground">{role.name}</h3>
                  <span className={`px-2 py-0.5 text-xs rounded border ${role.color}`}>
                    系统内置
                  </span>
                </div>
                <p className="text-sm text-foreground-muted mt-1">{role.description}</p>
              </div>
              <div className="flex items-center gap-2 text-foreground-muted">
                <Users className="w-4 h-4" />
                <span>-</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 自定义角色 */}
      <div className="glass-card">
        <div className="p-4 border-b border-card-border">
          <h2 className="text-lg font-semibold text-foreground">自定义角色</h2>
          <p className="text-sm text-foreground-muted">管理员创建的自定义角色，可自由配置权限</p>
        </div>
        {roles.length > 0 ? (
          <div className="divide-y divide-card-border">
            {roles.map((role) => (
              <div key={role.name} className="p-4 flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold text-foreground">{role.name}</h3>
                    {role.isSystem ? (
                      <span className="px-2 py-0.5 text-xs rounded border bg-gray-500/10 text-gray-500 border-gray-500/20">
                        系统
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs rounded border bg-primary/10 text-primary border-primary/20">
                        自定义
                      </span>
                    )}
                  </div>
                  {role.description && (
                    <p className="text-sm text-foreground-muted mt-1">{role.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {role.permissions.slice(0, 8).map((perm) => (
                      <span
                        key={perm}
                        className="px-2 py-0.5 text-xs rounded bg-primary/10 text-primary"
                      >
                        {perm}
                      </span>
                    ))}
                    {role.permissions.length > 8 && (
                      <span className="px-2 py-0.5 text-xs rounded bg-background text-foreground-muted">
                        +{role.permissions.length - 8} 更多
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {role.userCount !== undefined && (
                    <div className="flex items-center gap-1 text-foreground-muted mr-4">
                      <Users className="w-4 h-4" />
                      <span>{role.userCount}</span>
                    </div>
                  )}
                  {!role.isSystem && (
                    <>
                      <button
                        onClick={() => setEditingRole(role)}
                        className="p-2 hover:bg-primary/10 rounded-lg text-primary"
                        title="编辑"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(role.name)}
                        disabled={actionLoading === role.name}
                        className="p-2 hover:bg-red-500/10 rounded-lg text-red-500"
                        title="删除"
                      >
                        {actionLoading === role.name ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <Shield className="w-12 h-12 text-foreground-muted mx-auto mb-4" />
            <p className="text-foreground-muted mb-4">暂无自定义角色</p>
            <button onClick={() => setShowCreateModal(true)} className="btn-primary">
              <Plus className="w-4 h-4 mr-2" />创建第一个角色
            </button>
          </div>
        )}
      </div>

      {/* 创建/编辑模态框 */}
      {(showCreateModal || editingRole) && (
        <RoleModal
          role={editingRole}
          onClose={() => {
            setShowCreateModal(false);
            setEditingRole(null);
          }}
          onSave={() => {
            setShowCreateModal(false);
            setEditingRole(null);
            fetchRoles();
          }}
        />
      )}
    </div>
  );
}

function RoleModal({
  role,
  onClose,
  onSave,
}: {
  role: Role | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [form, setForm] = useState({
    name: role?.name || "",
    description: role?.description || "",
    permissions: role?.permissions || [],
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const res = await fetch("/api/admin/rbac/roles", {
        method: role ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
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

  const togglePermission = (perm: string) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter((p) => p !== perm)
        : [...prev.permissions, perm],
    }));
  };

  const groupedPermissions: Record<string, string[]> = {
    "用户管理": ["user.view", "user.view_detail", "user.edit", "user.delete"],
    "匹配管理": ["match.view", "match.manual", "match.edit", "match.cancel"],
    "内容管理": ["content.report.view", "content.rule"],
    "系统配置": ["system.config.view", "system.config.edit"],
    "数据分析": ["analytics.view"],
    "权限管理": ["rbac.permission.view", "rbac.role.view", "rbac.role.edit", "rbac.role.delete", "rbac.user.assign", "rbac.user.revoke"],
    "营销活动": ["marketing.view", "marketing.edit", "marketing.delete"],
    "审计日志": ["audit.view"],
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="glass-card w-full max-w-2xl max-h-[90vh] overflow-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-foreground mb-4">
            {role ? "编辑角色" : "创建角色"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-foreground mb-1">角色名称 *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase().replace(/\s/g, "_") })}
                className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="例如: CONTENT_MODERATOR"
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
                placeholder="角色的简要描述"
              />
            </div>

            <div>
              <label className="block text-sm text-foreground mb-2">权限配置</label>
              <div className="space-y-4 max-h-96 overflow-auto pr-2">
                {Object.entries(groupedPermissions).map(([group, perms]) => (
                  <div key={group}>
                    <h4 className="text-sm font-medium text-foreground mb-2">{group}</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {perms.map((perm) => {
                        const hasPerm = form.permissions.includes(perm);
                        return (
                          <button
                            key={perm}
                            type="button"
                            onClick={() => togglePermission(perm)}
                            className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-colors ${
                              hasPerm
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-card-border bg-background text-foreground-muted hover:border-primary/50"
                            }`}
                          >
                            {hasPerm ? <Check className="w-4 h-4" /> : <div className="w-4 h-4" />}
                            <span className="text-xs font-mono">{perm}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-card-border">
              <span className="text-sm text-foreground-muted">
                已选择 {form.permissions.length} 个权限
              </span>
              <div className="flex gap-3">
                <button type="button" onClick={onClose} className="btn-secondary">
                  取消
                </button>
                <button type="submit" disabled={saving || !form.name || !form.permissions.length} className="btn-primary">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  保存
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
