"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Heart, MessageCircle, Sparkles, Users, Bell, Check, CheckCheck, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { useApiGet } from "@/hooks/use-api";

interface NotificationData {
  notifications: Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    actionUrl: string | null;
    isRead: boolean;
    createdAt: string;
  }>;
  unreadCount: number;
}

const iconMap: Record<string, any> = {
  NEW_MATCH: Heart,
  MATCH_ACCEPTED: Heart,
  MATCH_REJECTED: Heart,
  NEW_MESSAGE: MessageCircle,
  SUBSCRIPTION_EXPIRED: Sparkles,
  PROFILE_APPROVED: Users,
  PROFILE_REJECTED: Users,
  SYSTEM_ANNOUNCEMENT: Bell,
  WEEKLY_DIGEST: Bell,
};

const colorMap: Record<string, string> = {
  NEW_MATCH: "text-primary bg-primary/20",
  MATCH_ACCEPTED: "text-primary bg-primary/20",
  MATCH_REJECTED: "text-foreground-subtle bg-background-tertiary",
  NEW_MESSAGE: "text-secondary bg-secondary/20",
  SUBSCRIPTION_EXPIRED: "text-warning bg-warning/20",
  PROFILE_APPROVED: "text-success bg-success/20",
  PROFILE_REJECTED: "text-error bg-error/20",
  SYSTEM_ANNOUNCEMENT: "text-info bg-info/20",
  WEEKLY_DIGEST: "text-info bg-info/20",
};

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return date.toLocaleDateString();
}

export default function NotificationsPage() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const { data, isLoading, error, refetch } = useApiGet<NotificationData>(
    `/api/notifications?filter=${filter}&limit=50`
  );

  const notifications = data?.notifications || [];
  const unreadCount = data?.unreadCount || 0;

  const handleMarkAsRead = async (ids: string[]) => {
    await fetch("/api/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    refetch();
  };

  const handleMarkAllAsRead = async () => {
    await fetch("/api/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true }),
    });
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <span className="ml-3 text-foreground-muted">Loading notifications...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          <p className="text-foreground-muted">Stay updated on your matches</p>
        </div>
        <div className="glass-card p-12 text-center">
          <Bell className="w-8 h-8 text-foreground-subtle mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Service Unavailable</h3>
          <p className="text-foreground-muted">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          <p className="text-foreground-muted">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}` : "All caught up!"}
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllAsRead}
            className="btn-secondary flex items-center gap-2"
          >
            <CheckCheck className="w-4 h-4" />
            Mark all as read
          </button>
        )}
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            filter === "all"
              ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-foreground border border-primary/30"
              : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary"
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            filter === "unread"
              ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-foreground border border-primary/30"
              : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary"
          }`}
        >
          Unread
          {unreadCount > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-primary text-foreground">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Notifications List */}
      {notifications.length > 0 ? (
        <div className="space-y-2">
          {notifications.map((notification) => {
            const Icon = iconMap[notification.type] || Bell;
            const colorClass = colorMap[notification.type] || "text-foreground bg-background-tertiary";

            const content = (
              <div
                className={`glass-card p-4 flex items-start gap-4 hover:bg-background-tertiary transition-all ${
                  !notification.isRead ? "border-primary/30" : ""
                }`}
              >
                {/* Icon */}
                <div className={`w-10 h-10 rounded-full ${colorClass} flex items-center justify-center flex-shrink-0`}>
                  <Icon className="w-5 h-5" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className={`font-medium ${!notification.isRead ? "text-foreground" : "text-foreground"}`}>
                        {notification.title}
                      </h3>
                      <p className="text-sm text-foreground-muted mt-0.5">{notification.body}</p>
                    </div>
                    {!notification.isRead && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleMarkAsRead([notification.id]);
                        }}
                        className="p-1.5 rounded-lg hover:bg-background-tertiary transition-colors text-foreground-subtle hover:text-foreground flex-shrink-0"
                        title="Mark as read"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-foreground-subtle mt-2">{formatTimestamp(notification.createdAt)}</p>
                </div>

                {/* Unread Dot */}
                {!notification.isRead && (
                  <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
                )}
              </div>
            );

            return notification.actionUrl ? (
              <Link key={notification.id} href={notification.actionUrl}>
                {content}
              </Link>
            ) : (
              <div key={notification.id}>{content}</div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon="bell"
          title={filter === "unread" ? "No unread notifications" : "No notifications yet"}
          description={
            filter === "unread"
              ? "You've read all your notifications"
              : "We'll notify you when something important happens"
          }
        />
      )}
    </div>
  );
}
