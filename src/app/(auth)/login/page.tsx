"use client";

import { useState } from "react";
import Link from "next/link";
import { Heart, Mail, Globe } from "lucide-react";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await signIn("email", {
        email,
        redirect: false,
      });

      if (result?.error) {
        setError("Failed to send magic link. Please try again.");
      } else {
        setMagicLinkSent(true);
      }
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuthLogin = async (provider: "google" | "github") => {
    setIsLoading(true);
    try {
      await signIn(provider, { callbackUrl: "/dashboard" });
    } catch {
      setError("Failed to sign in. Please try again.");
      setIsLoading(false);
    }
  };

  if (magicLinkSent) {
    return (
      <div className="glass-card p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-6">
          <Mail className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Check Your Email</h1>
        <p className="text-white/60 mb-6">
          We've sent a magic link to <span className="text-white font-medium">{email}</span>
        </p>
        <p className="text-white/40 text-sm mb-6">
          Click the link in the email to sign in. The link expires in 15 minutes.
        </p>
        <button
          onClick={() => setMagicLinkSent(false)}
          className="btn-ghost text-sm"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="glass-card p-8">
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-4">
          <Heart className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Welcome Back</h1>
        <p className="text-white/60">Sign in to continue to Nexus</p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-error/20 border border-error/30 text-error text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleEmailLogin} className="space-y-4 mb-6">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-white/80 mb-2">
            Email Address
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input-feeld pl-11"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="btn-primary w-full"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Sending link...
            </span>
          ) : (
            "Send Magic Link"
          )}
        </button>
      </form>

      <div className="divider my-6">
        <span>or continue with</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => handleOAuthLogin("google")}
          disabled={isLoading}
          className="btn-secondary flex items-center justify-center gap-2"
        >
          <Globe className="w-5 h-5" />
          Google
        </button>
        <button
          onClick={() => handleOAuthLogin("github")}
          disabled={isLoading}
          className="btn-secondary flex items-center justify-center gap-2"
        >
          <Globe className="w-5 h-5" />
          GitHub
        </button>
      </div>

      <p className="text-center text-white/60 mt-8">
        Don't have an account?{" "}
        <Link href="/register" className="text-primary hover:underline font-medium">
          Create one
        </Link>
      </p>
    </div>
  );
}
