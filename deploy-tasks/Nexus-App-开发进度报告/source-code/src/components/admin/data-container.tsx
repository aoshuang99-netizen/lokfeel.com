"use client";

/**
 * Admin DataContainer — Unified loading/empty/error states wrapper
 *
 * Wraps any data-fetching component with consistent 3-state handling.
 * Uses existing Skeleton/EmptyState/ErrorBoundary components.
 *
 * @example
 * <DataContainer
 *   data={users}
 *   isLoading={loading}
 *   error={error}
 *   emptyTitle="No users yet"
 *   emptyDescription="Import your first batch of users."
 *   emptyAction={{ label: "Import Users", onClick: handleImport }}
 *   loadingComponent={<DataTableSkeleton columns={5} rows={10} />}
 *   onRetry={refetch}
 * >
 *   <UserTable data={users} />
 * </DataContainer>
 */

import { ReactNode } from "react";
import { ErrorBoundary, InlineError } from "@/components/ui/error-boundary";
import { DataTableSkeleton } from "@/components/ui/data-table";
import EmptyState from "@/components/ui/empty-state";
import { RefreshCw } from "lucide-react";

interface DataContainerProps<T> {
  children: ReactNode;
  data: T[] | undefined | null;
  isLoading: boolean;
  error?: string | Error | null;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: React.ComponentType<{ className?: string }>;
  emptyAction?: {
    label: string;
    onClick: () => void;
  };
  emptyFiltered?: boolean;
  loadingComponent?: ReactNode;
  onRetry?: () => void;
  className?: string;
}

export function DataContainer<T>({
  children,
  data,
  isLoading,
  error,
  emptyTitle = "No data available",
  emptyDescription = "There are no items to display yet.",
  emptyIcon,
  emptyAction,
  emptyFiltered = false,
  loadingComponent,
  onRetry,
  className = "",
}: DataContainerProps<T>) {
  // Error state
  if (error) {
    const errorMessage = error instanceof Error ? error.message : error;
    return (
      <div className={className}>
        <InlineError
          error={errorMessage}
          onRetry={onRetry}
        />
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className={className}>
        {loadingComponent || <DataTableSkeleton columns={5} rows={8} />}
      </div>
    );
  }

  // Empty state
  if (!data || data.length === 0) {
    return (
      <div className={className}>
        <EmptyStateWrapper
          title={emptyTitle}
          description={emptyDescription}
          icon={emptyIcon}
          action={emptyAction}
          filtered={emptyFiltered}
          onRetry={onRetry}
        />
      </div>
    );
  }

  // Normal state
  return (
    <ErrorBoundary fallback={<InlineError error="Failed to render data" onRetry={onRetry} />}>
      {children}
    </ErrorBoundary>
  );
}

// ============================================================================
// Empty State Wrapper
// ============================================================================

function EmptyStateWrapper({
  title,
  description,
  icon: Icon,
  action,
  filtered,
  onRetry,
}: {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: { label: string; onClick: () => void };
  filtered?: boolean;
  onRetry?: () => void;
}) {
  if (filtered) {
    // Filtered results empty state
    return (
      <div className="py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4">
          <RefreshCw className="w-8 h-8 text-warning" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          No results match your filters
        </h3>
        <p className="text-foreground-muted mb-6">
          Try adjusting your search criteria.
        </p>
        {onRetry && (
          <button onClick={onRetry} className="btn-secondary">
            Clear Filters
          </button>
        )}
      </div>
    );
  }

  // True empty state
  return (
    <EmptyState
      icon={Icon || (() => null) as any}
      title={title}
      description={description}
      action={
        action ? (
          <button onClick={action.onClick} className="btn-primary">
            {action.label}
          </button>
        ) : undefined
      }
    />
  );
}
