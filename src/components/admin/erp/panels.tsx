import { ReactNode } from "react";

interface FilterField {
  key: string;
  label: string;
  type: "text" | "select" | "date" | "number";
  options?: { value: string; label: string }[];
}

interface ERPFilterProps {
  fields: FilterField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onReset: () => void;
  onSearch: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function ERPFilter({
  fields,
  values,
  onChange,
  onReset,
  onSearch,
  collapsed = false,
  onToggle,
}: ERPFilterProps) {
  if (collapsed) {
    return (
      <div className="flex items-center gap-2 py-2">
        <button
          onClick={onToggle}
          className="text-[11px] px-2.5 py-1 rounded-md bg-background-tertiary text-foreground-muted hover:text-foreground transition-colors"
        >
          🔍 筛选
        </button>
        {Object.entries(values).filter(([, v]) => v).length > 0 && (
          <span className="text-[11px] text-primary">
            已选 {Object.entries(values).filter(([, v]) => v).length} 个条件
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="glass-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground-muted uppercase tracking-wider">高级筛选</span>
        {onToggle && (
          <button onClick={onToggle} className="text-[11px] text-foreground-muted hover:text-foreground">
            收起
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1">
            <label className="text-[11px] text-foreground-muted">{field.label}</label>
            {field.type === "text" && (
              <input
                type="text"
                value={values[field.key] || ""}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="input-field text-[11px] py-1.5"
                placeholder={`输入${field.label}...`}
              />
            )}
            {field.type === "select" && (
              <select
                value={values[field.key] || ""}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="input-field text-[11px] py-1.5"
              >
                <option value="">全部</option>
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
            {field.type === "date" && (
              <input
                type="date"
                value={values[field.key] || ""}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="input-field text-[11px] py-1.5"
              />
            )}
            {field.type === "number" && (
              <input
                type="number"
                value={values[field.key] || ""}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="input-field text-[11px] py-1.5"
                placeholder="输入数字..."
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2 justify-end">
        <button
          onClick={onReset}
          className="text-[11px] px-3 py-1.5 rounded-md bg-background-tertiary text-foreground-muted hover:text-foreground transition-colors"
        >
          重置
        </button>
        <button
          onClick={onSearch}
          className="text-[11px] px-3 py-1.5 rounded-md bg-primary text-white hover:bg-primary/90 transition-colors"
        >
          搜索
        </button>
      </div>
    </div>
  );
}

interface ERPDetailPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}

export function ERPDetailPanel({
  open,
  onClose,
  title,
  children,
  width = "500px",
}: ERPDetailPanelProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {/* 面板 */}
      <div
        className="relative glass-card rounded-r-none h-full overflow-y-auto animate-in slide-in-from-right duration-300"
        style={{ width }}
      >
        <div className="sticky top-0 z-10 bg-background-primary/95 backdrop-blur-sm border-b border-card-border p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <button onClick={onClose} className="text-foreground-muted hover:text-foreground transition-colors">
              ✕
            </button>
          </div>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export default { ERPFilter, ERPDetailPanel };
