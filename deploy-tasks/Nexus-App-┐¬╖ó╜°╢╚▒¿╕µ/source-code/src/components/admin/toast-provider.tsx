"use client";

/**
 * Admin Toast Provider — Sonner integration
 *
 * Wraps shadcn/ui Sonner Toaster with admin-specific defaults.
 * The project has both react-hot-toast and sonner installed;
 * this component provides the migration path to Sonner.
 *
 * Usage: Add <AdminToastProvider /> to admin layout.
 */

import { Toaster } from "sonner";

export function AdminToastProvider() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 4000,
        classNames: {
          toast: "glass-card border",
          title: "text-foreground font-medium",
          description: "text-foreground-muted text-sm",
          actionButton: "bg-primary text-foreground",
          cancelButton: "bg-muted text-foreground",
        },
      }}
      richColors
      closeButton
    />
  );
}
