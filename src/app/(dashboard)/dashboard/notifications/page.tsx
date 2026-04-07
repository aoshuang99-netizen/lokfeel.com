"use client";

import { useState } from "react";
import Link from "next/link";
import { Heart, MessageCircle, Sparkles, Users, Bell, Check, CheckCheck } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

const mockNotifications = [
  { id: 1, type: "match", title: "New Match!", description: "Sarah liked your profile. You have 94% compatibility.", timestamp: "2 minutes ago", read: false, link: "/dashboard/matches/1" },
  { id: 2, type: "message", title: "New Message", description: "Michael sent you a message: 'Hey! I saw we matched...'", timestamp: "15 minutes ago", read: false, link: "/dashboard/chat/2" },
  { id: 3, type: "premium", title: "Unlock Premium", description: "See who liked you before matching. Upgrade now!", timestamp: "1 hour ago", read: false, link: "/dashboard/subscription" },
  { id: 4, type: "match", title: "New Match!", description: "Emma liked your profile. You have 89% compatibility.", timestamp: "3 hours ago", read: true, link: "/dashboard/matches/3" },
  { id: 5, type: "profile", title: "Complete Your Profile", description: "Adding your relationship goals increases matches by 40%.", timestamp: "1 day ago", read: true, link: "/dashboard/profile" },
  { id: 6, type: "system", title: "Welcome to Nexus!", description: "Thanks for joining. Start by completing your relationship blueprint.", timestamp: "2 days ago", read: true, link: "/dashboard/profile" },
];

const iconMap = {
  match: Heart,
  message: MessageCircle,
  premium: Sparkles,
  profile: Users,
  system: Bell,
};

const colorMap = {
  match: "text-primary bg-primary/20",
  message: "text-secondary bg-secondary/20",
  premium: "text-warning bg-warning/20",
  profile: "text-success bg-success/20",
  system: "text-info bg-info/20",
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState(mockNotifications);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const filteredNotifications = filter === "unread"
    ? notifications.filter((n) => !n.read)
    : notifications;

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkAsRead = (id: number) => {
    setNotifications((prev) =>
      prev.map((n) => n.id === id ? { ...n, read: true } : n)
    );
  };

  const handleMarkAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <p className="text-white/60">
            {unreadCount > 0 ? `${unreadCount} unread notifications` : "All caught up!"}
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
              ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-white border border-primary/30"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            filter === "unread"
              ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-white border border-primary/30"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
        >
          Unread
          {unreadCount > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-primary text-white">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Notifications List */}
      {filteredNotifications.length > 0 ? (
        <div className="space-y-2">
          {filteredNotifications.map((notification) => {
            const Icon = iconMap[notification.type as keyof typeof iconMap];
            const colorClass = colorMap[notification.type as keyof typeof colorMap];

            return (
              <Link
                key={notification.id}
                href={notification.link}
                className={`glass-card p-4 flex items-start gap-4 hover:bg-white/10 transition-all ${
                  !notification.read ? "border-primary/30" : ""
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
                      <h3 className={`font-medium ${!notification.read ? "text-white" : "text-white/80"}`}>
                        {notification.title}
                      </h3>
                      <p className="text-sm text-white/60 mt-0.5">{notification.description}</p>
                    </div>
                    {!notification.read && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          handleMarkAsRead(notification.id);
                        }}
                        className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/40 hover:text-white"
                        title="Mark as read"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-white/40 mt-2">{notification.timestamp}</p>
                </div>

                {/* Unread Dot */}
                {!notification.read && (
                  <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
                )}
              </Link>
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
