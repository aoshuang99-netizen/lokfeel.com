"use client";

import Link from "next/link";

/**
 * Dashboard Footer — 精简版
 * 
 * 桌面端显示在main内容下方，包含版权和法律链接
 * 移动端隐藏（由BottomNav替代）
 */
export default function DashboardFooter() {
  return (
    <footer className="hidden lg:block border-t border-card-border mt-auto" role="contentinfo">
      <div className="px-8 py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <p className="text-foreground-subtle text-xs">
              &copy; {new Date().getFullYear()} LokFeel Inc.
            </p>
            <span className="text-foreground-faint">·</span>
            <p className="text-foreground-subtle text-xs">
              Made with care for people who value real connection.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/privacy"
              className="text-foreground-subtle hover:text-accent-lime text-xs transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-foreground-subtle hover:text-accent-lime text-xs transition-colors"
            >
              Terms
            </Link>
            <Link
              href="/cookies"
              className="text-foreground-subtle hover:text-accent-lime text-xs transition-colors"
            >
              Cookies
            </Link>
            <a
              href="mailto:support@lokfeel.com"
              className="text-foreground-subtle hover:text-accent-lime text-xs transition-colors"
            >
              Support
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
