/**
 * 地区限制页面 (Server Component — 无需客户端JS)
 * 当用户从受限地区（如中国大陆）访问时展示
 */
export default function BlockedPage() {

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-6">
        {/* 图标 */}
        <div className="mx-auto w-20 h-20 rounded-full bg-primary-muted flex items-center justify-center">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="oklch(68% 0.14 40)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>

        {/* 标题 */}
        <h1 className="text-2xl font-bold text-foreground font-display">
          Service Not Available
        </h1>

        {/* 说明 */}
        <p className="text-foreground-muted leading-relaxed">
          We&apos;re sorry, but LokFeel is currently not available in your region.
          Our service is designed for specific markets and is not accessible from your location.
        </p>

        {/* 联系信息 */}
        <div className="pt-4 border-t border-card-border">
          <p className="text-sm text-foreground-subtle">
            If you believe this is an error, please contact us at{' '}
            <a
              href="mailto:support@lokfeel.com"
              className="text-primary hover:text-primary-hover underline underline-offset-2"
            >
              support@lokfeel.com
            </a>
          </p>
        </div>

        {/* 装饰性背景 */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
          <div className="absolute -top-1/2 -right-1/2 w-[800px] h-[800px] rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute -bottom-1/2 -left-1/2 w-[600px] h-[600px] rounded-full bg-secondary/5 blur-3xl" />
        </div>
      </div>
    </div>
  )
}
