"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { toast } from "sonner";
import {
  Heart,
  User,
  Clock,
  Check,
  X,
  MessageCircle,
  Sparkles,
  Filter,
  ChevronRight,
  Eye,
  Zap,
} from "lucide-react";
import { Skeleton, EmptyState } from "@/components/ui";

// 活动类型
interface Activity {
  id: string;
  type: "like_received" | "match" | "view" | "message" | "request";
  user: {
    id: string;
    name: string;
    age: number;
    avatar: string | null;
  };
  timestamp: string;
  read: boolean;
  // 对于女性用户收到的请求
  requestStatus?: "pending" | "accepted" | "declined";
  // 匹配分数
  matchScore?: number;
}

// 筛选类型
type FilterType = "all" | "likes" | "matches" | "requests";

export default function ActivityPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [userGender, setUserGender] = useState<"male" | "female" | null>(null);

  // 加载活动和用户性别
  useEffect(() => {
    fetchActivities();
    fetchUserProfile();
  }, []);

  const fetchUserProfile = async () => {
    try {
      const res = await fetch("/api/profile");
      if (res.ok) {
        const data = await res.json();
        const gender = data.profile?.gender?.toLowerCase();
        setUserGender(gender === "male" || gender === "man" ? "male" : "female");
      }
    } catch (e) {
      console.error("Failed to fetch profile:", e);
    }
  };

  const fetchActivities = async () => {
    try {
      const res = await fetch("/api/activity");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setActivities(data.activities || []);
    } catch (e) {
      toast.error("Failed to load activity");
    } finally {
      setLoading(false);
    }
  };

  // 处理请求（女性用户）
  const handleRequest = async (activityId: string, action: "accept" | "decline") => {
    try {
      await fetch(`/api/requests/${activityId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      setActivities((prev) =>
        prev.map((a) =>
          a.id === activityId
            ? { ...a, requestStatus: action === "accept" ? "accepted" : "declined" }
            : a
        )
      );

      toast.success(action === "accept" ? "Request accepted!" : "Request declined");
    } catch (e) {
      toast.error("Failed to process request");
    }
  };

  // 筛选活动
  const filteredActivities = activities.filter((a) => {
    if (filter === "all") return true;
    if (filter === "likes") return a.type === "like_received" || a.type === "request";
    if (filter === "matches") return a.type === "match";
    if (filter === "requests") return a.type === "request";
    return true;
  });

  // 格式化时间
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  // 获取活动图标
  const getActivityIcon = (type: Activity["type"]) => {
    switch (type) {
      case "like_received":
      case "request":
        return <Heart className="w-4 h-4 text-primary" fill="currentColor" />;
      case "match":
        return <Sparkles className="w-4 h-4 text-secondary" />;
      case "view":
        return <Eye className="w-4 h-4 text-white/40" />;
      case "message":
        return <MessageCircle className="w-4 h-4 text-primary" />;
      default:
        return null;
    }
  };

  // 获取活动文本
  const getActivityText = (activity: Activity) => {
    switch (activity.type) {
      case "like_received":
        return "liked your profile";
      case "request":
        return "sent you a connection request";
      case "match":
        return "is now your match";
      case "view":
        return "viewed your profile";
      case "message":
        return "sent you a message";
      default:
        return "";
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {userGender === "female" ? "Connection Requests" : "Your Activity"}
          </h1>
          <p className="text-white/50 text-sm mt-1">
            {userGender === "female"
              ? "Review and respond to connection requests"
              : "Track your likes, matches, and views"}
          </p>
        </div>
        
        {/* 筛选器 */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-white/40" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterType)}
            className="bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
          >
            <option value="all">All Activity</option>
            <option value="likes">Likes</option>
            <option value="matches">Matches</option>
            {userGender === "female" && <option value="requests">Requests</option>}
          </select>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-white">
            {activities.filter((a) => a.type === "like_received" || a.type === "request").length}
          </p>
          <p className="text-xs text-white/50">New Likes</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-white">
            {activities.filter((a) => a.type === "match").length}
          </p>
          <p className="text-xs text-white/50">Matches</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-white">
            {activities.filter((a) => !a.read).length}
          </p>
          <p className="text-xs text-white/50">Unread</p>
        </div>
      </div>

      {/* 活动列表 */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : filteredActivities.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="No activity yet"
          description="Start exploring to see likes, matches, and more here."
          action={
            <Link href="/dashboard/discover" className="btn-primary">
              <Sparkles className="w-4 h-4 mr-2" />
              Discover People
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {filteredActivities.map((activity, index) => (
              <motion.div
                key={activity.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                transition={{ delay: index * 0.05 }}
                className={`glass-card p-4 ${!activity.read ? "border-primary/30 bg-primary/5" : ""}`}
              >
                <div className="flex items-center gap-4">
                  {/* 头像 */}
                  <div className="relative">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center overflow-hidden">
                      {activity.user.avatar ? (
                        <img
                          src={activity.user.avatar}
                          alt={activity.user.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="w-7 h-7 text-white/30" />
                      )}
                    </div>
                    {/* 活动类型图标 */}
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-surface border border-white/10 flex items-center justify-center">
                      {getActivityIcon(activity.type)}
                    </div>
                  </div>

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white truncate">
                        {activity.user.name}, {activity.user.age}
                      </h3>
                      {activity.matchScore && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                          {activity.matchScore}% match
                        </span>
                      )}
                      {!activity.read && (
                        <span className="w-2 h-2 rounded-full bg-primary" />
                      )}
                    </div>
                    <p className="text-sm text-white/60">{getActivityText(activity)}</p>
                    <p className="text-xs text-white/40 mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(activity.timestamp)}
                    </p>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-2">
                    {activity.type === "request" && activity.requestStatus === "pending" && userGender === "female" ? (
                      // 女性用户的请求操作按钮
                      <>
                        <button
                          onClick={() => handleRequest(activity.id, "decline")}
                          className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleRequest(activity.id, "accept")}
                          className="p-2.5 rounded-full bg-gradient-to-r from-primary to-secondary text-white hover:opacity-90 transition-opacity"
                        >
                          <Check className="w-5 h-5" />
                        </button>
                      </>
                    ) : activity.type === "match" ? (
                      // 匹配后的消息按钮
                      <Link
                        href={`/dashboard/chat/${activity.user.id}`}
                        className="btn-primary text-sm py-2 px-4"
                      >
                        <MessageCircle className="w-4 h-4 mr-1" />
                        Message
                      </Link>
                    ) : (
                      // 查看详情按钮
                      <Link
                        href={`/dashboard/matches`}
                        className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </Link>
                    )}
                  </div>
                </div>

                {/* 请求状态标签 */}
                {activity.type === "request" && activity.requestStatus !== "pending" && (
                  <div className="mt-3 pt-3 border-t border-white/5">
                    <span
                      className={`text-sm ${
                        activity.requestStatus === "accepted"
                          ? "text-green-400"
                          : "text-white/40"
                      }`}
                    >
                      {activity.requestStatus === "accepted" ? "✓ Accepted" : "✗ Declined"}
                    </span>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* 提示信息 */}
      {userGender === "female" && (
        <div className="glass-card p-4 border-primary/20 bg-primary/5">
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-white text-sm">You&apos;re in control</h4>
              <p className="text-xs text-white/60 mt-1">
                Only you can initiate conversations. Review connection requests and decide who can message you.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
