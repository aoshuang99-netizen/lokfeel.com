import { z } from "zod";

/**
 * Validate password meets security requirements
 */
export function validatePassword(password: string): { valid: boolean; message?: string } {
  if (!password || password.length < 8) {
    return { valid: false, message: "Password must be at least 8 characters long" };
  }
  
  // Check for uppercase
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one uppercase letter" };
  }
  
  // Check for lowercase
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one lowercase letter" };
  }
  
  // Check for number
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: "Password must contain at least one number" };
  }
  
  return { valid: true };
}

/**
 * Zod schema for password validation
 */
export const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

/**
 * Zod schema for email validation
 */
export const emailSchema = z.string()
  .email("Invalid email address")
  .transform((val) => val.toLowerCase().trim());

/**
 * Zod schema for username validation
 */
export const usernameSchema = z.string()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be at most 30 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores");

/**
 * Zod schema for URL validation
 */
export const urlSchema = z.string()
  .url("Invalid URL")
  .optional();

/**
 * Validate and normalize email
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}
