"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Mail, ArrowLeft, RefreshCw } from "lucide-react";

export default function VerifyRequestPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  useEffect(() => {
    // Get email from URL or localStorage
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get("email");
    if (emailParam) {
      setEmail(emailParam);
    } else {
      // Try to get from session
      const storedEmail = localStorage.getItem("pending_verification_email");
      if (storedEmail) {
        setEmail(storedEmail);
      }
    }
  }, []);

  const handleResend = async () => {
    if (!email) return;
    
    setIsResending(true);
    setResendSuccess(false);

    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setResendSuccess(true);
        setTimeout(() => setResendSuccess(false), 3000);
      }
    } catch {
      // Handle error silently
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="glass-card p-8 text-center">
      <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-6">
        <Mail className="w-10 h-10 text-primary" />
      </div>

      <h1 className="text-2xl font-bold text-white mb-2">Check Your Email</h1>
      
      {email ? (
        <p className="text-white/60 mb-4">
          We sent a verification link to{" "}
          <span className="text-white font-medium">{email}</span>
        </p>
      ) : (
        <p className="text-white/60 mb-4">
          We sent a verification link to your email address
        </p>
      )}

      <div className="bg-white/5 rounded-xl p-6 mb-6 text-left">
        <h3 className="text-sm font-semibold text-white mb-3">Didn't receive the email?</h3>
        <ul className="text-sm text-white/60 space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            Check your spam or junk folder
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            Make sure you entered the correct email address
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            Wait a few minutes — emails can take time to arrive
          </li>
        </ul>
      </div>

      {resendSuccess ? (
        <div className="p-4 rounded-xl bg-success/20 border border-success/30 text-success text-sm mb-4">
          Verification email sent! Check your inbox.
        </div>
      ) : (
        <button
          onClick={handleResend}
          disabled={isResending || !email}
          className="btn-secondary w-full mb-4"
        >
          {isResending ? (
            <span className="flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Sending...
            </span>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              Resend Verification Email
            </>
          )}
        </button>
      )}

      <Link
        href="/login"
        className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Sign In
      </Link>
    </div>
  );
}
