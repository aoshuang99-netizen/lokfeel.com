"use client";

import dynamic from "next/dynamic";

// Lazy-load the heavy onboarding page to reduce initial bundle size (~66KB)
const OnboardingContent = dynamic(
  () => import("./page-content").then((mod) => ({ default: mod.default })),
  {
    loading: () => (
      <div className="max-w-2xl mx-auto px-4 py-12 space-y-8 animate-pulse">
        {/* Progress bar skeleton */}
        <div className="h-2 bg-foreground-faint rounded-full w-full" />
        {/* Step indicator skeleton */}
        <div className="flex justify-between">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="w-10 h-10 rounded-full bg-foreground-faint" />
          ))}
        </div>
        {/* Content card skeleton */}
        <div className="rounded-2xl bg-foreground-faint/30 p-8 space-y-6">
          <div className="w-32 h-32 rounded-full bg-foreground-faint mx-auto" />
          <div className="h-6 bg-foreground-faint rounded w-3/4 mx-auto" />
          <div className="h-4 bg-foreground-faint rounded w-1/2 mx-auto" />
          <div className="space-y-3">
            <div className="h-12 bg-foreground-faint rounded-xl" />
            <div className="h-12 bg-foreground-faint rounded-xl" />
            <div className="h-12 bg-foreground-faint rounded-xl" />
          </div>
        </div>
      </div>
    ),
    ssr: false,
  }
);

export default function OnboardingPage() {
  return <OnboardingContent />;
}
