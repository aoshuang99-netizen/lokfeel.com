"use client";

/**
 * Audit Logs Page - /admin/settings/audit
 *
 * Unified admin audit log viewer with filtering, pagination,
 * and detail expansion.
 */

import { useState, useEffect, useCallback } from "react";
import { Search, Filter, ChevronDown, ChevronRight, Shield, User, CreditCard, Settings, MessageSquare, Bot, Palette, HelpCircle, Crown, BarChart3, Lock } from "lucide-react";
import { DataContainer } from "@/components/admin/data-container";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

interface AuditLog {
  id: string;
  actorId: string;
  actor: { id: string; name: string | null; email: string; image: string | null };
  category: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  changes: any;
  details: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface AuditResponse {
  success: boolean;
  data: AuditLog[];
  meta?: { page: number; pageSize: number; total: number; totalPages: number };
}

// ============================================================================
// Category Config
// ============================================================================

const CATEGORY_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
  USER:        { icon: User,         color: "text-blue-500",     label: "User" },
  MATCH:       { icon: MessageSquare, color: "text-purple-500", label: "Match" },
  CHAT:        { icon: MessageSquare, color: "text-green-500",   label: "Chat" },
  PAYMENT:     { icon: CreditCard,   color: "text-yellow-500",  label: "Payment" },
  CONTENT:     { icon: Shield,       color: "text-orange-500", label: "Content" },
  BOT:         { icon: Bot,          color: "text-cyan-500",    label: "Bot" },
  AI_CREATIVE: { icon: Palette,      color: "text-pink-500",   label: "AI Creative" },
  AI_SUPPORT:  { icon: HelpCircle,   color: "text-indigo-500", label: "AI Support" },
  VIP:         { icon: Crown,        color: "text-amber-500",  label: "VIP" },
  ANALYTICS:   { icon: BarChart3,    color: "text-teal-500",   label: "Analytics" },
  SYSTEM:      { icon: Settings,     color: "text-foreground-muted", label: "System" },
  RBAC:        { icon: Lock,         color: "text-red-500",    label: "RBAC" },
};

const CATEGORIES = Object.keys(CATEGORY_CONFIG);

// ============================================================================
// Page Component
// ============================================================================

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch audit logs
  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (selectedCategory) params.set("category", selectedCategory);
      if (searchQuery) params.set("action", searchQuery);

      const res = await fetch(`/api/admin/audit?${params.toString()}`, { credentials: "include" });
      const data: AuditResponse = await res.json();

      if (data.success) {
        setLogs(data.data || []);
        setTotalPages(data.meta?.totalPages || 1);
        setTotal(data.meta?.total || 0);
      } else {
        setError("Failed to fetch audit logs");
      }
    } catch (err) {
      setError("Network error. Please check your connection.");
    } finally {
      setIsLoading(false);
    }
  }, [page, selectedCategory, searchQuery]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [selectedCategory, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Audit Logs</h1>
        <p className="text-foreground-muted mt-1">
          Track all admin actions across the system. Showing {total} total records.
        </p>
      </div>

      {/* Search & Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <input
            type="text"
            placeholder="Search by action type (e.g., ban, delete, grant_role)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-background-tertiary border border-card-border text-foreground placeholder:text-foreground-muted text-sm outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* Filter Toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm transition-colors ${
            showFilters
              ? "border-primary bg-primary/10 text-primary"
              : "border-card-border bg-background-tertiary text-foreground-muted hover:text-foreground"
          }`}
        >
          <Filter className="w-4 h-4" />
          <span>Filters</span>
          {selectedCategory && (
            <span className="px-1.5 py-0.5 rounded bg-primary/20 text-xs">
              1 active
            </span>
          )}
        </button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="glass-card p-4 space-y-3">
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">Category</label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCategory("")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  !selectedCategory
                    ? "bg-primary text-foreground"
                    : "bg-muted text-foreground-muted hover:text-foreground"
                }`}
              >
                All
              </button>
              {CATEGORIES.map((cat) => {
                const config = CATEGORY_CONFIG[cat];
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 ${
                      selectedCategory === cat
                        ? "bg-primary text-foreground"
                        : "bg-muted text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    <config.icon className="w-3.5 h-3.5" />
                    {config.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Logs List */}
      <DataContainer
        data={logs}
        isLoading={isLoading}
        error={error}
        emptyTitle="No audit logs yet"
        emptyDescription="Admin actions will appear here as they are performed."
        onRetry={fetchLogs}
      >
        <div className="glass-card overflow-hidden">
          <div className="divide-y divide-card-border">
            {logs.map((log) => {
              const config = CATEGORY_CONFIG[log.category] || CATEGORY_CONFIG.SYSTEM;
              const CategoryIcon = config.icon;
              const isExpanded = expandedId === log.id;

              return (
                <div key={log.id}>
                  <button
                    className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  >
                    {/* Category Icon */}
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      log.category === "RBAC" ? "bg-red-500/10" : "bg-primary/10"
                    }`}>
                      <CategoryIcon className={`w-4.5 h-4.5 ${config.color}`} />
                    </div>

                    {/* Actor Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {log.actor?.name || log.actor?.email || log.actorId}
                        </span>
                        <span className="text-xs text-foreground-muted px-1.5 py-0.5 rounded bg-muted">
                          {log.category}
                        </span>
                      </div>
                      <div className="text-xs text-foreground-muted truncate mt-0.5">
                        {log.action}
                        {log.targetType && log.targetId && (
                          <> -&gt; {log.targetType} ({log.targetId.slice(0, 8)}...)</>
                        )}
                        {log.details && <> : {log.details}</>}
                      </div>
                    </div>

                    {/* Time */}
                    <div className="text-xs text-foreground-muted whitespace-nowrap flex-shrink-0">
                      {new Date(log.createdAt).toLocaleString()}
                    </div>

                    {/* Expand Arrow */}
                    <ChevronRight
                      className={`w-4 h-4 text-foreground-muted transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </button>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-4 py-3 bg-muted/20 border-t border-card-border">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-foreground-muted">Actor ID:</span>
                          <span className="ml-2 text-foreground font-mono text-xs">{log.actorId}</span>
                        </div>
                        {log.ipAddress && (
                          <div>
                            <span className="text-foreground-muted">IP Address:</span>
                            <span className="ml-2 text-foreground font-mono text-xs">{log.ipAddress}</span>
                          </div>
                        )}
                        {log.userAgent && (
                          <div className="col-span-2">
                            <span className="text-foreground-muted">User Agent:</span>
                            <span className="ml-2 text-foreground text-xs break-all">{log.userAgent}</span>
                          </div>
                        )}
                        {log.changes && (
                          <div className="col-span-2">
                            <span className="text-foreground-muted font-medium">Changes:</span>
                            <pre className="mt-1 p-3 rounded-lg bg-background text-xs text-foreground overflow-auto max-h-40">
                              {JSON.stringify(log.changes, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </DataContainer>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground-muted">
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="btn-secondary disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="btn-secondary disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
