"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shield, LogOut, User, ChevronDown, Settings } from "lucide-react";

interface AdminUser {
  username: string;
  role: string;
}

export default function AdminHeader() {
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check admin session
    fetch("/api/admin/session")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.user) {
          setUser(data.user);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
      router.push("/admin/login");
      router.refresh();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const roleColors: Record<string, string> = {
    SUPER_ADMIN: "bg-red-500/20 text-red-400",
    ADMIN: "bg-purple-500/20 text-purple-400",
    MODERATOR: "bg-blue-500/20 text-blue-400",
    ANALYST: "bg-emerald-500/20 text-emerald-400",
    SUPPORT: "bg-amber-500/20 text-amber-400",
  };

  return (
    <header className="sticky top-0 z-50 border-b border-card-border bg-background-primary/95 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-2.5">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Shield size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground">Admin Console</h1>
            <p className="text-[10px] text-foreground-muted">红墙计划</p>
          </div>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-3">
          {!loading && user ? (
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background-tertiary hover:bg-background-tertiary/80 transition-colors"
              >
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                  <User size={12} className="text-primary" />
                </div>
                <span className="text-xs font-medium text-foreground">{user.username}</span>
                <span className={`badge text-[10px] px-1.5 py-0.5 ${roleColors[user.role] || ""}`}>
                  {user.role}
                </span>
                <ChevronDown size={12} className="text-foreground-muted" />
              </button>

              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 mt-2 w-48 py-2 bg-card rounded-lg border border-card-border shadow-xl z-50">
                    <div className="px-3 py-2 border-b border-card-border">
                      <p className="text-xs font-medium text-foreground">{user.username}</p>
                      <p className="text-[10px] text-foreground-muted">{user.role}</p>
                    </div>
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        router.push("/admin/settings");
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
                    >
                      <Settings size={14} />
                      设置
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <LogOut size={14} />
                      退出登录
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={() => router.push("/admin/login")}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              管理员登录
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
