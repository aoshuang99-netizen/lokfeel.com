"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { signIn } from "next-auth/react";

function AutoLoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Verifying your email...");

  const email = searchParams.get("email");
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  useEffect(() => {
    if (!email) {
      setStatus("error");
      setMessage("Invalid login link. Please try logging in manually.");
      return;
    }

    // Auto-login flow
    const doAutoLogin = async () => {
      try {
        // First, check if user exists and get their info
        const checkRes = await fetch("/api/auth/check-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });

        if (!checkRes.ok) {
          // User might not exist yet - redirect to complete registration
          setMessage("Redirecting to complete your registration...");
          setTimeout(() => {
            router.push(`/register?email=${encodeURIComponent(email)}&verified=true`);
          }, 1500);
          return;
        }

        const userData = await checkRes.json();

        // User exists - we need to sign them in
        // Since we don't have the password, we'll use a special "magic-link" provider
        // or redirect them to login with a success message
        
        // For now, redirect to login with email pre-filled and a success flag
        // The user can then enter their password or use OAuth
        setStatus("success");
        setMessage("Email verified! Redirecting to dashboard...");
        
        // Try to sign in with magic-link credentials
        const result = await signIn("credentials", {
          email,
          password: "MAGIC_LINK_AUTH", // Special marker - will be handled by authorize function
          redirect: false,
        });

        if (result?.ok) {
          // Successfully logged in
          setTimeout(() => {
            router.push(callbackUrl);
          }, 1000);
        } else {
          // Magic link auth failed, redirect to login
          setTimeout(() => {
            router.push(`/login?verified=true&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
          }, 1500);
        }
      } catch (error) {
        console.error("Auto-login error:", error);
        setStatus("error");
        setMessage("Something went wrong. Please log in manually.");
        setTimeout(() => {
          router.push("/login");
        }, 2000);
      }
    };

    doAutoLogin();
  }, [email, callbackUrl, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d0c11]">
      <div className="glass-card p-8 max-w-md w-full text-center">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div
            className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0"
            style={{
              background:
                "linear-gradient(135deg, #f43f5e 0%, #9333ea 50%, #f59e0b 100%)",
            }}
          >
            <div className="w-full h-full flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </div>
          </div>
          <span className="text-2xl font-bold bg-gradient-to-r from-pink-400 via-orange-400 to-amber-400 bg-clip-text text-transparent">
            LokFeel
          </span>
        </div>

        <div className="flex flex-col items-center gap-4">
          {status === "loading" && (
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
          )}
          {status === "success" && (
            <CheckCircle2 className="w-12 h-12 text-green-500" />
          )}
          {status === "error" && (
            <AlertCircle className="w-12 h-12 text-red-500" />
          )}

          <h1 className="text-xl font-bold text-white">
            {status === "loading" && "Verifying..."}
            {status === "success" && "Welcome Back!"}
            {status === "error" && "Oops!"}
          </h1>

          <p className="text-white/60">{message}</p>

          {status === "error" && (
            <button
              onClick={() => router.push("/login")}
              className="btn-primary mt-4"
            >
              Go to Login
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AutoLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#0d0c11]">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-white/60">Loading...</p>
        </div>
      </div>
    }>
      <AutoLoginContent />
    </Suspense>
  );
}
