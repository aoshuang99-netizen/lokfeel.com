"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  Heart,
  FileText,
  BarChart3,
  Settings,
  ShieldAlert,
  LogOut,
  ChevronDown,
  Zap,
  Megaphone,
} from "lucide-react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<{ username: string; role: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  // 跳过登录页的认证检查
  const isLoginPage = pathname === "/admin/login";

  useEffect(() => {
    if (isLoginPage) {
      setLoading(false);
      return;
    }

    fetch("/api/admin/session", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setSession(data.user);
        } else {
          router.push("/admin/login");
        }
      })
      .catch(() => {
        router.push("/admin/login");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [router, isLoginPage]);

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  };

  // 登录页直接显示
  if (isLoginPage) {
    return <>{children}</>;
  }

  // 加载中
  if (loading) {
    return (
      <div className="min-h-screen bg-[#1a1614] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#c06840] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60 text-sm">验证中...</p>
        </div>
      </div>
    );
  }

  // 未登录（重定向中）
  if (!session) {
    return null;
  }

  const navItems = [
    { href: "/admin", icon: LayoutDashboard, label: "仪表盘" },
    { href: "/admin/users", icon: Users, label: "用户管理" },
    { href: "/admin/matches", icon: Heart, label: "匹配管理" },
    { href: "/admin/content", icon: FileText, label: "内容管理" },
    { href: "/admin/features", icon: Zap, label: "功能管理" },
    { href: "/admin/marketing", icon: Megaphone, label: "营销活动" },
    { href: "/admin/analytics", icon: BarChart3, label: "数据分析" },
    { href: "/admin/settings", icon: Settings, label: "系统设置" },
  ];

  return (
    <div className="min-h-screen bg-background-primary flex">
      {/* Sidebar */}
      <aside className="w-64 bg-background-secondary border-r border-white/5 flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#4c1d95] to-[#8b5cf6] flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold">Admin Console</h1>
              <p className="text-xs text-white/40">后台管理系统</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isActive
                    ? "bg-[#c06840]/20 text-[#c06840]"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User Menu */}
        <div className="p-4 border-t border-white/5">
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#c06840] to-[#c87878] flex items-center justify-center text-white text-sm font-bold">
                {session.username[0].toUpperCase()}
              </div>
              <div className="flex-1 text-left">
                <p className="text-white text-sm font-medium">{session.name}</p>
                <p className="text-white/40 text-xs">{session.role}</p>
              </div>
              <ChevronDown className={`w-4 h-4 text-white/40 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
            </button>

            {menuOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-[#1a1614] border border-white/10 rounded-xl overflow-hidden shadow-xl">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-500/10 transition-all"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="text-sm">退出登录</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
