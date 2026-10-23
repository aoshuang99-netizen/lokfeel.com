"use client";

import Link from "next/link";

/**
 * Dashboard Footer — 精简版
 *
 * 桌面端显示在main内容下方，包含版权和法律链接
 * 移动端隐藏（由BottomNav替代）
 *
 * V18.3：`FOOTER_LINK` 原为纯 `text-xs`（12px/16px 行高、无内边距），
 * 实测每个链接 **40×16 / 34×16 / 44×16 / 44×16** —— WCAG 2.2 AA 2.5.8 要求 24×24。
 * 这段页脚是 `hidden lg:block`，所以 390/360/768 都看不到，
 * 是 legacy 四视口验收在 **1440** 上第一次把它量出来的。
 * 只补可点区域（`min-h-6 px-1`），不改字号、不改布局间距。
 */
const FOOTER_LINK =
  "inline-flex items-center min-h-6 px-1 text-foreground-subtle hover:text-accent-lime text-xs transition-colors";

export default function DashboardFooter() {
  return (
    <footer className="hidden lg:block border-t border-card-border mt-auto" role="contentinfo">
      <div className="px-8 py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <p className="text-foreground-subtle text-xs">
              &copy; {new Date().getFullYear()} LokFee! Inc.
            </p>
            <span className="text-foreground-faint">·</span>
            <p className="text-foreground-subtle text-xs">
              Made with care for people who value real connection.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className={FOOTER_LINK}>
              Privacy
            </Link>
            <Link href="/terms" className={FOOTER_LINK}>
              Terms
            </Link>
            <Link href="/cookies" className={FOOTER_LINK}>
              Cookies
            </Link>
            <a href="mailto:support@lokfeel.com" className={FOOTER_LINK}>
              Support
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
