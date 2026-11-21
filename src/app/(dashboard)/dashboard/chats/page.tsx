"use client";

import Link from "next/link";
import { MessageCircle, UserPlus } from "lucide-react";

// ══════════════════════════════════════
// CHATS LANDING (no room selected)
// V25.6-GA WEB-02/USER-02: 移除旧品牌 "LokFee! Messages" 与
// "Find Matches / Browse" 的 B2C 约会导流。空状态给真实、可执行的下一步：
// 打开一段真实对话，或从你认识的人开始 —— 不虚构联系人、不制造匹配数。
// ══════════════════════════════════════

export default function ChatPage() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center px-6">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6">
          <MessageCircle className="w-10 h-10 text-primary/60" />
        </div>
        <h3 className="text-xl font-semibold text-foreground mb-2">
          No conversations yet
        </h3>
        <p className="text-foreground-muted text-sm mb-6 max-w-xs mx-auto">
          Invite someone you know to start a real conversation, or pick a recent chat from the list.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/dashboard/connections"
            className="btn-primary text-sm"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Invite someone you know
          </Link>
        </div>
        <p className="mt-5 text-xs text-foreground-subtle">
          AI writing help is in private testing. You can message real people today, without setup.
        </p>
      </div>
    </div>
  );
}
