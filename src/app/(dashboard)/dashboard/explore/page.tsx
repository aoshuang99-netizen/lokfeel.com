"use client";

import dynamic from "next/dynamic";

// Lazy-load the explore/discover page to reduce initial bundle size (~25KB)
const ExploreContent = dynamic(
  () => import("./page-content").then((mod) => ({ default: mod.default })),
  {
    loading: () => (
      <div className="flex flex-col -mx-4 -mt-6 lg:mx-0 lg:mt-0 animate-pulse">
        {/* Header */}
        <header className="px-5 py-4 border-b border-card-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-foreground-faint" />
            <div className="space-y-1">
              <div className="h-4 bg-foreground-faint rounded w-16" />
              <div className="h-3 bg-foreground-faint rounded w-10" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="w-8 h-8 rounded-full bg-foreground-faint" />
            <div className="w-8 h-8 rounded-full bg-foreground-faint" />
          </div>
        </header>
        {/* Progress bar */}
        <div className="h-0.5 bg-foreground-faint" />
        {/* Card stack area */}
        <div className="flex-1 flex flex-col items-center justify-center p-5 min-h-[50vh]">
          <div className="relative w-full max-w-sm aspect-[3/4]">
            <div className="absolute inset-0 rounded-3xl bg-foreground-faint/30" />
          </div>
        </div>
        {/* Action buttons */}
        <div className="flex justify-center gap-8 px-6 pb-8 pt-2">
          <div className="w-14 h-14 rounded-full bg-foreground-faint" />
          <div className="w-10 h-10 rounded-full bg-foreground-faint" />
          <div className="w-14 h-14 rounded-full bg-foreground-faint" />
        </div>
      </div>
    ),
    ssr: false,
  }
);

export default function ExplorePageWrapper() {
  return <ExploreContent />;
}
