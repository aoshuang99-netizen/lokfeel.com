"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { User, Settings, LogOut, ChevronRight } from "lucide-react";
import { signOut, useSession } from "next-auth/react";

interface UserAvatarMenuProps {
  collapsed: boolean;
}

export default function UserAvatarMenu({ collapsed }: UserAvatarMenuProps) {
  const [expanded, setExpanded] = useState(false);
  const [autoCollapseTimer, setAutoCollapseTimer] = useState<NodeJS.Timeout | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { data: session } = useSession();

  const displayName = session?.user?.name || "User";
  const email = session?.user?.email || "";
  const avatarUrl = session?.user?.image || "";
  const initials = displayName.slice(0, 2).toUpperCase();

  // 5秒自动折叠
  const startAutoCollapse = useCallback(() => {
    if (autoCollapseTimer) clearTimeout(autoCollapseTimer);
    const timer = setTimeout(() => setExpanded(false), 5000);
    setAutoCollapseTimer(timer);
  }, [autoCollapseTimer]);

  const stopAutoCollapse = useCallback(() => {
    if (autoCollapseTimer) {
      clearTimeout(autoCollapseTimer);
      setAutoCollapseTimer(null);
    }
  }, [autoCollapseTimer]);

  // 点击展开/折叠
  const toggleExpand = () => {
    if (expanded) {
      stopAutoCollapse();
      setExpanded(false);
    } else {
      setExpanded(true);
      startAutoCollapse();
    }
  };

  // 鼠标悬停保持展开
  const handleMouseEnter = () => {
    if (expanded) {
      stopAutoCollapse();
    }
  };

  const handleMouseLeave = () => {
    if (expanded) {
      startAutoCollapse();
    }
  };

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        stopAutoCollapse();
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [stopAutoCollapse]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (autoCollapseTimer) clearTimeout(autoCollapseTimer);
    };
  }, [autoCollapseTimer]);

  return (
    <div ref={menuRef} className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {/* Avatar button */}
      <button
        onClick={toggleExpand}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-background-tertiary transition-all w-full text-left ${
          collapsed ? "justify-center" : ""
        }`}
      >
        {/* Avatar circle */}
        <div className="relative w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center flex-shrink-0 overflow-hidden ring-2 ring-blue-500/20">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="text-xs font-bold text-white">{initials}</span>
          )}
        </div>

        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex-1 min-w-0"
            >
              <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
              <p className="text-[11px] text-foreground-subtle truncate">{email}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {!collapsed && (
          <motion.div
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronRight className="w-4 h-4 text-foreground-subtle" />
          </motion.div>
        )}
      </button>

      {/* Expanded menu */}
      <AnimatePresence>
        {expanded && !collapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="ml-3 pl-3 border-l border-blue-500/10 space-y-0.5 mt-1">
              <Link
                href="/dashboard/profile"
                onClick={() => { setExpanded(false); stopAutoCollapse(); }}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-all"
              >
                <User className="w-4 h-4" />
                <span>Edit Profile</span>
              </Link>
              <Link
                href="/dashboard/settings"
                onClick={() => { setExpanded(false); stopAutoCollapse(); }}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-all"
              >
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </Link>
              <button
                onClick={() => { setExpanded(false); stopAutoCollapse(); signOut({ callbackUrl: "/login" }); }}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-all w-full"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
