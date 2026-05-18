"use client";

import dynamic from "next/dynamic";

// Lazy-load the heavy chat room page to reduce initial bundle size (~45KB)
const ChatRoomContent = dynamic(
  () => import("./page-content").then((mod) => ({ default: mod.default })),
  {
    loading: () => (
      <div className="flex-1 flex flex-col h-full animate-pulse">
        {/* Chat header skeleton */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-card-border">
          <div className="w-10 h-10 rounded-full bg-foreground-faint" />
          <div className="flex-1 space-y-1.5">
            <div className="h-4 bg-foreground-faint rounded w-24" />
            <div className="h-3 bg-foreground-faint rounded w-16" />
          </div>
        </div>
        {/* Messages skeleton */}
        <div className="flex-1 p-4 space-y-4 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`rounded-2xl px-4 py-3 ${
                  i % 2 === 0
                    ? "bg-foreground-faint/30 rounded-tl-sm"
                    : "bg-primary/10 rounded-tr-sm"
                }`}
                style={{ width: `${Math.random() * 40 + 30}%` }}
              >
                <div className="h-3 bg-foreground-faint rounded" />
              </div>
            </div>
          ))}
        </div>
        {/* Input skeleton */}
        <div className="p-4 border-t border-card-border">
          <div className="h-12 bg-foreground-faint rounded-full" />
        </div>
      </div>
    ),
    ssr: false,
  }
);

export default function ChatRoomPageWrapper() {
  return <ChatRoomContent />;
}
