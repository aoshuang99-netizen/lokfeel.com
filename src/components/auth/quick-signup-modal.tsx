"use client";

import React, { useState, FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, ChevronLeft, Check, Mail, Lock, User as UserIcon, Cake, Heart, ArrowRight } from "lucide-react";
import { GENDER_OPTIONS, SEXUALITY_OPTIONS } from "@/constants";
import { safeJsonParse, getAuthErrorMessage } from "@/lib/safe-json";

type Step = "email" | "social" | "basic" | "gender" | "verify" | "success";

interface QuickSignupModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: "email" | "social";
}

export default function QuickSignupModal({ isOpen, onClose, defaultTab = "email" }: QuickSignupModalProps) {
  const [activeTab, setActiveTab] = useState<"email" | "social">(defaultTab);
  const [step, setStep] = useState<Step>(defaultTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [sexuality, setSexuality] = useState("");
  const [otp, setOtp] = useState("");

  const resetState = () => {
    setStep(defaultTab);
    setLoading(false);
    setError("");
    setEmail("");
    setPassword("");
    setDisplayName("");
    setDob("");
    setGender("");
    setSexuality("");
    setOtp("");
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // Email signup flow
  const handleEmailStep = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!displayName || !dob) {
      setError("Please fill in all fields");
      return;
    }
    setError("");
    setStep("gender");
  };

  const handleGenderStep = () => {
    if (!gender || !sexuality) {
      setError("Please select your gender and sexuality");
      return;
    }
    setError("");
    setStep("email");
  };

  const handleEmailSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter email and password");
      return;
    }
    setError("");
    setLoading(true);
    fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step: "send-code",
        email,
        password,
        displayName,
        dob,
        gender,
        sexuality,
      }),
    })
      .then((res) => safeJsonParse<{ error?: string; message?: string }>(res))
      .then((data) => {
        setLoading(false);
        if (data.error) {
          setError(data.error);
        } else {
          setStep("verify");
        }
      })
      .catch((err) => {
        setLoading(false);
        setError(getAuthErrorMessage(err));
      });
  };

  const handleVerify = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!otp || otp.length < 4) {
      setError("Please enter the verification code");
      return;
    }
    setLoading(true);
    fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step: "verify",
        email,
        code: otp,
        name: displayName,
        displayName,
        dob,
        gender,
        sexuality,
      }),
    })
      .then((res) => safeJsonParse<{ error?: string; message?: string; autoLoginToken?: string }>(res))
      .then((data) => {
        setLoading(false);
        if (data.error) {
          setError(data.error);
        } else {
          setStep("success");
          setTimeout(() => {
            window.location.href = "/dashboard";
          }, 1500);
        }
      })
      .catch((err) => {
        setLoading(false);
        setError(getAuthErrorMessage(err));
      });
  };

  const handleResendCode = () => {
    if (!email || !password) return
    setError("")
    setLoading(true);
    fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step: "send-code",
        email,
        password,
        displayName,
        dob,
        gender,
        sexuality,
      }),
    })
      .then((res) => safeJsonParse<{ error?: string; message?: string }>(res))
      .then((data) => {
        setLoading(false);
        if (data.error) {
          setError(data.error);
        }
      })
      .catch((err) => {
        setLoading(false);
        setError(getAuthErrorMessage(err));
      });
  };

  // Social login handlers
  const handleGoogleLogin = () => {
    // Direct navigation to custom PKCE signin endpoint
    // (Previous fetch-based approach failed because our [...nextauth] interceptor
    // returns NextResponse.redirect() which doesn't work with fetch + X-Auth-Return-Redirect)
    window.location.href = "/api/auth/oauth/google/signin?callbackUrl=/dashboard";
  };

  const handleXLogin = () => {
    window.location.href = "/api/auth/twitter/signin?callbackUrl=/dashboard";
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
            onClick={handleClose}
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
              onClick={handleClose}
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

            {/* Tab Switcher */}
            <div className="flex gap-1 p-1 bg-background-tertiary rounded-xl mb-6">
              <button
                onClick={() => { setActiveTab("email"); setStep("basic"); setError(""); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === "email"
                    ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                Email Sign Up
              </button>
              <button
                onClick={() => { setActiveTab("social"); setStep("social"); setError(""); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === "social"
                    ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                Social Login
              </button>
            </div>

            {/* ========== EMAIL SIGNUP FLOW ========== */}
            {activeTab === "email" && (
              <div>
                {/* Step 1: Basic info */}
                {step === "basic" && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <h2 className="text-xl font-bold text-foreground mb-1 font-display">Let's get to know you</h2>
                    <p className="text-sm text-foreground-muted mb-6">Step 1 of 3 — Tell us about yourself</p>

                    <form onSubmit={handleEmailStep} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground-muted mb-1.5">Display Name</label>
                        <div className="relative">
                          <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-faint" />
                          <input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="Your name or nickname"
                            className="input-field w-full pl-11"
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-foreground-muted mb-1.5">Date of Birth</label>
                        <div className="relative">
                          <Cake className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-faint" />
                          <input
                            type="date"
                            value={dob}
                            onChange={(e) => setDob(e.target.value)}
                            className="input-field w-full pl-11"
                            required
                          />
                        </div>
                      </div>

                      {error && (
                        <p className="text-sm text-red-400">{error}</p>
                      )}

                      <button type="submit" className="btn-primary w-full">
                        Continue
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </form>
                  </motion.div>
                )}

                {/* Step 2: Gender & Sexuality */}
                {step === "gender" && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <button onClick={() => setStep("basic")} className="p-1 rounded-lg hover:bg-background-tertiary transition-all">
                        <ChevronLeft className="w-4 h-4 text-foreground-muted" />
                      </button>
                      <h2 className="text-xl font-bold text-foreground font-display">Your Identity</h2>
                    </div>
                    <p className="text-sm text-foreground-muted mb-6 ml-7">Step 2 of 3 — Help us find your matches</p>

                    <div className="space-y-5">
                      {/* Gender */}
                      <div>
                        <label className="block text-sm font-medium text-foreground-muted mb-2">I am</label>
                        <div className="flex flex-wrap gap-2">
                          {GENDER_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setGender(opt.value)}
                              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                                gender === opt.value
                                  ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                                  : "bg-background-tertiary text-foreground-muted hover:text-foreground hover:bg-background-tertiary/80"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Sexuality */}
                      <div>
                        <label className="block text-sm font-medium text-foreground-muted mb-2">I'm interested in</label>
                        <div className="flex flex-wrap gap-2">
                          {SEXUALITY_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setSexuality(opt.value)}
                              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                                sexuality === opt.value
                                  ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
                                  : "bg-background-tertiary text-foreground-muted hover:text-foreground hover:bg-background-tertiary/80"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {error && (
                        <p className="text-sm text-red-400">{error}</p>
                      )}

                      <button onClick={handleGenderStep} className="btn-primary w-full">
                        Continue
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* Step 3: Email + Password */}
                {step === "email" && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <button onClick={() => setStep("gender")} className="p-1 rounded-lg hover:bg-background-tertiary transition-all">
                        <ChevronLeft className="w-4 h-4 text-foreground-muted" />
                      </button>
                      <h2 className="text-xl font-bold text-foreground font-display">Create Account</h2>
                    </div>
                    <p className="text-sm text-foreground-muted mb-6 ml-7">Step 3 of 3 — Almost there!</p>

                    <form onSubmit={handleEmailSubmit} className="space-y-4">
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
                            placeholder="Min 8 characters"
                            minLength={8}
                            className="input-field w-full pl-11"
                            required
                          />
                        </div>
                      </div>

                      {error && (
                        <p className="text-sm text-red-400">{error}</p>
                      )}

                      <button type="submit" disabled={loading} className="btn-primary w-full">
                        {loading ? "Sending code..." : "Send Verification Code"}
                        {!loading && <ArrowRight className="w-4 h-4" />}
                      </button>
                    </form>
                  </motion.div>
                )}

                {/* Step: Verify OTP */}
                {step === "verify" && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <button onClick={() => setStep("email")} className="p-1 rounded-lg hover:bg-background-tertiary transition-all">
                        <ChevronLeft className="w-4 h-4 text-foreground-muted" />
                      </button>
                      <h2 className="text-xl font-bold text-foreground font-display">Verify Email</h2>
                    </div>
                    <p className="text-sm text-foreground-muted mb-6 ml-7">Enter the code sent to {email}</p>

                    <form onSubmit={handleVerify} className="space-y-4">
                      <div>
                        <input
                          type="text"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                          placeholder="123456"
                          className="input-field w-full text-center text-2xl tracking-[0.5em] font-bold"
                          maxLength={6}
                          required
                        />
                      </div>

                      {error && (
                        <p className="text-sm text-red-400">{error}</p>
                      )}

                      <button type="submit" disabled={loading} className="btn-primary w-full">
                        {loading ? "Verifying..." : "Verify & Create Account"}
                        {!loading && <Check className="w-4 h-4" />}
                      </button>

                      <p className="text-center text-sm text-foreground-muted">
                        Didn't receive code?{" "}
                        <button type="button" onClick={handleResendCode} className="text-blue-400 hover:text-blue-300 transition-colors">
                          Resend
                        </button>
                      </p>
                    </form>
                  </motion.div>
                )}

                {/* Step: Success */}
                {step === "success" && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center py-8"
                  >
                    <div className="w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 flex items-center justify-center mx-auto mb-4">
                      <Check className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-foreground mb-2">Welcome to LokFee!!</h2>
                    <p className="text-sm text-foreground-muted">Redirecting you to dashboard...</p>
                  </motion.div>
                )}
              </div>
            )}

            {/* ========== SOCIAL LOGIN FLOW ========== */}
            {activeTab === "social" && (
              <div>
                <h2 className="text-xl font-bold text-foreground mb-1 font-display text-center">Quick & Easy</h2>
                <p className="text-sm text-foreground-muted mb-8 text-center">Sign up with your social account</p>

                <div className="space-y-3">
                  {/* Google */}
                  <button
                    onClick={handleGoogleLogin}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white hover:bg-gray-50 text-gray-900 font-medium transition-all"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Continue with Google
                  </button>

                  {/* X / Twitter */}
                  <button
                    onClick={handleXLogin}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-[#1a1a1a] hover:bg-[#222] text-white font-medium transition-all border border-white/10"
                  >
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.259 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                    Continue with X
                  </button>
                </div>

                <div className="mt-6 text-center">
                  <p className="text-xs text-foreground-faint">
                    By signing up, you agree to our{" "}
                    <a href="/terms" className="text-blue-400 hover:text-blue-300">Terms</a>
                    {" "}and{" "}
                    <a href="/privacy" className="text-blue-400 hover:text-blue-300">Privacy</a>
                  </p>
                </div>

                <div className="mt-4 text-center">
                  <p className="text-sm text-foreground-muted">
                    Already have an account?{" "}
                    <button
                      onClick={() => { setActiveTab("email"); setStep("basic"); }}
                      className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
                    >
                      Log in
                    </button>
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
