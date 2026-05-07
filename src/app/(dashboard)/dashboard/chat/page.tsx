"use client";

import Link from "next/link";
import { MessageCircle, Flame } from "lucide-react";

// ══════════════════════════════════════
// MAIN CHAT PAGE (Fallback when no room selected)
// ══════════════════════════════════════

export default function ChatPage() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center px-6">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
          <MessageCircle className="w-10 h-10 text-primary/60" />
        </div>
        <h3 className="text-xl font-semibold text-foreground mb-2">
          LokFeel Messages
        </h3>
        <p className="text-foreground-muted text-sm mb-6 max-w-xs mx-auto">
          Select a conversation from the list to start chatting, or browse your matches to find new connections.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/dashboard/matches"
            className="btn-primary text-sm"
          >
            <Flame className="w-4 h-4 mr-2" />
            Find Matches
          </Link>
          <Link
            href="/dashboard/discover"
            className="btn-secondary text-sm"
          >
            Browse
          </Link>
        </div>
      </div>
    </div>
  );
}
