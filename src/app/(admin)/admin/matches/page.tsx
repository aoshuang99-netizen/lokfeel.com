"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { Search, Filter, Eye, Plus, X, ChevronLeft, ChevronRight, CheckCircle, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";

interface MatchRow {
  id: string;
  user1: { id: string; name: string; avatar: string | null };
  user2: { id: string; name: string; avatar: string | null };
  score: number;
  status: "pending" | "accepted" | "rejected" | "expired";
  createdAt: string;
  messages: number;
}

interface PaginationData {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export default function MatchesManagementPage() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationData>({ page: 1, pageSize: 20, total: 0, totalPages: 0, hasMore: false });
  
  // Batch Selection
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  
  const [selectedMatch, setSelectedMatch] = useState<MatchRow | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const pageSize = 20;

  // Clear selection when page changes
  useEffect(() => {
    setSelectedKeys(new Set());
  }, [currentPage, searchQuery, statusFilter]);

  const fetchMatches = useCallback(async (page: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (searchQuery) params.set("search", searchQuery);
      if (statusFilter) params.set("status", statusFilter);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(`/api/admin/matches?${params}`, { signal: controller.signal, credentials: "include" });
      clearTimeout(timeoutId);

      if (res.status === 401 || res.status === 403) {
        setError("Access denied. Please login with admin account.");
        return;
      }

      const json = await res.json();
      if (json.success && json.data) {
        setMatches(json.data);
        setPagination(json.pagination);
      } else {
        setError(json.error?.message || "Failed to load matches");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Request timeout. Please try again.");
      } else {
        setError("Network error. Please check your connection.");
      }
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, pageSize]);

  useEffect(() => {
    fetchMatches(currentPage);
  }, [fetchMatches, currentPage]);

  // Batch Selection
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedKeys(new Set(matches.map(m => m.id)));
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

  const selectedMatches = useMemo(() => {
    return matches.filter(m => selectedKeys.has(m.id));
  }, [matches, selectedKeys]);

  const handleBatchCancel = async () => {
    if (!confirm(`确定取消 ${selectedMatches.length} 个匹配项？`)) return;
    toast.info(`批量取消功能开发中`);
  };

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-display tracking-tight">Matches</h1>
            <p className="text-[#6e6e73] text-xs mt-0.5">Manage all matches</p>
          </div>
        </div>
        <div className="rounded-xl border border-[#e5e5e7] bg-white p-8 text-center">
          <p className="text-[#6e6e73] mb-4">{error}</p>
          <button onClick={() => fetchMatches(currentPage)} className="btn-primary text-sm px-4 py-2">
            Retry
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
          <h1 className="text-2xl font-bold font-display tracking-tight">Matches</h1>
          <p className="text-[#6e6e73] text-xs mt-0.5">
            {pagination ? `${pagination.total.toLocaleString()} total` : "Manage all matches"}
          </p>
        </div>
        <button className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-lg">
          <Plus className="w-3.5 h-3.5" />
          Create
        </button>
      </div>

      {/* Filter Area */}
      <div className="rounded-xl border border-[#e5e5e7] bg-white p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#86868b]" />
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field pl-9 py-1.5 rounded-lg text-xs"
          />
        </div>
        <select 
          value={statusFilter} 
          onChange={(e) => setStatusFilter(e.target.value)} 
          className="input-field w-auto py-1.5 rounded-lg text-xs px-2.5"
        >
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Batch Action Bar */}
      {selectedKeys.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border border-primary/20 rounded-xl">
          <span className="text-xs text-[#6e6e73] font-medium">
            {selectedKeys.size} selected
          </span>
          <div className="w-px h-4 bg-primary/20 mx-1" />
          <button
            onClick={handleBatchCancel}
            className="flex items-center gap-1 text-xs font-medium text-error hover:bg-error/10 px-2 py-1 rounded-md transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Batch Cancel
          </button>
        </div>
      )}

      {/* Data Table */}
      <div className="rounded-xl border border-[#e5e5e7] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e7]/60 bg-[#f5f5f7]">
                <th className="text-left py-2 px-3 w-10">
                  <Checkbox
                    checked={selectedKeys.size === matches.length && matches.length > 0}
                    onCheckedChange={(checked) => handleSelectAll(checked)}
                  />
                </th>
                <th className="text-left py-2 px-3 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Users</th>
                <th className="text-left py-2 px-3 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Score</th>
                <th className="text-left py-2 px-3 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Status</th>
                <th className="text-left py-2 px-3 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Messages</th>
                <th className="text-right py-2 px-3 text-[11px] font-bold text-[#86868b] uppercase tracking-wider">Created</th>
                <th className="text-right py-2 px-3 text-[11px] font-bold text-[#86868b] uppercase tracking-wider w-[80px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && matches.length === 0 ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-[#e5e5e7]/30">
                    <td className="py-2 px-3"><Skeleton className="h-5 w-5" /></td>
                    <td className="py-2 px-3"><Skeleton className="h-6 w-48" /></td>
                    <td className="py-2 px-3"><Skeleton className="h-5 w-12" /></td>
                    <td className="py-2 px-3"><Skeleton className="h-5 w-16" /></td>
                    <td className="py-2 px-3"><Skeleton className="h-5 w-8" /></td>
                    <td className="py-2 px-3 text-right"><Skeleton className="h-5 w-20 ml-auto" /></td>
                    <td className="py-2 px-3 text-right"><Skeleton className="h-5 w-12 ml-auto" /></td>
                  </tr>
                ))
              ) : matches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <p className="text-[#86868b] text-sm">No matches found</p>
                  </td>
                </tr>
              ) : (
                matches.map((match) => {
                  const isSelected = selectedKeys.has(match.id);
                  
                  return (
                    <tr 
                      key={match.id}
                      className={`border-b border-[#e5e5e7]/30 hover:bg-[#f5f5f7]/30 transition-colors ${
                        isSelected ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="py-2 px-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => handleSelect(match.id, checked)}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-2">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 border-2 border-[#e5e5e7] overflow-hidden flex items-center justify-center text-xs font-semibold">
                              {match.user1.avatar ? (
                                <img src={match.user1.avatar} alt="" className="w-full h-full object-cover" />
                              ) : (
                                match.user1.name.charAt(0).toUpperCase()
                              )}
                            </div>
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 border-2 border-[#e5e5e7] overflow-hidden flex items-center justify-center text-xs font-semibold">
                              {match.user2.avatar ? (
                                <img src={match.user2.avatar} alt="" className="w-full h-full object-cover" />
                              ) : (
                                match.user2.name.charAt(0).toUpperCase()
                              )}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{match.user1.name}</p>
                            <p className="text-[11px] text-[#86868b] truncate">& {match.user2.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs font-bold font-mono ${
                          match.score >= 90 ? "text-emerald-400" :
                          match.score >= 80 ? "text-amber-400" :
                          "text-red-400"
                        }`}>
                          {match.score}%
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                          match.status === "accepted" ? "bg-emerald-500/10 text-emerald-400" :
                          match.status === "pending" ? "bg-amber-500/10 text-amber-400" :
                          match.status === "rejected" ? "bg-red-500/10 text-red-400" :
                          "bg-foreground-muted/10 text-[#6e6e73]"
                        }`}>
                          {match.status}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-xs tabular-nums">{match.messages}</span>
                      </td>
                      <td className="py-2 px-3 text-right text-[11px] text-[#86868b]">
                        {new Date(match.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <Link href={`/admin/matches/${match.id}`} className="p-1.5 rounded-md hover:bg-[#f5f5f7] text-[#86868b] hover:text-[#1d1d1f] transition-colors" title="View">
                            <Eye className="w-3.5 h-3.5" />
                          </Link>
                          {match.status === "pending" && (
                            <button
                              onClick={() => { setSelectedMatch(match); setShowCancelDialog(true); }}
                              className="p-1.5 rounded-md hover:bg-red-500/10 text-[#86868b] hover:text-red-400 transition-colors"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
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
          <div className="px-4 py-2 border-t border-[#e5e5e7]/50 flex items-center justify-between bg-[#fafafa]">
            <p className="text-[11px] text-[#86868b] font-medium">
              {((pagination.page - 1) * pagination.pageSize) + 1}-{Math.min(pagination.page * pagination.pageSize, pagination.total)}
              <span className="text-[#6e6e73]"> / {pagination.total}</span>
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || loading}
                className="p-1.5 rounded-md hover:bg-[#f5f5f7] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 py-1 text-[11px] text-[#86868b] font-mono tabular-nums">
                {pagination.page}/{pagination.totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={currentPage >= pagination.totalPages || loading}
                className="p-1.5 rounded-md hover:bg-[#f5f5f7] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={showCancelDialog}
        onClose={() => setShowCancelDialog(false)}
        onConfirm={() => { setShowCancelDialog(false); }}
        title="Cancel Match"
        description={`Are you sure you want to cancel the match between ${selectedMatch?.user1.name} and ${selectedMatch?.user2.name}?`}
        confirmText="Cancel Match"
        variant="danger"
      />
    </div>
  );
}
