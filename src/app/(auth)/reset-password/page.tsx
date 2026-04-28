/**
 * Reset Password PAGE — Server Component
 * Validates token from URL before showing the form
 */
import { auth } from "@/lib/auth/auth";
import { redirect } from "next/navigation";
import ResetPasswordClient from "./reset-password-client";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const params = await searchParams;

  // If already logged in, redirect to dashboard
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  // Must have token and email
  if (!params.token || !params.email) {
    redirect("/forgot-password");
  }

  return (
    <ResetPasswordClient
      token={params.token}
      email={decodeURIComponent(params.email)}
    />
  );
}
