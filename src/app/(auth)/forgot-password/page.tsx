/**
 * Forgot Password PAGE — Server Component
 * Wraps the client-side form with auth layout
 */
import { auth } from "@/lib/auth/auth";
import { redirect } from "next/navigation";
import ForgotPasswordClient from "./forgot-password-client";

export default async function ForgotPasswordPage() {
  // If already logged in, redirect to dashboard
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return <ForgotPasswordClient />;
}
