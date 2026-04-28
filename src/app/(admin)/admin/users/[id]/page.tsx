"use client";

import { use } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Mail, Calendar, MapPin, Shield, Heart, MessageCircle, CreditCard, Ban, CheckCircle, XCircle } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useState } from "react";

interface UserDetailPageProps {
  params: Promise<{ id: string }>;
}

const mockUserData = {
  id: "1",
  name: "Sarah Chen",
  email: "sarah@example.com",
  avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop",
  role: "premium",
  profileStatus: "complete",
  joined: "2024-01-15",
  lastActive: "2 hours ago",
  isVerified: true,
  isBanned: false,
  location: "San Francisco, CA",
  age: 28,
  gender: "woman",
  sexuality: "bisexual",
  bio: "Adventure seeker, book lover, coffee enthusiast.",
  attachmentStyle: "secure",
  matchHistory: [
    { id: 1, name: "Alex", score: 94, status: "accepted", date: "2024-03-10" },
    { id: 2, name: "Michael", score: 89, status: "pending", date: "2024-03-12" },
    { id: 3, name: "James", score: 78, status: "passed", date: "2024-03-08" },
  ],
  messageHistory: [
    { id: 1, partner: "Alex", lastMessage: "That sounds amazing!", timestamp: "2 hours ago", unread: 2 },
    { id: 2, partner: "Michael", lastMessage: "Would you want to grab coffee?", timestamp: "1 day ago", unread: 0 },
  ],
  subscriptionHistory: [
    { plan: "Premium Monthly", startDate: "2024-02-01", endDate: "2024-03-01", amount: 9.99, status: "active" },
    { plan: "Premium Yearly", startDate: "2024-01-15", endDate: "2025-01-15", amount: 79.99, status: "active" },
  ],
};

export default function UserDetailPage({ params }: UserDetailPageProps) {
  const { id } = use(params);
  const user = mockUserData;
  const [showBanDialog, setShowBanDialog] = useState(false);

  return (
    <div className="space-y-6">
      <Link href="/admin/users" className="inline-flex items-center gap-2 text-foreground-muted hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to Users
      </Link>

      {/* User Header */}
      <div className="glass-card p-6">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-shrink-0">
            <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-primary/30 relative">
              <Image src={user.avatar || '/default-avatar.png'} alt={user.name} fill className="object-cover" sizes="96px" />
            </div>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-foreground">{user.name}</h1>
              {user.isVerified && <CheckCircle className="w-5 h-5 text-success" />}
              <span className={`badge ${user.role === "premium" ? "badge-primary" : "badge-secondary"}`}>{user.role}</span>
              {user.isBanned && <span className="badge badge-error">Banned</span>}
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-foreground-muted mb-4">
              <span className="flex items-center gap-1"><Mail className="w-4 h-4" />{user.email}</span>
              <span className="flex items-center gap-1"><Calendar className="w-4 h-4" />Joined {user.joined}</span>
              <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{user.location}</span>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowBanDialog(true)} className="btn-secondary text-error border-error/30 hover:bg-error/10">
                <Ban className="w-4 h-4 mr-2" />
                {user.isBanned ? "Unban" : "Ban"}
              </button>
              <button className="btn-secondary">Edit Profile</button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Profile Info */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Profile Information</h2>
          <dl className="space-y-3">
            <div className="flex justify-between"><dt className="text-foreground-muted">Age</dt><dd className="text-foreground">{user.age}</dd></div>
            <div className="flex justify-between"><dt className="text-foreground-muted">Gender</dt><dd className="text-foreground">{user.gender}</dd></div>
            <div className="flex justify-between"><dt className="text-foreground-muted">Sexuality</dt><dd className="text-foreground">{user.sexuality}</dd></div>
            <div className="flex justify-between"><dt className="text-foreground-muted">Attachment</dt><dd className="text-foreground">{user.attachmentStyle}</dd></div>
            <div className="flex justify-between"><dt className="text-foreground-muted">Status</dt><dd className={`badge ${user.profileStatus === "complete" ? "badge-success" : "badge-warning"}`}>{user.profileStatus}</dd></div>
          </dl>
        </div>

        {/* Match History */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Match History</h2>
          <div className="space-y-3">
            {user.matchHistory.map((match) => (
              <div key={match.id} className="flex items-center justify-between p-3 bg-background-tertiary rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-foreground font-semibold">
                    {match.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-foreground font-medium">{match.name}</p>
                    <p className="text-xs text-foreground-muted">{match.date}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`match-score ${match.score >= 90 ? "match-score-high" : "match-score-medium"}`}>{match.score}%</span>
                  <p className="text-xs text-foreground-muted mt-1 capitalize">{match.status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Subscription History */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Subscription</h2>
          <div className="space-y-3">
            {user.subscriptionHistory.map((sub, idx) => (
              <div key={idx} className="p-3 bg-background-tertiary rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-foreground font-medium">{sub.plan}</span>
                  <span className="badge badge-success">{sub.status}</span>
                </div>
                <p className="text-sm text-foreground-muted">${sub.amount}</p>
                <p className="text-xs text-foreground-subtle">{sub.startDate} - {sub.endDate}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Message History */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Recent Messages</h2>
        <div className="space-y-2">
          {user.messageHistory.map((msg) => (
            <div key={msg.id} className="flex items-center justify-between p-4 bg-background-tertiary rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-secondary to-primary flex items-center justify-center text-foreground font-semibold">
                  {msg.partner.charAt(0)}
                </div>
                <div>
                  <p className="text-foreground font-medium">{msg.partner}</p>
                  <p className="text-sm text-foreground-muted">{msg.lastMessage}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-foreground-muted">{msg.timestamp}</p>
                {msg.unread > 0 && <span className="badge badge-primary mt-1">{msg.unread} unread</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showBanDialog}
        onClose={() => setShowBanDialog(false)}
        onConfirm={() => setShowBanDialog(false)}
        title={user.isBanned ? "Unban User" : "Ban User"}
        description={user.isBanned ? `Are you sure you want to unban ${user.name}?` : `Are you sure you want to ban ${user.name}? They will lose access to their account.`}
        confirmText={user.isBanned ? "Unban User" : "Ban User"}
        variant="warning"
      />
    </div>
  );
}
