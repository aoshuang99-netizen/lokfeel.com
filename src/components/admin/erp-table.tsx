"use client";

import { useState, useCallback } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

// ============================================================================
// ERP Table Component - 紧凑型数据表格
// ============================================================================

interface ColumnDef<T> {
  key: string;
  title: string;
  width?: number;
  minWidth?: number;
  sortable?: boolean;
  render: (item: T, index: number) => React.ReactNode;
}

interface ERPTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  keyExtractor: (item: T) => string;
  loading?: boolean;
  compact?: boolean;           // ERP紧凑模式
  selectable?: boolean;      // 启用选择
  onSelectionChange?: (selected: T[]) => void;
  onRowClick?: (item: T) => void;
  onRowDoubleClick?: (item: T) => void;
  onSort?: (key: string, direction: "asc" | "desc") => void;
  actions?: {
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    onClick: (selected: T[]) => void;
    variant?: "default" | "destructive" | "secondary" | "outline" | "ghost" | "link" | null | undefined;
  }[];
}

export function ERPTable<T>({
  data,
  columns,
  keyExtractor,
  loading = false,
  compact = true,
  selectable = false,
  onSelectionChange,
  onRowClick,
  onRowDoubleClick,
  onSort,
  actions,
}: ERPTableProps<T>) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allKeys = data.map(item => keyExtractor(item));
      setSelectedKeys(new Set(allKeys));
      if (onSelectionChange) {
        onSelectionChange(data);
      }
    } else {
      setSelectedKeys(new Set());
      if (onSelectionChange) {
        onSelectionChange([]);
      }
    }
  };

  const handleSelect = (key: string, checked: boolean) => {
    const newSelected = new Set(selectedKeys);
    if (checked) {
      newSelected.add(key);
    } else {
      newSelected.delete(key);
    }
    setSelectedKeys(newSelected);
    
    if (onSelectionChange) {
      const selectedItems = data.filter(item => newSelected.has(keyExtractor(item)));
      onSelectionChange(selectedItems);
    }
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    if (onSort) {
      onSort(key, sortKey === key && sortDir === "asc" ? "desc" : "asc");
    }
  };

  const rowHeight = compact ? "py-2 px-3" : "py-3 px-4";
  const headerHeight = compact ? "py-2 px-3" : "py-3 px-4";

  if (loading) {
    return (
      <div className="animate-pulse">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-10 bg-muted/30 mb-px rounded" />
        ))}
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* 批量操作栏 */}
      {selectable && selectedKeys.size > 0 && actions && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b border-card-border">
          <span className="text-sm text-foreground-muted">
            {selectedKeys.size} selected
          </span>
          {actions.map((action, idx) => (
            <Button
              key={idx}
              variant={action.variant || "secondary"}
              size="sm"
              onClick={() => {
                const selectedItems = data.filter(item => 
                  selectedKeys.has(keyExtractor(item))
                );
                action.onClick(selectedItems);
              }}
            >
              {action.icon && <action.icon className="w-4 h-4 mr-1.5" />}
              {action.label}
            </Button>
          ))}
        </div>
      )}

      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-card-border bg-background-tertiary/50">
              {selectable && (
                <th className={`text-left ${headerHeight}`}>
                  <Checkbox
                    checked={selectedKeys.size === data.length}
                    onCheckedChange={handleSelectAll}
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`text-left text-xs font-bold uppercase tracking-wider text-foreground-muted ${headerHeight}`}
                  style={{ width: col.width, minWidth: col.minWidth }}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <span className="flex items-center gap-1">
                    {col.title}
                    {col.sortable && sortKey === col.key && (
                      <span className="text-primary">
                        {sortDir === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => {
              const key = keyExtractor(item);
              const isSelected = selectedKeys.has(key);
              
              return (
                <tr
                  key={key}
                  className={`border-b border-card-border/30 hover:bg-background-tertiary/30 transition-colors cursor-pointer
                    ${isSelected ? "bg-primary/5" : ""}
                  `}
                  onClick={() => {
                    if (selectable) {
                      handleSelect(key, !isSelected);
                    }
                    onRowClick?.(item);
                  }}
                  onDoubleClick={() => onRowDoubleClick?.(item)}
                >
                  {selectable && (
                    <td className={rowHeight}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => handleSelect(key, checked)}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={rowHeight}>
                      {col.render(item, 0)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// ERP Stats Card - 紧凑型指标卡
// ============================================================================

interface ERPStatCardProps {
  title: string;
  value: string | number;
  trend?: {
    value: number;
    direction: "up" | "down" | "neutral";
  };
  icon?: React.ComponentType<{ className?: string }>;
  compact?: boolean;
}

export function ERPStatCard({
  title,
  value,
  trend,
  icon: Icon,
  compact = true,
}: ERPStatCardProps) {
  const trendColor = trend
    ? trend.direction === "up"
      ? "text-emerald-400"
      : trend.direction === "down"
      ? "text-red-400"
      : "text-foreground-muted"
    : "text-foreground-muted";

  return (
    <div className={`glass-card ${compact ? "p-3" : "p-5"} hover:-translate-y-0.5 transition-all duration-200`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-foreground-muted font-medium">{title}</span>
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        )}
      </div>
      <div className="flex items-end justify-between">
        <span className="text-xl font-bold text-foreground">
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {trend && (
          <span className={`text-xs font-semibold flex items-center gap-0.5 ${trendColor}`}>
            {trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "→"}
            {Math.abs(trend.value).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}
