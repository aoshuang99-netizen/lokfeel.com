"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageCircle, UserPlus, Compass } from "lucide-react";
import { InvitePanel } from "@/components/invite/invite-panel";

// ══════════════════════════════════════════════════
// CHATS LANDING (no room selected)
// V25.6-GA WEB-02/USER-02：移除旧品牌 "LokFee! Messages" 与
// "Find Matches / Browse" 的 B2C 约会导流。空状态给真实、可执行的下一步：
// 打开一段真实对话，或从你认识的人开始 —— 不虚构联系人、不制造匹配数。
//
// UI-REMEDIATION 2026-11-21（P0 · Chats 邀请 CTA 错配修复）：
//   旧实现把 "Invite someone you know" 指向 /dashboard/connections ——
//   那是一个 Likes/Matches/Pending 的约会匹配页，点进去根本没有"邀请"动作，
//   是用户点名指出的"文案改了、真实操作路径没改"的典型空按钮。
//   现在改为打开真实的 InvitePanel（服务端 /api/invites 生成邀请码 + 复制邀请链接），
//   按钮有真实业务结果。仍保留 "No conversations yet" 与
//   a[href="/dashboard/explore"] 两个锚点（CI legacy-mobile.spec.ts 依赖）。
// ══════════════════════════════════════════════════

export default function ChatPage() {
  const [inviteOpen, setInviteOpen] = useState(false);

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
          Start a real conversation. Invite someone you know with your personal
          link, or discover people to talk to.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="btn-primary text-sm min-h-[44px] inline-flex items-center justify-center"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Invite someone you know
          </button>
          <Link
            href="/dashboard/explore"
            className="btn-secondary text-sm min-h-[44px] inline-flex items-center justify-center"
          >
            <Compass className="w-4 h-4 mr-2" />
            Discover people
          </Link>
        </div>
        <p className="mt-5 text-xs text-foreground-subtle">
          AI writing help is in private testing. You can message real people today, without setup.
        </p>
      </div>
      <InvitePanel isOpen={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
