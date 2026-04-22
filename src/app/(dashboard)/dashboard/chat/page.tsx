"use client";

import { useState } from "react";
import { useIMConversations, useIMMessages } from "@/hooks/useIM";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Send,
  MessageCircle,
  ChevronLeft,
  Lock,
  Flame,
  Clock,
  Bot,
  User,
  Sparkles,
  Phone,
  Video,
  MoreVertical,
  ArrowLeft,
  ShieldAlert,
  Ban,
  Image as ImageIcon,
  Mic,
  Smile,
  Zap,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

// Design tokens
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

// ══════════════════════════════════════
// MAIN CHAT PAGE (Fallback when no room selected)
// ══════════════════════════════════════

export default function ChatPage() {
  return (
    <div className="flex-1 flex items-center justify-center bg-[#0d0c11]">
      <div className="text-center px-6">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
          <MessageCircle className="w-10 h-10 text-primary/60" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">
          LokFeel Messages
        </h3>
        <p className="text-white/50 text-sm mb-6 max-w-xs mx-auto">
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
