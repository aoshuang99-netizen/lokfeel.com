"use client";

import dynamic from "next/dynamic";

// Lazy-load the heavy profile page to reduce initial bundle size (~42KB)
const ProfileContent = dynamic(
  () => import("./page-content").then((mod) => ({ default: mod.default })),
  {
    loading: () => (
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6 animate-pulse">
        {/* Header */}
        <div className="space-y-2">
          <div className="h-8 bg-foreground-faint rounded w-64" />
          <div className="h-4 bg-foreground-faint rounded w-48" />
        </div>
        {/* Progress steps */}
        <div className="flex justify-between">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="w-8 h-8 rounded-full bg-foreground-faint" />
          ))}
        </div>
        <div className="h-2 bg-foreground-faint rounded-full" />
        {/* Form card */}
        <div className="rounded-2xl bg-foreground-faint/30 p-6 space-y-5">
          <div className="w-24 h-24 rounded-full bg-foreground-faint mx-auto" />
          <div className="space-y-3">
            <div className="h-12 bg-foreground-faint rounded-xl" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-12 bg-foreground-faint rounded-xl" />
              <div className="h-12 bg-foreground-faint rounded-xl" />
            </div>
            <div className="h-28 bg-foreground-faint rounded-xl" />
          </div>
        </div>
      </div>
    ),
    ssr: false,
  }
);

export default function ProfilePageWrapper() {
  return <ProfileContent />;
}
