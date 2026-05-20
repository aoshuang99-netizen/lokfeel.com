/**
 * Admin Login Page
 *
 * This page is served when accessing /admin/login directly or
 * when the admin layout redirects unauthenticated users here.
 */

import AdminLoginForm from "@/components/admin/login-form";

export default function AdminLoginPage() {
  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">LokFeel Admin</h1>
          <p className="text-zinc-400 text-sm">Sign in to access the admin dashboard</p>
        </div>

        {/* Login Form */}
        <AdminLoginForm />
      </div>
    </div>
  );
}
