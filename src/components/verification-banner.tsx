"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Mail,
  Phone,
  CheckCircle2,
  Loader2,
  X,
  AlertTriangle,
} from "lucide-react";

type VerificationState = {
  isVerified: boolean | null; // null = loading, true = verified, false = needs verification
};

/**
 * VerificationBanner — shows at top of dashboard when user's email/SMS is not verified.
 * Non-blocking: users can dismiss and browse, but write operations will be gated.
 */
export default function VerificationBanner() {
  const [state, setState] = useState<VerificationState>({ isVerified: null });
  const [dismissed, setDismissed] = useState(false);
  const [showVerifyPanel, setShowVerifyPanel] = useState(false);

  useEffect(() => {
    // Check verification status from user profile API
    fetch("/api/profile/me")
      .then((r) => r.json())
      .then((data: any) => {
        if (data.emailVerified) {
          setState({ isVerified: true });
        } else {
          setState({ isVerified: false });
        }
      })
      .catch(() => setState({ isVerified: false }));
  }, []);

  if (state.isVerified === null || state.isVerified === true || dismissed) return null;

  return (
    <>
      {/* Banner */}
      <div className="w-full bg-amber-500/10 border-b border-amber-500/20 px-4 py-3 relative">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <p className="text-sm text-foreground">
              <span className="text-amber-300 font-medium">Verify your account</span>{" "}
              to unlock messaging, matching reactions & profile updates.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowVerifyPanel(true)}
              className="px-4 py-1.5 text-sm font-medium bg-primary hover:bg-primary/80 text-foreground rounded-lg transition-colors"
            >
              Verify Now
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="p-1 text-foreground-subtle hover:text-foreground-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Verification Panel (inline modal) */}
      {showVerifyPanel && (
        <VerifyInlinePanel onClose={() => setShowVerifyPanel(false)} onSuccess={() => setState({ isVerified: true })} />
      )}
    </>
  );
}

// ─── Inline Verification Panel ──────────────────────────

function VerifyInlinePanel({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [method, setMethod] = useState<"email" | "sms">("email");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [step, setStep] = useState<"choose" | "entering">("choose");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [sentInfo, setSentInfo] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);

  const handleSendCode = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, phone }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to send");

      setSentInfo(data.maskedIdentifier || (method === 'email' ? "your email" : "your phone"));
      
      // In dev mode, show the code directly
      if (data.devMode && data.code) {
        setDevCode(data.code);
      }
      
      setStep("entering");
      startCountdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  const startCountdown = () => {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleCodeChange = (index: number, value: string) => {
    if (value.length > 1) return;
    if (!/^\d*$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    if (value && index < 5) {
      document.getElementById(`verify-code-${index + 1}`)?.focus();
    }
  };

  const handleVerify = async () => {
    const fullCode = code.join("");
    if (fullCode.length !== 6) {
      setError("Enter all 6 digits");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/verify", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: fullCode }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Verification failed");

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative glass-card p-8 max-w-md w-full animate-in fade-in zoom-in-95 duration-200">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-foreground-subtle hover:text-foreground transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold text-foreground mb-1">Verify Your Account</h2>
        <p className="text-sm text-foreground-muted mb-6">
          Complete verification to unlock all features
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-error/20 border border-error/30 text-error text-sm">
            {error}
          </div>
        )}

        {step === "choose" ? (
          /* Method selection */
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMethod('email')}
                className={`flex items-center gap-2 p-4 rounded-xl border transition-all ${
                  method === 'email'
                    ? 'border-primary bg-primary/10'
                    : 'border-card-border bg-background-tertiary hover:border-card-border'
                }`}
              >
                <Mail className="w-5 h-5" />
                <span className="font-medium">Email</span>
              </button>
              <button
                onClick={() => setMethod('sms')}
                className={`flex items-center gap-2 p-4 rounded-xl border transition-all ${
                  method === 'sms'
                    ? 'border-primary bg-primary/10'
                    : 'border-card-border bg-background-tertiary hover:border-card-border'
                }`}
              >
                <Phone className="w-5 h-5" />
                <span className="font-medium">SMS</span>
              </button>
            </div>

            {method === 'sms' && (
              <input
                type="tel"
                placeholder="Phone number (e.g. +1 555 123 4567)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input-feeld"
              />
            )}

            <button
              onClick={handleSendCode}
              disabled={loading || (method === 'sms' && !phone.trim())}
              className="btn-primary w-full"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              ) : (
                `Send ${method === 'email' ? 'Email' : 'SMS'} Code`
              )}
            </button>
          </div>
        ) : (
          /* Code entry */
          <div className="space-y-4">
            <p className="text-sm text-foreground-muted text-center">
              Code sent to <span className="text-foreground font-medium">{sentInfo}</span>
            </p>
            
            {/* Dev Mode: Show code directly */}
            {devCode && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <p className="text-xs text-amber-400 text-center mb-2">Development Mode - Copy this code:</p>
                <div className="flex items-center justify-center gap-2">
                  <code className="text-2xl font-bold text-amber-300 tracking-widest">{devCode}</code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(devCode);
                      // Auto-fill the code inputs
                      const digits = devCode.split('');
                      setCode(digits);
                    }}
                    className="px-3 py-1 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded transition-colors"
                  >
                    Copy & Fill
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-center gap-2">
              {code.map((digit, i) => (
                <input
                  key={i}
                  id={`verify-code-${i}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleCodeChange(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !digit && i > 0)
                      document.getElementById(`verify-code-${i - 1}`)?.focus();
                    if (e.key === "Enter") handleVerify();
                  }}
                  className="w-11 h-13 text-center text-xl font-bold bg-background-tertiary border border-card-border rounded-lg text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                  disabled={loading}
                  autoFocus={i === 0}
                />
              ))}
            </div>

            <button onClick={handleVerify} disabled={loading} className="btn-primary w-full">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Verify
                </>
              )}
            </button>

            <div className="flex items-center justify-center gap-4 text-sm">
              <button
                onClick={() => { setStep("choose"); setCode(["","","","","",""]); }}
                className="text-foreground-subtle hover:text-foreground-muted transition-colors"
              >
                Change method
              </button>
              <span className="text-foreground-faint">|</span>
              <button
                onClick={handleSendCode}
                disabled={countdown > 0 || loading}
                className="text-primary/80 hover:text-primary transition-colors disabled:opacity-50"
              >
                {countdown > 0 ? `Resend (${countdown}s)` : "Resend code"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
