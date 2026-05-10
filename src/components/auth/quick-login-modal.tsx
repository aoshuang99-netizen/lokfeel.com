"use client";

import React, { useState, FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail, Lock, Heart, ArrowRight } from "lucide-react";
import { signIn } from "next-auth/react";

interface QuickLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToSignup: () => void;
}

export default function QuickLoginModal({ isOpen, onClose, onSwitchToSignup }: QuickLoginModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password");
      return;
    }
    setError("");
    setLoading(true);

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError("Invalid email or password");
    } else {
      window.location.href = "/dashboard";
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = "/api/auth/signin/google?callbackUrl=/dashboard";
  };

  const handleXLogin = () => {
    window.location.href = "/api/auth/signin/twitter?callbackUrl=/dashboard";
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="relative w-full max-w-md max-h-[90vh] overflow-y-auto glass-strong rounded-2xl p-6 md:p-8"
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-lg text-foreground-subtle hover:text-foreground hover:bg-background-tertiary transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Logo */}
            <div className="flex items-center justify-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-500 flex items-center justify-center">
                <Heart className="w-4 h-4 text-white" fill="white" />
              </div>
              <span className="text-lg font-bold text-gradient">LokFee!</span>
            </div>

            <h2 className="text-xl font-bold text-foreground mb-1 font-display text-center">Welcome Back</h2>
            <p className="text-sm text-foreground-muted mb-6 text-center">Log in to your account</p>

            {/* Social Login Buttons */}
            <div className="space-y-3 mb-6">
              <button
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white hover:bg-gray-50 text-gray-900 font-medium transition-all"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18c-1.43 1.48-2.26 3.25-2.26 5.43s.83 3.95 2.26 5.43l2.85-2.22z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              <button
                onClick={handleXLogin}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-[#1a1a1a] hover:bg-[#222] text-white font-medium transition-all border border-white/10"
              >
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-3.981l-6.222-7.59-7.095 7.59H1.414l7.423-8.45L1.98 2.25H8.08l5.715 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                Continue with X
              </button>
            </div>

            <div className="divider">
              <span className="px-3 text-xs text-foreground-faint">OR</span>
            </div>

            {/* Email/Password Form */}
            <form onSubmit={handleSubmit} className="space-y-4 mt-6">
              <div>
                <label className="block text-sm font-medium text-foreground-muted mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-faint" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="input-field w-full pl-11"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground-muted mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-faint" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                    className="input-field w-full pl-11"
                    required
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? "Signing in..." : "Log In"}
                {!loading && <ArrowRight className="w-4 h-4" />}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-foreground-muted">
                Don't have an account?{" "}
                <button
                  onClick={onSwitchToSignup}
                  className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
                >
                  Sign up
                </button>
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
