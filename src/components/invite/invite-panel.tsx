"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, Copy, Check, Share2, Users, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

interface InviteData {
  inviteCode: string;
  inviteCount: number;
  inviteRewards: number;
  invites: Array<{
    id: string;
    status: string;
    createdAt: string;
    inviteeName: string | null;
  }>;
  rewards: {
    perInvite: number;
    maxInvites: number;
  };
}

interface InvitePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function InvitePanel({ isOpen, onClose }: InvitePanelProps) {
  const [data, setData] = useState<InviteData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadInviteData();
    }
  }, [isOpen]);

  const loadInviteData = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/invites");
      if (!res.ok) throw new Error("Failed to load");
      const inviteData = await res.json();
      setData(inviteData);
    } catch (error) {
      toast.error("Failed to load invite data");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!data?.inviteCode) return;
    
    const inviteUrl = `${window.location.origin}/register?ref=${data.inviteCode}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success("Invite link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!data?.inviteCode) return;
    
    const inviteUrl = `${window.location.origin}/register?ref=${data.inviteCode}`;
    const shareText = `Join me on LokFeel - a relationship-first dating app! Use my code: ${data.inviteCode}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join LokFeel",
          text: shareText,
          url: inviteUrl,
        });
      } catch (err) {
        // User cancelled
      }
    } else {
      handleCopy();
    }
  };

  if (isLoading || !data) {
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          >
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  const inviteUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/register?ref=${data.inviteCode}`;
  const progressPercent = Math.min(100, (data.inviteCount / data.rewards.maxInvites) * 100);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />

          {/* Panel */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="fixed inset-x-4 top-[10%] max-w-md mx-auto z-50 bg-[#0d0c11] rounded-3xl border border-white/10 overflow-hidden max-h-[80vh]"
          >
            {/* Header */}
            <div className="relative p-6 bg-gradient-to-br from-primary/20 to-secondary/20">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 rounded-full bg-black/20 text-white/60 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4">
                  <Gift className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-1">Invite Friends</h2>
                <p className="text-white/60">Earn rewards for every friend who joins</p>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto max-h-[50vh]">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-4 rounded-2xl bg-white/5 text-center">
                  <Users className="w-6 h-6 text-primary mx-auto mb-2" />
                  <div className="text-2xl font-bold text-white">{data.inviteCount}</div>
                  <div className="text-xs text-white/50">Friends Joined</div>
                </div>
                <div className="p-4 rounded-2xl bg-white/5 text-center">
                  <Sparkles className="w-6 h-6 text-secondary mx-auto mb-2" />
                  <div className="text-2xl font-bold text-white">{data.inviteRewards}</div>
                  <div className="text-xs text-white/50">Points Earned</div>
                </div>
              </div>

              {/* Invite Code */}
              <div className="mb-6">
                <label className="text-sm text-white/60 mb-2 block">Your Invite Code</label>
                <div className="flex gap-2">
                  <div className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-center">
                    <span className="text-2xl font-bold text-white tracking-wider">
                      {data.inviteCode}
                    </span>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="px-4 py-3 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                  >
                    {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Share Button */}
              <button
                onClick={handleShare}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity mb-6"
              >
                <Share2 className="w-5 h-5" />
                Share Invite Link
              </button>

              {/* Progress */}
              <div className="mb-6">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-white/60">Progress</span>
                  <span className="text-white">{data.inviteCount}/{data.rewards.maxInvites}</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-primary to-secondary"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPercent}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <p className="text-xs text-white/40 mt-2">
                  Invite up to {data.rewards.maxInvites} friends to earn {data.rewards.perInvite} points each
                </p>
              </div>

              {/* Recent Invites */}
              {data.invites.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-white mb-3">Recent Invites</h3>
                  <div className="space-y-2">
                    {data.invites.map((invite) => (
                      <div
                        key={invite.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-white/5"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Users className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm text-white">
                              {invite.inviteeName || "Anonymous"}
                            </p>
                            <p className="text-xs text-white/40">
                              {new Date(invite.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`px-2 py-1 rounded-full text-xs ${
                            invite.status === "COMPLETED"
                              ? "bg-green-500/20 text-green-400"
                              : invite.status === "PENDING"
                              ? "bg-yellow-500/20 text-yellow-400"
                              : "bg-gray-500/20 text-gray-400"
                          }`}
                        >
                          {invite.status.toLowerCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
