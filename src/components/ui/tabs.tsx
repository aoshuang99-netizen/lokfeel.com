"use client";

import { useState, createContext, useContext, useId, useRef, useEffect } from "react";

/* ══════════════════════════════════
   Tab Context
   ══════════════════════════════════ */

interface TabContextValue {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const TabContext = createContext<TabContextValue | null>(null);

function useTabContext() {
  const ctx = useContext(TabContext);
  if (!ctx) throw new Error("useTabContext must be used within <TabGroup>");
  return ctx;
}

/* ══════════════════════════════════
   TabGroup
   ══════════════════════════════════ */

interface TabGroupProps {
  defaultTab: string;
  children: React.ReactNode;
  className?: string;
  onChange?: (tab: string) => void;
}

export function TabGroup({ defaultTab, children, className = "", onChange }: TabGroupProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);

  const handleSetActive = (tab: string) => {
    setActiveTab(tab);
    onChange?.(tab);
  };

  return (
    <TabContext.Provider value={{ activeTab, setActiveTab: handleSetActive }}>
      <div className={className}>{children}</div>
    </TabContext.Provider>
  );
}

/* ══════════════════════════════════
   TabList
   ══════════════════════════════════ */

interface TabListProps {
  children: React.ReactNode;
  className?: string;
  variant?: "underline" | "pill" | "bordered";
}

export function TabList({ children, className = "", variant = "underline" }: TabListProps) {
  const base = "flex gap-1";
  const variants: Record<string, string> = {
    underline: "border-b border-card-border",
    pill: "",
    bordered: "border border-card-border rounded-xl p-1 bg-background-tertiary",
  };

  return (
    <div
      role="tablist"
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </div>
  );
}

/* ══════════════════════════════════
   TabTrigger
   ══════════════════════════════════ */

interface TabTriggerProps {
  value: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  badge?: string | number;
  className?: string;
  disabled?: boolean;
  variant?: "underline" | "pill" | "bordered";
}

export function TabTrigger({
  value,
  children,
  icon,
  badge,
  className = "",
  disabled = false,
  variant = "underline",
}: TabTriggerProps) {
  const { activeTab, setActiveTab } = useTabContext();
  const isActive = activeTab === value;

  const base = "relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none";
  const variants: Record<string, string> = {
    underline: `${base} rounded-none ${
      isActive ? "text-foreground" : "text-foreground-muted hover:text-foreground"
    }`,
    pill: `${base} rounded-full ${
      isActive ? "bg-primary text-white" : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary"
    }`,
    bordered: `${base} rounded-lg ${
      isActive ? "bg-card text-foreground shadow-sm" : "text-foreground-muted hover:text-foreground"
    }`,
  };

  return (
    <button
      role="tab"
      aria-selected={isActive}
      disabled={disabled}
      onClick={() => !disabled && setActiveTab(value)}
      className={`${variants[variant]} ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"} ${className}`}
    >
      {icon}
      {children}
      {badge !== undefined && (
        <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full ${
          isActive ? "bg-white/20 text-white" : "bg-primary/20 text-primary"
        }`}>
          {badge}
        </span>
      )}

      {/* Active indicator — CSS only, no framer-motion */}
      {variant === "underline" && isActive && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-gradient-to-r from-primary to-secondary-hover" />
      )}
    </button>
  );
}

/* ══════════════════════════════════
   TabContent
   CSS fade‑in, no AnimatePresence
   ══════════════════════════════════ */

interface TabContentProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function TabContent({ value, children, className = "" }: TabContentProps) {
  const { activeTab } = useTabContext();
  const isActive  = activeTab === value;
  const prevActiveRef = useRef(activeTab);
  const [renderKey, setRenderKey] = useState(0);

  // bump key on tab change → retriggers CSS animation
  useEffect(() => {
    if (prevActiveRef.current !== activeTab) {
      setRenderKey(k => k + 1);
      prevActiveRef.current = activeTab;
    }
  }, [activeTab]);

  if (!isActive) return null;

  return (
    <div
      key={renderKey}
      role="tabpanel"
      className={`animate-[fadeIn_200ms_ease-out] ${className}`}
    >
      {children}
    </div>
  );
}

/* ══════════════════════════════════
   Convenience composite — Tabs
   ══════════════════════════════════ */

interface TabsProps {
  tabs: { value: string; label: string; icon?: React.ReactNode; badge?: string | number; content: React.ReactNode }[];
  defaultTab?: string;
  variant?: "underline" | "pill" | "bordered";
  className?: string;
  contentClassName?: string;
}

export function Tabs({ tabs, defaultTab, variant = "underline", className = "", contentClassName = "" }: TabsProps) {
  const active = defaultTab || tabs[0]?.value || "";

  return (
    <TabGroup defaultTab={active} className={className}>
      <TabList variant={variant}>
        {tabs.map(tab => (
          <TabTrigger
            key={tab.value}
            value={tab.value}
            icon={tab.icon}
            badge={tab.badge}
            variant={variant}
          >
            {tab.label}
          </TabTrigger>
        ))}
      </TabList>
      {tabs.map(tab => (
        <TabContent key={tab.value} value={tab.value} className={contentClassName}>
          {tab.content}
        </TabContent>
      ))}
    </TabGroup>
  );
}
