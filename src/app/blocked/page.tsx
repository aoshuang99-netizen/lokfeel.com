/**
 * 地区限制页面 (Server Component — 无需客户端JS)
 * 当用户从受限地区（如中国大陆）访问时展示
 *
 * DESIGN: Cool Blue Design System — 与主站视觉一致
 */
export default function BlockedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6 relative overflow-hidden">
      {/* Cool Blue 装饰背景 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-1/2 -right-1/2 w-[800px] h-[800px] rounded-full blur-3xl"
          style={{ background: "rgba(59,130,246,0.08)" }}
        />
        <div
          className="absolute -bottom-1/2 -left-1/2 w-[600px] h-[600px] rounded-full blur-3xl"
          style={{ background: "rgba(99,102,241,0.06)" }}
        />
      </div>

      <div className="max-w-md w-full text-center space-y-8 relative z-10">
        {/* 图标 — Cool Blue 风格 */}
        <div
          className="mx-auto w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(99,102,241,0.1))",
            border: "1px solid rgba(59,130,246,0.2)",
          }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#60a5fa"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>

        {/* 标题 */}
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-foreground font-display">
            Service Not Available
          </h1>
          <div
            className="h-0.5 w-16 mx-auto rounded-full"
            style={{
              background: "linear-gradient(90deg, #3b82f6, #6366f1)",
            }}
          />
        </div>

        {/* 说明 */}
        <p className="text-foreground-muted leading-relaxed text-base">
          We&apos;re sorry, but LokFee! is currently not available in your region.
          Our service is designed for specific markets and is not accessible from your location.
        </p>

        {/* 区域信息提示 */}
        <div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm"
          style={{
            background: "rgba(59,130,246,0.08)",
            border: "1px solid rgba(59,130,246,0.15)",
            color: "#60a5fa",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span>Detected region: Mainland China</span>
        </div>

        {/* 联系信息 */}
        <div className="pt-6 border-t border-card-border">
          <p className="text-sm text-foreground-subtle">
            If you believe this is an error, please contact us at{" "}
            <a
              href="mailto:support@lokfeel.com"
              className="text-primary hover:text-primary-hover underline underline-offset-2 transition-colors"
            >
              support@lokfeel.com
            </a>
          </p>
        </div>

        {/* 底部品牌 */}
        <div className="pt-4">
          <p className="text-xs text-foreground-subtle/60">
            LokFee! — Find Real Love. No Swiping.
          </p>
        </div>
      </div>
    </div>
  )
}
