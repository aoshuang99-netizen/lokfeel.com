export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Glow Orbs */}
      <div className="glow-orb glow-orb-primary w-96 h-96 -top-48 -left-48 opacity-50" />
      <div className="glow-orb glow-orb-secondary w-96 h-96 -bottom-48 -right-48 opacity-50" />

      {/* Auth Card */}
      <div className="w-full max-w-md relative z-10">
        {children}
      </div>

      {/* Footer */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center">
        <p className="text-white/40 text-sm">
          By continuing, you agree to our{" "}
          <a href="/terms" className="text-white/60 hover:text-white transition-colors">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="/privacy" className="text-white/60 hover:text-white transition-colors">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
