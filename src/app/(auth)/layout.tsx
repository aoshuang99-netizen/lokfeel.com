export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Glow Orbs — subtle for light theme */}
      <div className="glow-orb glow-orb-primary w-[600px] h-[600px] -top-48 -left-48 opacity-50" />
      <div className="glow-orb glow-orb-secondary w-[500px] h-[500px] -bottom-48 -right-48 opacity-40" />

      {/* Auth Card */}
      <div className="w-full max-w-md relative z-10">
        {children}
      </div>

      {/* Footer */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center">
        <p className="text-foreground-subtle text-sm">
          By continuing, you agree to our{" "}
          <a href="/terms" className="text-foreground-muted hover:text-foreground transition-colors">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="/privacy" className="text-foreground-muted hover:text-foreground transition-colors">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
