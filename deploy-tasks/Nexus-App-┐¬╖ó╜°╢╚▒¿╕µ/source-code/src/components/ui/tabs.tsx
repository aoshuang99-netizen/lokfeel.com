"use client";

import { useState, createContext, useContext } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ══════════════════════════════════════
// TAB CONTEXT
// ══════════════════════════════════════

interface TabContextValue {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const TabContext = createContext<TabContextValue | null>(null);

function useTabContext() {
  const ctx = useContext(TabContext);
  if (!ctx) throw new Error("useTabContext must be used within TabProvider");
  return ctx;
}

// ══════════════════════════════════════
// TAB GROUP
// ══════════════════════════════════════

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

// ══════════════════════════════════════
// TAB LIST
// ══════════════════════════════════════

interface TabListProps {
  children: React.ReactNode;
  className?: string;
  variant?: "underline" | "pill" | "bordered";
}

export function TabList({ children, className = "", variant = "underline" }: TabListProps) {
  const baseClasses = "flex gap-1";
  
  const variantClasses = {
    underline: "border-b border-card-border",
    pill: "",
    bordered: "border border-card-border rounded-xl p-1 bg-background-tertiary",
  };

  return (
    <div
      role="tablist"
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
    >
      {children}
    </div>
  );
}

// ══════════════════════════════════════
// TAB TRIGGER
// ══════════════════════════════════════

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

  const baseClasses = "relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors focus:outline-none";

  const variantClasses = {
    underline: `${baseClasses} rounded-none ${
      isActive
        ? "text-foreground"
        : "text-foreground-muted hover:text-foreground"
    }`,
    pill: `${baseClasses} rounded-full ${
      isActive
        ? "bg-primary text-white"
        : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary"
    }`,
    bordered: `${baseClasses} rounded-lg ${
      isActive
        ? "bg-card text-foreground shadow-sm"
        : "text-foreground-muted hover:text-foreground"
    }`,
  };

  return (
    <button
      role="tab"
      aria-selected={isActive}
      disabled={disabled}
      onClick={() => !disabled && setActiveTab(value)}
      className={`${variantClasses[variant]} ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"} ${className}`}
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
      {/* Active indicator for underline variant */}
      {variant === "underline" && isActive && (
        <motion.div
          layoutId="activeTab"
          className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-primary rounded-full"
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      )}
    </button>
  );
}

// ══════════════════════════════════════
// TAB CONTENT
// ══════════════════════════════════════

interface TabContentProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function TabContent({ value, children, className = "" }: TabContentProps) {
  const { activeTab } = useTabContext();

  return (
    <AnimatePresence mode="wait">
      {activeTab === value && (
        <motion.div
          role="tabpanel"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ══════════════════════════════════════
// CONVENIENCE COMPOSITE COMPONENT
// ══════════════════════════════════════

interface TabsProps {
  tabs: { value: string; label: string; icon?: React.ReactNode; badge?: string | number; content: React.ReactNode }[];
  defaultTab?: string;
  variant?: "underline" | "pill" | "bordered";
  className?: string;
  contentClassName?: string;
}

export function Tabs({ tabs, defaultTab, variant = "underline", className = "", contentClassName = "" }: TabsProps) {
  const activeTab = defaultTab || tabs[0]?.value || "";

  return (
    <TabGroup defaultTab={activeTab} className={className}>
      <TabList variant={variant}>
        {tabs.map((tab) => (
          <TabTrigger key={tab.value} value={tab.value} icon={tab.icon} badge={tab.badge} variant={variant}>
            {tab.label}
          </TabTrigger>
        ))}
      </TabList>
      {tabs.map((tab) => (
        <TabContent key={tab.value} value={tab.value} className={contentClassName}>
          {tab.content}
        </TabContent>
      ))}
    </TabGroup>
  );
}
