"use server";

/**
 * LOGIN SERVER ACTION
 * 
 * Runs entirely on the server. Bypasses all client-side issues.
 * Uses NextAuth's internal mechanisms directly.
 * 
 * This is called from the client login form via 'use server' directive.
 */
import { auth } from "@/lib/auth/auth";
import { db } from "@/lib/db";
import { compare } from "bcryptjs";
import { redirect } from "next/navigation";

interface LoginResult {
  success: boolean;
  error?: string;
  redirectUrl?: string;
}

export async function serverLogin(formData: FormData): Promise<LoginResult> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const callbackUrl = (formData.get("callbackUrl") as string) || "/dashboard";

  // Validate input
  if (!email || !password) {
    return { success: false, error: "Email and password are required" };
  }

  try {
    // Find user in database
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { profile: true },
    });

    if (!user || !user.password) {
      return { success: false, error: "Invalid email or password" };
    }

    // Verify password with bcrypt
    const isValid = await compare(password, user.password);
    
    if (!isValid) {
      return { success: false, error: "Invalid email or password" };
    }

    /**
     * Create NextAuth session using the auth() function
     * We call signIn from the server side which properly sets up the session
     */
    const { signIn } = await import("@/lib/auth/auth");
    
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    return {
      success: true,
      redirectUrl: callbackUrl,
    };

  } catch (error) {
    console.error("[serverLogin] Error:", error);
    return {
      success: false,
      error: "Login failed. Please try again.",
    };
  }
}
