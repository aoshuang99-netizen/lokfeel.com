"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { Search, Ban, CheckCircle, Eye, ShieldAlert, RefreshCw, ChevronLeft, ChevronRight, Clock, Loader2, Filter, Download, UserX, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  role: string;
  image: string | null;
  createdAt: string;
  profile: {
    id: string;
    displayName: string | null;
    profileStatus: string;
    isApproved: boolean;
    avatar: string | null;
  } | null;
  _count: {
    sentMatches: number;
    receivedMatches: number;
    messages: number;
  };
}

interface PaginationData {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [showBanDialog, setShowBanDialog] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  
  // Batch Selection
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const pageSize = 20;

  // Clear selection when page changes
  useEffect(() => {
    setSelectedKeys(new Set());
  }, [currentPage, searchQuery, roleFilter, statusFilter]);

  const fetchUsers = useCallback(async (page: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (searchQuery) params.set("search", searchQuery);
      if (roleFilter) params.set("role", roleFilter);
      if (statusFilter) params.set("status", statusFilter);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(`/api/admin/users?${params}`, { signal: controller.signal, credentials: "include" });
      clearTimeout(timeoutId);

      if (res.status === 401 || res.status === 403) {
        setError("Access denied. Please login with admin account.");
        return;
      }

      const json = await res.json();
      if (json.success && json.data) {
        setUsers(json.data);
        setPagination(json.pagination);
      } else {
        setError(json.error?.message || "Failed to load user list");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Request timed out. Please try again.");
      } else {
        setError("Network error. Please check your connection.");
      }
    } finally {
      setLoading(false);
    }
  }, [searchQuery, roleFilter, statusFilter, pageSize]);

  useEffect(() => {
    fetchUsers(currentPage);
  }, [fetchUsers, currentPage]);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleRoleFilter = (value: string) => {
    setRoleFilter(value);
    setCurrentPage(1);
  };

  const handleStatusFilter = (value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  // Batch selection
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedKeys(new Set(users.map(u => u.id)));
    } else {
      setSelectedKeys(new Set());
    }
  };

  const handleSelect = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedKeys);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedKeys(newSelected);
  };

  const selectedUsers = useMemo(() => {
    return users.filter(u => selectedKeys.has(u.id));
  }, [users, selectedKeys]);

  // Batch operations
  const handleBatchBan = async () => {
    if (!confirm(`确定封禁 ${selectedUsers.length} 个用户？`)) return;
    toast.info(`批量封禁功能开发中`);
  };

  const handleBatchExport = () => {
    toast.info(`导出功能开发中`);
  };

  const handleBanUser = async () => {
    if (!selectedUser) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        credentials: "include", 
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUser.id, status: "BANNED", adminNotes: "Banned by admin" }),
      });
      const json = await res.json();
      if (json.success) {
        setShowBanDialog(false);
        fetchUsers(currentPage);
      } else {
        alert(json.error?.message || "Failed to ban user");
      }
    } catch (err) {
      alert("Network error");
    } finally {
      setActionLoading(false);
    }
  };

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-display tracking-tight">Users</h1>
            <p className="text-foreground-muted text-xs mt-0.5">Manage and monitor all users</p>
          </div>
        </div>
        <div className="rounded-xl border border-card-border bg-card/50 p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-error/10 flex items-center justify-center mx-auto mb-3">
            <ShieldAlert className="w-6 h-6 text-error" />
          </div>
          <h3 className="text-base font-semibold mb-1">Failed to Load Users</h3>
          <p className="text-foreground-muted text-sm mb-4">{error}</p>
          <button onClick={() => fetchUsers(currentPage)} className="btn-primary text-sm px-4 py-2">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display tracking-tight">Users</h1>
          <p className="text-foreground-muted text-xs mt-0.5">
            {pagination ? `${pagination.total.toLocaleString()} total` : "Manage and monitor all users"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              showFilters
                ? "bg-primary/8 border-primary/20 text-primary"
                : "bg-card/60 border-card-border text-foreground-muted hover:text-foreground"
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
          </button>
          <button
            onClick={() => fetchUsers(currentPage)}
            disabled={loading}
            className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card/60 border border-card-border hover:bg-card-hover transition-all text-xs font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Filter Area */}
      {showFilters && (
        <div className="rounded-xl border border-card-border bg-card/30 p-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-subtle" />
            <input
              type="text"
              placeholder="Search name, email..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="input-field pl-9 py-1.5 rounded-lg text-xs"
            />
          </div>
          <select value={roleFilter} onChange={(e) => handleRoleFilter(e.target.value)} className="input-field w-auto py-1.5 rounded-lg text-xs px-2.5">
            <option value="">All Roles</option>
            <option value="USER">User</option>
            <option value="ADMIN">Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
          <select value={statusFilter} onChange={(e) => handleStatusFilter(e.target.value)} className="input-field w-auto py-1.5 rounded-lg text-xs px-2.5">
            <option value="">All Status</option>
            <option value="APPROVED">Approved</option>
            <option value="PENDING_REVIEW">Pending</option>
            <option value="DEACTIVATED">Deactivated</option>
            <option value="BANNED">Banned</option>
          </select>
        </div>
      )}

      {/* Batch Action Bar */}
      {selectedKeys.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border border-primary/20 rounded-xl">
          <span className="text-xs text-foreground-muted font-medium">
            {selectedKeys.size} selected
          </span>
          <div className="w-px h-4 bg-primary/20 mx-1" />
          <Button variant="destructive" size="sm" onClick={handleBatchBan}>
            <UserX className="w-3.5 h-3.5 mr-1" />
            Batch Ban
          </Button>
          <Button variant="secondary" size="sm" onClick={handleBatchExport}>
            <Download className="w-3.5 h-3.5 mr-1" />
            Export
          </Button>
        </div>
      )}

      {/* Data Table */}
      <div className="rounded-xl border border-card-border bg-card/30 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border/60 bg-background-tertiary/30">
                <th className="text-left py-2 px-3 w-10">
                  <Checkbox
                    checked={selectedKeys.size === users.length && users.length > 0}
                    onCheckedChange={(checked) => handleSelectAll(checked)}
                  />
                </th>
                <th className="text-left py-2 px-3 text-[11px] font-bold text-foreground-subtle uppercase tracking-wider">User</th>
                <th className="text-left py-2 px-3 text-[11px] font-bold text-foreground-subtle uppercase tracking-wider">Role</th>
                <th className="text-left py-2 px-3 text-[11px] font-bold text-foreground-subtle uppercase tracking-wider">Status</th>
                <th className="text-right py-2 px-3 text-[11px] font-bold text-foreground-subtle uppercase tracking-wider">Matches</th>
                <th className="text-right py-2 px-3 text-[11px] font-bold text-foreground-subtle uppercase tracking-wider">Joined</th>
                <th className="text-right py-2 px-3 text-[11px] font-bold text-foreground-subtle uppercase tracking-wider w-[100px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && users.length === 0 ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-card-border/30">
                    <td className="py-2 px-3"><Skeleton className="h-6 w-6" /></td>
                    <td className="py-2 px-3"><Skeleton className="h-6 w-48" /></td>
                    <td className="py-2 px-3"><Skeleton className="h-5 w-16" /></td>
                    <td className="py-2 px-3"><Skeleton className="h-5 w-20" /></td>
                    <td className="py-2 px-3 text-right"><Skeleton className="h-5 w-8 ml-auto" /></td>
                    <td className="py-2 px-3 text-right"><Skeleton className="h-5 w-24 ml-auto" /></td>
                    <td className="py-2 px-3 text-right"><Skeleton className="h-5 w-16 ml-auto" /></td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <p className="text-foreground-subtle text-sm">No users found</p>
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const displayName = user.profile?.displayName || user.name || user.email?.split("@")[0] || "Unknown User";
                  const status = user.profile?.profileStatus;
                  const matchCount = (user._count?.sentMatches || 0) + (user._count?.receivedMatches || 0);
                  const isSelected = selectedKeys.has(user.id);

                  return (
                    <tr 
                      key={user.id} 
                      className={`border-b border-card-border/30 hover:bg-background-tertiary/30 transition-colors ${
                        isSelected ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="py-2 px-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => handleSelect(user.id, checked)}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center text-foreground font-semibold text-xs overflow-hidden ring-1 ring-card-border/50 shrink-0">
                            {user.image || user.profile?.avatar ? (
                              <img src={user.image || user.profile?.avatar || undefined} alt="" className="w-full h-full object-cover" />
                            ) : (
                              displayName.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-xs truncate">{displayName}</p>
                            <p className="text-[11px] text-foreground-subtle truncate">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                          user.role === "ADMIN" || user.role === "SUPER_ADMIN"
                            ? "bg-primary/10 text-primary"
                            : "bg-background-tertiary text-foreground-muted"
                        }`}>
                          {user.role === "SUPER_ADMIN" ? "Super" : user.role}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                          status === "APPROVED" ? "bg-emerald-500/10 text-emerald-400" :
                          status === "PENDING_REVIEW" ? "bg-amber-500/10 text-amber-400" :
                          status === "BANNED" || status === "DEACTIVATED" ? "bg-red-500/10 text-red-400" :
                          "bg-background-tertiary text-foreground-muted"
                        }`}>
                          {status === "PENDING_REVIEW" ? "Pending" : (status || "N/A")}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span className="text-xs font-medium tabular-nums">{matchCount}</span>
                      </td>
                      <td className="py-2 px-3 text-right text-[11px] text-foreground-subtle">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <Link href={`/admin/users/${user.id}`} className="p-1.5 rounded-md hover:bg-background-tertiary text-foreground-subtle hover:text-foreground transition-colors" title="View">
                            <Eye className="w-3.5 h-3.5" />
                          </Link>
                          {status !== "BANNED" && status !== "DEACTIVATED" && user.role !== "SUPER_ADMIN" && (
                            <button
                              onClick={() => { setSelectedUser(user); setShowBanDialog(true); }}
                              className="p-1.5 rounded-md hover:bg-red-500/10 text-foreground-subtle hover:text-red-400 transition-colors"
                              title="Ban"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && (
          <div className="px-4 py-2 border-t border-card-border/50 flex items-center justify-between bg-background-tertiary/20">
            <p className="text-[11px] text-foreground-subtle font-medium">
              {((pagination.page - 1) * pagination.pageSize) + 1}-{Math.min(pagination.page * pagination.pageSize, pagination.total)}
              <span className="text-foreground-muted"> / {pagination.total}</span>
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || loading}
                className="p-1.5 rounded-md hover:bg-background-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 py-1 text-[11px] text-foreground-subtle font-mono tabular-nums">
                {pagination.page}/{pagination.totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={currentPage >= pagination.totalPages || loading}
                className="p-1.5 rounded-md hover:bg-background-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={showBanDialog}
        onClose={() => setShowBanDialog(false)}
        onConfirm={handleBanUser}
        title="Ban User"
        description={`Are you sure you want to ban ${selectedUser?.profile?.displayName || selectedUser?.name || selectedUser?.email}? They will lose access to their account.`}
        confirmText={actionLoading ? "Banning..." : "Ban User"}
        variant="warning"
      />
    </div>
  );
}
