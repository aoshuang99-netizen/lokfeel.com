"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Home, Search, MessageCircle, Bell, User } from "lucide-react";

// 5入口导航 - 基于竞品研究的最佳实践
// 注意：Profile(我的)已移到Settings页面内，底部导航保持4+1结构
const navItems = [
  { name: "Home", href: "/dashboard", icon: Home, label: "首页" },
  { name: "Discover", href: "/dashboard/discover", icon: Search, label: "发现" },
  { name: "Messages", href: "/dashboard/chat", icon: MessageCircle, label: "消息" },
  { name: "Activity", href: "/dashboard/activity", icon: Bell, label: "动态" },
  { name: "Settings", href: "/dashboard/settings", icon: User, label: "设置" },
];

export default function BottomNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard" || pathname === "/dashboard/";
    }
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden">
      {/* 渐变背景遮罩 */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/95 to-transparent pointer-events-none" />
      
      {/* 导航容器 */}
      <div className="relative bg-surface/90 backdrop-blur-xl border-t border-white/5">
        <div className="flex items-center justify-around py-2 pb-safe">
          {navItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            
            return (
              <Link
                key={item.name}
                href={item.href}
                className="relative flex flex-col items-center gap-1 px-3 py-2 min-w-[64px]"
              >
                {/* 活跃指示器 */}
                {active && (
                  <motion.div
                    layoutId="bottomNavIndicator"
                    className="absolute -top-0.5 w-8 h-1 bg-gradient-to-r from-primary to-secondary rounded-full"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
                
                {/* 图标容器 */}
                <div className={`relative p-2 rounded-xl transition-all duration-200 ${
                  active 
                    ? "bg-gradient-to-br from-primary/20 to-secondary/20 text-primary" 
                    : "text-white/40 hover:text-white/60"
                }`}>
                  <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
                  
                  {/* 未读红点 - Messages */}
                  {item.name === "Messages" && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-primary rounded-full border-2 border-surface" />
                  )}
                </div>
                
                {/* 标签 */}
                <span className={`text-[10px] font-medium transition-colors ${
                  active ? "text-white" : "text-white/40"
                }`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
