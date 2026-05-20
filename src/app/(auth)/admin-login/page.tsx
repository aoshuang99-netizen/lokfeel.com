/**
 * Admin Login Page - Static Version
 * 
 * No client-side JS, no OAuth, just simple form POST
 */

import { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Admin Login - LokFeel",
  description: "LokFeel Admin Dashboard Login",
};

function ErrorMessage() {
  return (
    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center">
      用户名或密码错误，请重试
    </div>
  );
}

function LoginForm() {
  return (
    <form action="/api/admin/login" method="POST" className="space-y-5">
      {/* Username */}
      <div>
        <label
          htmlFor="username"
          className="block text-sm font-medium text-zinc-400 mb-2"
        >
          用户名 / Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          required
          autoComplete="username"
          placeholder="Enter your username"
          className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
        />
      </div>

      {/* Password */}
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-zinc-400 mb-2"
        >
          密码 / Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="Enter your password"
          className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
        />
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition-all"
      >
        登录 / Sign In
      </button>
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center p-4">
      {/* Logo Section */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-white mb-2">
          <span className="text-blue-500">Lok</span>Feel
        </h1>
        <p className="text-zinc-400 text-sm">Admin Dashboard</p>
      </div>

      {/* Login Card */}
      <div className="w-full max-w-sm">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
          <h2 className="text-xl font-semibold text-white mb-6 text-center">
            管理员登录
          </h2>

          {/* Error Message (always show for failed attempts) */}
          <ErrorMessage />

          {/* Login Form */}
          <Suspense fallback={<div className="text-center text-zinc-400">Loading...</div>}>
            <LoginForm />
          </Suspense>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-700" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-zinc-900 text-zinc-500">
                LokFeel Admin v4.0
              </span>
            </div>
          </div>

          {/* Back Link */}
          <div className="text-center">
            <a
              href="/dashboard"
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              ← 返回应用 / Back to App
            </a>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-zinc-600 text-xs mt-6">
          © 2026 LokFeel. All rights reserved.
        </p>
      </div>
    </div>
  );
}
