/**
 * Custom 404 Page — Dateasy Dark Theme
 * Replaces default Next.js white-background 404
 */
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6 relative">
      {/* Decorative background gradients */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute -top-1/2 -right-1/2 w-[800px] h-[800px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-1/2 -left-1/2 w-[600px] h-[600px] rounded-full bg-secondary/5 blur-3xl" />
      </div>

      <div className="max-w-md w-full text-center space-y-6">
        {/* 404 number */}
        <div className="relative">
          <span className="text-[120px] font-extrabold leading-none bg-gradient-to-br from-primary via-purple-400 to-accent-pink bg-clip-text text-transparent select-none">
            404
          </span>
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent-pink/10 blur-2xl -z-10 scale-150" />
        </div>

        {/* Heading */}
        <h1 className="text-2xl font-bold text-foreground font-display">
          Page Not Found
        </h1>

        {/* Description */}
        <p className="text-foreground-muted leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
          Let&apos;s get you back on track.
        </p>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-accent-lime text-background font-semibold hover:bg-accent-lime/90 transition-all duration-200 hover:scale-[1.02]"
          >
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              />
            </svg>
            Go to Dashboard
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-card-border text-foreground-muted hover:text-foreground hover:border-primary/40 transition-all duration-200"
          >
            Sign In
          </Link>
        </div>

        {/* Support link */}
        <p className="text-sm text-foreground-subtle pt-4 border-t border-card-border">
          Need help?{' '}
          <a
            href="mailto:support@lokfeel.com"
            className="text-primary hover:text-primary-hover underline underline-offset-2"
          >
            Contact Support
          </a>
        </p>
      </div>
    </div>
  );
}
