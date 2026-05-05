import { ReactNode, useState } from "react";

interface Column<T> {
  key: string;
  header: string;
  width?: string;
  render: (item: T) => ReactNode;
}

interface ERPTableProps<T> {
  data: T[];
  columns: Column<T>[];
  selectedKeys: Set<string>;
  onSelect: (key: string) => void;
  onSelectAll: () => void;
  onRowClick?: (item: T) => void;
  keyExtractor: (item: T) => string;
  loading?: boolean;
  emptyText?: string;
}

export function ERPTable<T>({
  data,
  columns,
  selectedKeys,
  onSelect,
  onSelectAll,
  onRowClick,
  keyExtractor,
  loading = false,
  emptyText = "暂无数据",
}: ERPTableProps<T>) {
  const allSelected = data.length > 0 && selectedKeys.size === data.length;

  return (
    <div className="glass-card overflow-hidden">
      {/* 表头 */}
      <div
        className="grid gap-2 px-3 py-2 bg-background-tertiary/50 border-b border-card-border text-[11px] font-medium text-foreground-muted uppercase tracking-wider"
        style={{ gridTemplateColumns: `32px ${columns.map((c) => c.width || "1fr").join(" ")}` }}
      >
        <div className="flex items-center">
          <button onClick={onSelectAll} className="text-foreground-muted hover:text-primary transition-colors">
            {allSelected ? (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
        {columns.map((col) => (
          <div key={col.key}>{col.header}</div>
        ))}
      </div>

      {/* 表格内容 */}
      {loading ? (
        <div className="py-8 text-center text-foreground-muted text-xs">加载中...</div>
      ) : data.length === 0 ? (
        <div className="py-8 text-center text-foreground-muted text-xs">{emptyText}</div>
      ) : (
        <div className="divide-y divide-card-border/50">
          {data.map((item) => {
            const key = keyExtractor(item);
            return (
              <div
                key={key}
                className={`grid gap-2 px-3 py-2 hover:bg-background-tertiary/30 transition-colors ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
                style={{ gridTemplateColumns: `32px ${columns.map((c) => c.width || "1fr").join(" ")}` }}
                onClick={() => onRowClick?.(item)}
              >
                <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => onSelect(key)} className="text-foreground-muted hover:text-primary transition-colors">
                    {selectedKeys.has(key) ? (
                      <svg className="w-3.5 h-3.5 text-primary" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="3" y="3" width="18" height="18" rx="3" strokeWidth={1.5} />
                      </svg>
                    )}
                  </button>
                </div>
                {columns.map((col) => (
                  <div key={col.key} className="flex items-center min-w-0">
                    {col.render(item)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ERPStatCardProps {
  label: string;
  value: string | number;
  change?: number;
  color?: "blue" | "emerald" | "amber" | "red" | "purple";
}

const colorMap = {
  blue: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  amber: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  red: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20" },
  purple: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20" },
};

export function ERPStatCard({ label, value, change, color = "blue" }: ERPStatCardProps) {
  const c = colorMap[color];
  return (
    <div className={`glass-card p-3 ${c.border} border`}>
      <div className="text-[11px] text-foreground-muted uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-bold ${c.text} mt-1`}>{value}</div>
      {change !== undefined && (
        <div className={`text-[11px] mt-1 ${change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {change >= 0 ? "+" : ""}{change}%
        </div>
      )}
    </div>
  );
}

interface ERPBatchBarProps {
  count: number;
  onClear: () => void;
  actions: { label: string; color: "emerald" | "amber" | "red" | "blue"; onClick: () => void }[];
}

export function ERPBatchBar({ count, onClear, actions }: ERPBatchBarProps) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-primary/10 border border-primary/20 rounded-lg animate-in slide-in-from-top duration-200">
      <span className="text-xs text-primary font-medium">已选 {count} 项</span>
      <div className="flex-1" />
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={action.onClick}
          className={`text-[11px] px-2.5 py-1 rounded-md bg-${action.color}-500/20 text-${action.color}-400 hover:bg-${action.color}-500/30 transition-colors`}
        >
          {action.label}
        </button>
      ))}
      <button onClick={onClear} className="text-[11px] px-2.5 py-1 rounded-md text-foreground-muted hover:text-foreground transition-colors">
        清除
      </button>
    </div>
  );
}

export default { ERPTable, ERPStatCard, ERPBatchBar };
