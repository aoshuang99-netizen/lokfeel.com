"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState } from "react";
import {
  ArrowRight,
  MessageSquare,
  Users,
  Building2,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { Skeleton, InlineError } from "@/components/ui";
import { useProfileContext } from "../dashboard-ui";
import { useApiGet } from "@/hooks/use-api";

// ══════════════════════════════════════════════════════════════════
// 个人首页 · UI-REMEDIATION 2026-11-21（P0）
//
// 旧版是 B2C 约会叙事：Today's Picks 滑动卡 + matchScore 百分比 +
// auto-match 后台任务 + 静态 AnalyticsReport 看板。用户点名指出：
// 这与"面向真人沟通、个人 AI 与企业协作"的产品定位完全不符。
//
// 新版以用户真正要做的四件事为中心——
//   Chats（真实会话/未读）、People（真实连接）、Spaces（真实组织）、My AI（诚实态）——
// 每个入口都指向真实页面，每个数字都来自真实 API，没有虚构计数或静态图表。
// 保留 loading / empty / error 三种诚实状态。
// ══════════════════════════════════════════════════════════════════

interface ConversationItem {
  id: string;
  conversationId?: string;
  otherUser: { id: string; name: string; avatar?: string | null; isOnline?: boolean };
  lastMessage: { content: string; timestamp: string; isFromMe: boolean } | null;
  unreadCount: number;
}
interface ConversationsPayload {
  conversations?: ConversationItem[];
  count?: number;
}
interface UnreadPayload { unreadCount?: number; totalChats?: number }
interface OrgsPayload { organizations?: Array<{ id: string; name: string }> }

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const { profile, user: contextUser, loading: profileLoading } = useProfileContext();
  const user = contextUser || session?.user;
  const firstName = (user?.name || profile?.displayName || "there").split(" ")[0];

  const chats = useApiGet<ConversationsPayload>("/api/im/conversations");
  const unread = useApiGet<UnreadPayload>("/api/chats/unread-count");
  const orgs = useApiGet<OrgsPayload>("/api/v1/organizations");

  const conversationCount = chats.data?.count ?? unread.data?.totalChats ?? 0;
  const unreadCount = unread.data?.unreadCount ?? 0;
  const orgCount = orgs.data?.organizations?.length ?? 0;
  const recent = (chats.data?.conversations || []).slice(0, 4);

  const onboardingStep = profile?.onboardingStep || 0;
  const isOnboardingComplete = onboardingStep >= 6;
  const profileMissing = !profile?.avatar || !profile?.displayName || !profile?.age || !profile?.gender || !profile?.city;
  const needsProfile = isOnboardingComplete ? profileMissing : !isOnboardingComplete;

  const entryCards = [
    {
      key: "chats",
      label: "Chats",
      description: "你的真实对话",
      href: "/dashboard/chats",
      icon: MessageSquare,
      value: conversationCount,
      valueLabel: "段对话",
      badge: unreadCount > 0 ? `${unreadCount} 未读` : null,
      tone: "from-cta/25 to-cta/5 text-cta",
    },
    {
      key: "people",
      label: "People",
      description: "你认识与被认识的人",
      href: "/dashboard/connections",
      icon: Users,
      value: null,
      valueLabel: "查看连接与邀请",
      badge: null,
      tone: "from-primary/25 to-primary/5 text-primary",
    },
    {
      key: "spaces",
      label: "Spaces",
      description: "你参与的社群与协作空间",
      href: "/console",
      icon: Building2,
      value: orgCount,
      valueLabel: orgCount === 1 ? "个社群" : "个社群",
      badge: null,
      tone: "from-secondary/25 to-secondary/5 text-secondary",
    },
  ] as const;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8 relative min-h-screen">
      <section className="animate-fadeIn">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground mb-1 font-display" data-testid="dashboard-h1">
          {greeting()}, <span className="text-primary-hover">{firstName}</span>
        </h1>
        <p className="text-foreground-muted text-xs sm:text-sm">
          从一段真实的对话开始。这里只有你和你的连接、对话与协作。
        </p>
      </section>

      {profileLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : !profile && !profileLoading ? (
        <InlineError error="Failed to load profile" onRetry={() => window.location.reload()} />
      ) : (
        <>
          {/* ── 三个真实入口 + 一个诚实态 ── */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-label="你的核心入口">
            {entryCards.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.key}
                  href={card.href}
                  className="group rounded-2xl border border-card-border bg-background-secondary p-5 min-h-[150px] flex flex-col hover:border-primary/40 hover:bg-background-tertiary/60 transition-colors"
                >
                  <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${card.tone} flex items-center justify-center mb-3`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-foreground font-display">{card.label}</h2>
                    {card.badge ? (
                      <span className="ml-auto px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-medium">{card.badge}</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-foreground-muted mt-1 flex-1">{card.description}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">
                      {card.value !== null ? card.value : <span className="text-xs font-normal text-foreground-muted">{card.valueLabel}</span>}
                      {card.value !== null && <span className="ml-1 text-xs font-normal text-foreground-muted">{card.valueLabel}</span>}
                    </span>
                    <ArrowRight className="w-4 h-4 text-foreground-subtle group-hover:text-primary transition-colors" />
                  </div>
                </Link>
              );
            })}

            {/* My AI：真实模型未验收 → 诚实态，不做成可点击的假按钮 */}
            <div
              className="rounded-2xl border border-dashed border-card-border bg-background-secondary/50 p-5 min-h-[150px] flex flex-col"
              data-testid="my-ai-honest-state"
            >
              <div className="w-11 h-11 rounded-xl bg-background-tertiary flex items-center justify-center mb-3">
                <Sparkles className="w-5 h-5 text-foreground-subtle" />
              </div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground-muted font-display">My AI</h2>
                <span className="ml-auto px-2 py-0.5 rounded-full bg-background-tertiary text-foreground-subtle text-[10px]">Private testing</span>
              </div>
              <p className="text-xs text-foreground-subtle mt-1 flex-1">
                真实模型写作辅助尚在私人测试，目前不可用。你仍可与真人正常沟通。
              </p>
              <p className="mt-3 text-[10px] text-foreground-faint">不可用 · 不是 stub</p>
            </div>
          </section>

          {/* ── 最近对话（真实数据） ── */}
          <section className="space-y-3" aria-label="最近对话">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground font-display">最近对话</h2>
              <button
                type="button"
                onClick={() => { chats.refetch(); unread.refetch(); }}
                className="inline-flex min-h-9 items-center gap-1.5 px-2 text-xs text-foreground-muted hover:text-foreground"
                aria-label="刷新对话"
              >
                <RefreshCw className="w-3.5 h-3.5" /> 刷新
              </button>
            </div>

            {chats.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => <SkeletonCard key={i} compact />)}
              </div>
            ) : chats.error ? (
              <InlineError error={chats.error} onRetry={() => chats.refetch()} />
            ) : recent.length === 0 ? (
              <div className="rounded-2xl border border-card-border bg-background-secondary p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <MessageSquare className="w-6 h-6 text-primary/60" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">还没有对话</p>
                <p className="text-xs text-foreground-muted mb-4">邀请一个你认识的人，开始一段真实对话。</p>
                <Link href="/dashboard/chats" className="btn-primary text-sm inline-flex min-h-[44px] items-center gap-2">
                  去 Chats <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            ) : (
              <ul className="space-y-2">
                {recent.map((c) => {
                  const roomId = c.conversationId || c.id;
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/dashboard/chats/${roomId}`}
                        className="flex items-center gap-3 rounded-xl border border-card-border bg-background-secondary p-3 hover:border-primary/30 transition-colors"
                      >
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/30 to-secondary/30 flex items-center justify-center shrink-0 text-sm font-semibold text-foreground">
                          {(c.otherUser?.name || "?").slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{c.otherUser?.name || "对话"}</p>
                          <p className="text-xs text-foreground-muted truncate">
                            {c.lastMessage ? `${c.lastMessage.isFromMe ? "你: " : ""}${c.lastMessage.content}` : "还没有消息，打个招呼吧"}
                          </p>
                        </div>
                        {c.unreadCount > 0 ? (
                          <span className="shrink-0 px-2 py-0.5 rounded-full bg-primary text-background text-[10px] font-bold">{c.unreadCount}</span>
                        ) : null}
                        <ArrowRight className="w-4 h-4 text-foreground-subtle shrink-0" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── 资料未完成：真实引导 ── */}
          {needsProfile && (
            <div className="rounded-2xl border border-primary/30 bg-background-secondary p-4 sm:p-6">
              <div className="flex flex-col md:flex-row items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shrink-0">
                  <Sparkles className="w-6 h-6 text-background" />
                </div>
                <div className="flex-1 text-center md:text-left">
                  <h3 className="font-semibold text-foreground">完善你的资料</h3>
                  <p className="text-sm text-foreground-muted mt-0.5">让别人认识你，也让对话更自然。</p>
                </div>
                <Link
                  href={isOnboardingComplete ? "/dashboard/profile" : "/dashboard/onboarding"}
                  className="btn-primary whitespace-nowrap min-h-[44px] inline-flex items-center"
                >
                  {isOnboardingComplete ? "完善资料" : "开始引导"}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SkeletonCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-card-border bg-background-secondary ${compact ? "h-16" : "min-h-[150px]"} animate-pulse p-5`}>
      <div className="w-10 h-10 rounded-xl bg-foreground-faint mb-3" />
      <div className="h-4 w-20 bg-foreground-faint rounded mb-2" />
      <div className="h-3 w-32 bg-foreground-faint rounded" />
    </div>
  );
}
