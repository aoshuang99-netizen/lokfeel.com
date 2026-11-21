"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Heart, Users, Clock, Eye, Loader2, MessageCircle, X, UserPlus, Compass } from "lucide-react";
import { useApiGet, useApiPost } from "@/hooks/use-api";
import { InvitePanel } from "@/components/invite/invite-panel";
import { getAvatarKind, getAvatarBackground, parseEmojiAvatar, isBrokenAvatarUrl, getRealPhotoAvatarUrl } from "@/lib/avatar-utils";

// ══════════════════════════════════════════════════════════════════
// Connections · UI-REMEDIATION 2026-11-21（P0）
//
// 旧版整页就是 Likes You / Matches / Pending 的约会匹配逻辑。用户点名：
//   "从 Likes/Matches 转为有授权的真实关系连接；邀请按钮真正触发邀请流程。"
//
// 新版主区 = 三种真实的人际入口：
//   1) 邀请你认识的人（InvitePanel → 服务端 /api/invites 生成邀请链接）；
//   2) 发现新的连接（/dashboard/explore 真实发现页）；
//   3) 已建立的连接（ACCEPTED matches → 直接进入真实聊天室）。
// 旧的匹配反应（LIKE/PASS）保留为可折叠的次要区，不删除功能、不虚构数据。
//
// 保留 E2E 锚点：h1 "Connections"、空态 "No likes yet/No matches yet/All caught up!"
// （tests/e2e-ci/legacy-mobile.spec.ts 依赖）—— 不通过改断言掩盖产品缺陷。
// ══════════════════════════════════════════════════════════════════

type TabType = "likes" | "matches" | "pending";

interface MatchUser {
  id: string;
  name: string;
  age: number;
  avatar: string | null;
  gender?: string;
  city: string | null;
}
interface MatchData {
  matches: Array<{
    id: string;
    otherUser: MatchUser;
    matchScore: number;
    matchReason: string;
    status: string;
    myReaction: string | null;
    otherReaction: string | null;
    expiresAt: string | null;
    createdAt: string;
  }>;
  pagination: { total: number };
}
interface WhoLikedMeUser {
  id: string;
  matchId: string;
  matchScore: number;
  matchReason: string;
  isSuperLike?: boolean;
  sender: MatchUser;
}

export default function ConnectionsPage() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [showLegacyMatches, setShowLegacyMatches] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("likes");

  const { data: matchesData, isLoading: matchesLoading, refetch: refetchMatches } = useApiGet<MatchData>("/api/matches?limit=50");
  const { data: likesData, isLoading: likesLoading, refetch: refetchLikes } = useApiGet<{ senders: WhoLikedMeUser[] }>("/api/matches/who-liked-me?limit=50");
  const { post, isLoading: isReacting } = useApiPost();

  const matches = matchesData?.matches || [];
  const likes = likesData?.senders || [];
  const accepted = matches.filter((m) => m.status === "ACCEPTED");

  const tabs = useMemo(() => [
    { id: "likes" as TabType, label: "Likes You", icon: Eye, count: likes.length },
    { id: "matches" as TabType, label: "Matches", icon: Heart, count: accepted.length },
    { id: "pending" as TabType, label: "Pending", icon: Clock, count: matches.filter((m) => m.status === "PENDING" && m.myReaction === null).length },
  ], [likes, matches, accepted.length]);

  const handleReact = async (matchId: string, reaction: string) => {
    const result = await post(`/api/matches/${matchId}`, { reaction });
    if (result) { refetchMatches(); refetchLikes(); }
  };

  const isLoading = matchesLoading || likesLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground font-display">Connections</h1>
        <p className="text-sm text-foreground-muted">真实的人际关系：邀请你认识的人、发现新连接、继续已有的对话。</p>
      </div>

      {/* ── 主区：三种真实入口 ── */}
      <section aria-label="建立真实连接" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="rounded-2xl border border-card-border bg-background-secondary p-5 min-h-[160px] text-left hover:border-primary/40 transition-colors"
          data-testid="invite-cta"
        >
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/25 to-primary/5 flex items-center justify-center mb-3">
            <UserPlus className="w-5 h-5 text-primary" />
          </div>
          <h2 className="text-base font-semibold text-foreground font-display">邀请你认识的人</h2>
          <p className="text-xs text-foreground-muted mt-1">生成你的专属邀请链接，发给真实的朋友。</p>
          <p className="mt-3 text-xs font-medium text-primary inline-flex items-center gap-1">生成邀请链接 →</p>
        </button>

        <Link
          href="/dashboard/explore"
          className="rounded-2xl border border-card-border bg-background-secondary p-5 min-h-[160px] hover:border-primary/40 transition-colors"
        >
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cta/25 to-cta/5 flex items-center justify-center mb-3">
            <Compass className="w-5 h-5 text-cta" />
          </div>
          <h2 className="text-base font-semibold text-foreground font-display">发现新的人</h2>
          <p className="text-xs text-foreground-muted mt-1">按你的偏好认识新朋友，从一段对话开始。</p>
          <p className="mt-3 text-xs font-medium text-cta inline-flex items-center gap-1">去发现 →</p>
        </Link>

        <Link
          href="/dashboard/chats"
          className="rounded-2xl border border-card-border bg-background-secondary p-5 min-h-[160px] hover:border-primary/40 transition-colors"
        >
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-secondary/25 to-secondary/5 flex items-center justify-center mb-3">
            <MessageCircle className="w-5 h-5 text-secondary" />
          </div>
          <h2 className="text-base font-semibold text-foreground font-display">继续对话</h2>
          <p className="text-xs text-foreground-muted mt-1">回到你已建立的连接，接着聊。</p>
          <p className="mt-3 text-xs font-medium text-secondary inline-flex items-center gap-1">打开 Chats →</p>
        </Link>
      </section>

      {/* ── 已建立的连接 ── */}
      {accepted.length > 0 && (
        <section aria-label="已建立的连接" className="space-y-3">
          <h2 className="text-base font-semibold text-foreground font-display">已建立的连接</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {accepted.map((m) => (
              <ConnectionCard
                key={m.id}
                user={m.otherUser}
                matchScore={m.matchScore}
                matchReason={m.matchReason}
                matchId={m.id}
                onReact={handleReact}
                isReacting={isReacting}
                showActions={false}
                chatHref={`/dashboard/chats/${m.id}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── 旧的匹配反应区（次要、可折叠；保留真实功能与 E2E 锚点） ── */}
      <section className="rounded-2xl border border-card-border bg-background-secondary/50">
        <button
          type="button"
          onClick={() => setShowLegacyMatches((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 min-h-[44px] text-left"
          aria-expanded={showLegacyMatches}
        >
          <span className="text-sm font-medium text-foreground-muted">
            匹配与邀请（早期功能） · {tabs.reduce((s, t) => s + t.count, 0)} 条
          </span>
          <span className="text-xs text-foreground-subtle">{showLegacyMatches ? "收起 ▲" : "展开 ▼"}</span>
        </button>

        {showLegacyMatches && (
          <div className="px-4 pb-5 space-y-4 border-t border-card-border pt-4">
            <div className="flex gap-2 p-1 bg-background-tertiary rounded-xl">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg min-h-[44px] text-sm font-medium transition-all ${
                      active ? "bg-primary/15 text-primary" : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                    {tab.count > 0 && (
                      <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${active ? "bg-primary text-background" : "bg-background-secondary text-foreground-muted"}`}>
                        {tab.count > 99 ? "99+" : tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <span className="ml-3 text-foreground-muted">Loading connections...</span>
              </div>
            ) : (
              <>
                {activeTab === "likes" && (likes.length === 0 ? (
                  <EmptyState icon={Eye} title="No likes yet" description="Keep exploring! When someone likes you, they'll appear here." />
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {likes.map((like) => (
                      <ConnectionCard key={like.id} user={like.sender} matchScore={like.matchScore} matchReason={like.matchReason} matchId={like.matchId} onReact={handleReact} isReacting={isReacting} showActions isSuperLike={like.isSuperLike} />
                    ))}
                  </div>
                ))}
                {activeTab === "matches" && (accepted.length === 0 ? (
                  <EmptyState icon={Heart} title="No matches yet" description="Accept connections to start chatting with your matches." />
                ) : null)}
                {activeTab === "pending" && (matches.filter((m) => m.status === "PENDING" && m.myReaction === null).length === 0 ? (
                  <EmptyState icon={Clock} title="All caught up!" description="No pending connections to review. Check back later." />
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {matches.filter((m) => m.status === "PENDING" && m.myReaction === null).map((m) => (
                      <ConnectionCard key={m.id} user={m.otherUser} matchScore={m.matchScore} matchReason={m.matchReason} matchId={m.id} onReact={handleReact} isReacting={isReacting} showActions expiresAt={m.expiresAt} />
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </section>

      <InvitePanel isOpen={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}

function ConnectionCard({ user, matchScore, matchReason, matchId, onReact, isReacting, showActions, chatHref, expiresAt, isSuperLike }: {
  user: MatchUser; matchScore: number; matchReason: string; matchId: string;
  onReact: (id: string, reaction: string) => void; isReacting: boolean; showActions: boolean;
  chatHref?: string; expiresAt?: string | null; isSuperLike?: boolean;
}) {
  return (
    <div className="glass-card p-3 rounded-xl border border-card-border hover:border-primary/30 transition-all group">
      <div className="relative mb-3">
        <div className={`w-full aspect-square rounded-lg overflow-hidden ${getAvatarBackground(getAvatarKind(user.avatar), user.avatar)}`}>
          {(() => {
            const kind = getAvatarKind(user.avatar);
            if (kind === "emoji") {
              const parsed = parseEmojiAvatar(user.avatar);
              return <div className="w-full h-full flex items-center justify-center" style={{ background: getAvatarBackground(kind, user.avatar) }}><span className="text-4xl">{parsed?.emoji}</span></div>;
            }
            const photoUrl = (kind === "photo" && user.avatar && !isBrokenAvatarUrl(user.avatar)) ? user.avatar : getRealPhotoAvatarUrl(user.id || user.name, user.gender, "preview", user.age);
            return <img src={photoUrl} alt={user.name} className="w-full h-full object-cover object-top" loading="lazy" decoding="async" crossOrigin="anonymous" onError={(e) => {
              const img = e.currentTarget;
              const fallback = getRealPhotoAvatarUrl(user.id || user.name, user.gender, "preview", user.age);
              if (img.src !== fallback) img.src = fallback; else img.style.display = "none";
            }} />;
          })()}
        </div>
        <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold border bg-amber-500/20 text-amber-400 border-amber-500/30">{matchScore}%</div>
        {isSuperLike && <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-yellow-400/20 text-yellow-300 border border-yellow-400/30">⭐ Super Like</div>}
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground truncate">{user.name}{user.age ? `, ${user.age}` : ""}</h3>
        {user.city && <p className="text-xs text-foreground-muted truncate">{user.city}</p>}
        {matchReason && <p className="text-[10px] text-foreground-subtle line-clamp-1">{matchReason}</p>}
      </div>
      {showActions ? (
        <div className="flex gap-2 mt-3">
          <button type="button" onClick={() => onReact(matchId, "PASS")} disabled={isReacting} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg min-h-[44px] text-xs font-medium bg-background-tertiary text-foreground-muted hover:bg-red-500/20 hover:text-red-400 transition-all disabled:opacity-50"><X className="w-3 h-3" /></button>
          <button type="button" onClick={() => onReact(matchId, "LIKE")} disabled={isReacting} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg min-h-[44px] text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 transition-all disabled:opacity-50"><Heart className="w-3 h-3" /></button>
        </div>
      ) : chatHref ? (
        <Link href={chatHref} className="flex items-center justify-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg min-h-[44px] text-xs font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-all"><MessageCircle className="w-3 h-3" /><span>Chat</span></Link>
      ) : null}
      {expiresAt && <p className="text-[9px] text-foreground-subtle mt-2 text-center">Expires {new Date(expiresAt).toLocaleDateString()}</p>}
    </div>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: typeof Eye; title: string; description: string }) {
  return (
    <div className="glass-card p-12 text-center border border-card-border">
      <div className="w-16 h-16 rounded-2xl bg-background-tertiary flex items-center justify-center mx-auto mb-4"><Icon className="w-8 h-8 text-foreground-subtle" /></div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-foreground-muted max-w-xs mx-auto">{description}</p>
    </div>
  );
}
