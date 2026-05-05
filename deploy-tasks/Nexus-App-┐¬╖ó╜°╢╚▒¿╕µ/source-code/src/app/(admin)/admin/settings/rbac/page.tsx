"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, Shield, AlertTriangle, Lock, Key, Eye, Users, ChevronRight } from "lucide-react";

interface Permission {
  code: string;
  name: string;
  dangerous: boolean;
  critical: boolean;
  roles: string[];
}

interface Category {
  category: string;
  permissions: Permission[];
}

interface PermissionData {
  categories: Category[];
  total: number;
  dangerousCount: number;
  criticalCount: number;
}

const categoryIcons: Record<string, React.ReactNode> = {
  user: <Users className="w-4 h-4" />,
  match: <Key className="w-4 h-4" />,
  content: <Eye className="w-4 h-4" />,
  system: <Shield className="w-4 h-4" />,
  analytics: <AlertTriangle className="w-4 h-4" />,
  rbac: <Lock className="w-4 h-4" />,
};

const categoryLabels: Record<string, string> = {
  user: "用户管理",
  match: "匹配管理",
  content: "内容管理",
  system: "系统配置",
  analytics: "数据分析",
  rbac: "权限管理",
  marketing: "营销活动",
  safety: "安全审核",
};

export default function RBACPage() {
  const [data, setData] = useState<PermissionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["user", "match", "system"]));

  const fetchPermissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch("/api/admin/rbac/permissions", {
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
        setData(json.data);
      } else {
        setError(json.error?.message || "加载权限列表失败");
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
    fetchPermissions();
  }, [fetchPermissions]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const getCategoryName = (key: string) => {
    return categoryLabels[key] || key.charAt(0).toUpperCase() + key.slice(1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-foreground-muted">加载权限配置...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-foreground mb-4">{error}</p>
          <button onClick={fetchPermissions} className="btn-primary">
            <RefreshCw className="w-4 h-4 mr-2" />重试
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">权限管理</h1>
          <p className="text-foreground-muted">查看系统权限定义和角色分配</p>
        </div>
        <button onClick={fetchPermissions} className="btn-secondary">
          <RefreshCw className="w-4 h-4 mr-2" />刷新
        </button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">权限总数</p>
          <p className="text-2xl font-bold text-foreground">{data.total}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">权限分类</p>
          <p className="text-2xl font-bold text-primary">{data.categories.length}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">危险权限</p>
          <p className="text-2xl font-bold text-yellow-500">{data.dangerousCount}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-foreground-muted text-sm">关键权限</p>
          <p className="text-2xl font-bold text-red-500">{data.criticalCount}</p>
        </div>
      </div>

      {/* 角色说明 */}
      <div className="glass-card p-4">
        <h2 className="text-lg font-semibold text-foreground mb-3">系统角色</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { name: "SUPER_ADMIN", desc: "超级管理员，拥有所有权限", color: "text-red-500" },
            { name: "ADMIN", desc: "管理员，拥有大部分权限", color: "text-orange-500" },
            { name: "MODERATOR", desc: "版主，内容审核和用户管理", color: "text-blue-500" },
            { name: "ANALYST", desc: "分析师，数据查看权限", color: "text-green-500" },
          ].map((role) => (
            <div key={role.name} className="p-3 bg-background rounded-lg">
              <div className={`font-semibold ${role.color}`}>{role.name}</div>
              <p className="text-xs text-foreground-muted mt-1">{role.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 权限列表 */}
      <div className="space-y-4">
        {data.categories.map((cat) => {
          const isExpanded = expandedCategories.has(cat.category);
          const dangerousCount = cat.permissions.filter((p) => p.dangerous).length;
          const criticalCount = cat.permissions.filter((p) => p.critical).length;

          return (
            <div key={cat.category} className="glass-card overflow-hidden">
              <button
                onClick={() => toggleCategory(cat.category)}
                className="w-full p-4 flex items-center justify-between hover:bg-background/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{categoryIcons[cat.category] || <Shield className="w-4 h-4" />}</span>
                  <div className="text-left">
                    <h3 className="font-semibold text-foreground">{getCategoryName(cat.category)}</h3>
                    <p className="text-sm text-foreground-muted">
                      {cat.permissions.length} 个权限
                      {dangerousCount > 0 && (
                        <span className="text-yellow-500 ml-2">⚠️ {dangerousCount} 危险</span>
                      )}
                      {criticalCount > 0 && (
                        <span className="text-red-500 ml-2">🔒 {criticalCount} 关键</span>
                      )}
                    </p>
                  </div>
                </div>
                <ChevronRight
                  className={`w-5 h-5 text-foreground-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
                />
              </button>

              {isExpanded && (
                <div className="border-t border-card-border">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-background/50">
                        <th className="px-4 py-2 text-left text-xs font-medium text-foreground-muted uppercase">权限代码</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-foreground-muted uppercase">权限名称</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-foreground-muted uppercase">关联角色</th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-foreground-muted uppercase">状态</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-card-border">
                      {cat.permissions.map((perm) => (
                        <tr key={perm.code} className="hover:bg-background/30">
                          <td className="px-4 py-3">
                            <code className="text-sm font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
                              {perm.code}
                            </code>
                          </td>
                          <td className="px-4 py-3 text-foreground">{perm.name}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {perm.roles.map((role) => (
                                <span
                                  key={role}
                                  className={`px-2 py-0.5 text-xs rounded ${
                                    role === "SUPER_ADMIN"
                                      ? "bg-red-500/10 text-red-500"
                                      : role === "ADMIN"
                                      ? "bg-orange-500/10 text-orange-500"
                                      : role === "MODERATOR"
                                      ? "bg-blue-500/10 text-blue-500"
                                      : "bg-green-500/10 text-green-500"
                                  }`}
                                >
                                  {role}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              {perm.dangerous && (
                                <span className="px-2 py-0.5 bg-yellow-500/10 text-yellow-500 text-xs rounded">
                                  危险
                                </span>
                              )}
                              {perm.critical && (
                                <span className="px-2 py-0.5 bg-red-500/10 text-red-500 text-xs rounded">
                                  关键
                                </span>
                              )}
                              {!perm.dangerous && !perm.critical && (
                                <span className="px-2 py-0.5 bg-green-500/10 text-green-500 text-xs rounded">
                                  正常
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
