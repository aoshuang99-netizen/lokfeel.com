"use client";

/**
 * Admin Command Palette — Cmd+K / Ctrl+K global search
 *
 * Provides quick navigation across admin pages and users.
 *
 * @example
 * // In admin layout:
 * <CommandPalette />
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, Users, LayoutDashboard, FileText, Settings, Shield, X } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  category: "pages" | "users" | "actions";
  href?: string;
  action?: () => void;
}

// ============================================================================
// Static Navigation Items
// ============================================================================

const NAV_PAGES: CommandItem[] = [
  { id: "dashboard", label: "Dashboard", category: "pages", href: "/admin", icon: LayoutDashboard },
  { id: "users", label: "User Management", category: "pages", href: "/admin/users", icon: Users },
  { id: "matches", label: "Match Management", category: "pages", href: "/admin/matches", icon: FileText },
  { id: "analytics", label: "Analytics", category: "pages", href: "/admin/analytics", icon: FileText },
  { id: "content", label: "Content Moderation", category: "pages", href: "/admin/content", icon: FileText },
  { id: "settings", label: "System Settings", category: "pages", href: "/admin/settings", icon: Settings },
  { id: "roles", label: "Role Management", category: "pages", href: "/admin/settings/roles", icon: Shield },
  { id: "audit", label: "Audit Logs", category: "pages", href: "/admin/settings/audit", icon: FileText },
  { id: "admins", label: "Admin Users", category: "pages", href: "/admin/settings/admins", icon: Users },
];

// ============================================================================
// Command Palette Component
// ============================================================================

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Toggle with Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Filter items
  const filtered = query.length > 0
    ? NAV_PAGES.filter(
        item =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.description?.toLowerCase().includes(query.toLowerCase())
      )
    : NAV_PAGES;

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item) {
          if (item.href) {
            router.push(item.href);
          } else if (item.action) {
            item.action();
          }
          setIsOpen(false);
        }
      }
    },
    [filtered, selectedIndex, router]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setIsOpen(false)}
      />

      {/* Panel */}
      <div className="fixed left-1/2 top-[20%] -translate-x-1/2 w-full max-w-lg">
        <div className="mx-4 glass-card overflow-hidden shadow-2xl">
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-card-border">
            <Search className="w-5 h-5 text-foreground-muted flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search pages, users, settings..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent text-foreground placeholder:text-foreground-muted text-sm outline-none"
            />
            <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-[10px] text-foreground-muted font-mono">
              ESC
            </kbd>
          </div>

          {/* Results */}
          {filtered.length > 0 ? (
            <ul className="max-h-80 overflow-y-auto py-2">
              {filtered.map((item, index) => {
                const Icon = item.icon;
                return (
                  <li
                    key={item.id}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                      index === selectedIndex
                        ? "bg-primary/10 text-foreground"
                        : "text-foreground hover:bg-muted/50"
                    }`}
                    onClick={() => {
                      if (item.href) {
                        router.push(item.href);
                      } else if (item.action) {
                        item.action();
                      }
                      setIsOpen(false);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    {Icon && (
                      <Icon className="w-4 h-4 text-foreground-muted flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.label}</div>
                      {item.description && (
                        <div className="text-xs text-foreground-muted truncate">
                          {item.description}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-foreground-muted bg-muted px-1.5 py-0.5 rounded">
                      {item.category}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="py-12 text-center">
              <p className="text-foreground-muted text-sm">
                No results found for &quot;{query}&quot;
              </p>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-card-border bg-muted/30">
            <div className="flex items-center gap-3 text-[10px] text-foreground-muted">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-muted font-mono">↑↓</kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-muted font-mono">↵</kbd>
                Open
              </span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-foreground-muted">
              <kbd className="px-1 py-0.5 rounded bg-muted font-mono">⌘K</kbd>
              Toggle
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
