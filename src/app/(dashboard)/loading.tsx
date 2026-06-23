/**
 * Loading UI for Dashboard layout
 * 
 * This file enables automatic Suspense boundary for all dashboard routes.
 * Next.js will show this component while the page is being loaded (code-split).
 * 
 * ✅ OPTIMIZATION: Route-level code splitting (T03.1)
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar Skeleton */}
      <div className="hidden lg:flex w-64 flex-col border-r border-border/40 p-4">
        <Skeleton className="h-8 w-32 mb-8" />
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>

      {/* Main Content Skeleton */}
      <div className="flex-1 p-4 lg:p-8">
        <Skeleton className="h-12 w-64 mb-6" />
        <div className="grid gap-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    </div>
  );
}
