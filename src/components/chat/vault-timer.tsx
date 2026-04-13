"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock, Plus, X, AlertTriangle, Trash2, Loader2 } from "lucide-react";
import { useApiGet, useApiPost, useApiDelete } from "@/hooks/use-api";

interface VaultTimerProps {
  roomId: string;
  isFemale: boolean;
}

interface VaultStatus {
  status: "ACTIVE" | "EXTENDED" | "EXPIRED" | "REVOKED";
  vaultExpiry: string;
  extensionCount: number;
  maxExtensions: number;
  extensionCost: number;
  timeRemaining: {
    hours: number;
    minutes: number;
    seconds: number;
    totalMs: number;
  };
}

function formatTime(hours: number, minutes: number, seconds: number): string {
  const h = hours.toString().padStart(2, "0");
  const m = minutes.toString().padStart(2, "0");
  const s = seconds.toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function getTimeColor(hours: number): string {
  if (hours < 2) return "text-red-400";
  if (hours < 6) return "text-yellow-400";
  return "text-green-400";
}

function getStatusBadge(status: string): { text: string; className: string } {
  switch (status) {
    case "ACTIVE":
      return { text: "Active", className: "bg-green-500/20 text-green-400" };
    case "EXTENDED":
      return { text: "Extended", className: "bg-blue-500/20 text-blue-400" };
    case "EXPIRED":
      return { text: "Expired", className: "bg-gray-500/20 text-gray-400" };
    case "REVOKED":
      return { text: "Ended", className: "bg-red-500/20 text-red-400" };
    default:
      return { text: status, className: "bg-white/10 text-white/60" };
  }
}

export function VaultTimer({ roomId, isFemale }: VaultTimerProps) {
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data: vault, refetch } = useApiGet<VaultStatus>(`/api/chat/${roomId}/vault`);
  const { post: extendVault, isLoading: isExtending } = useApiPost();
  const { delete: revokeVault, isLoading: isRevoking } = useApiDelete();

  const vaultStatus = vault?.status || "ACTIVE";
  const isActive = vaultStatus === "ACTIVE" || vaultStatus === "EXTENDED";
  const hoursRemaining = timeLeft.hours + timeLeft.minutes / 60;

  // Countdown timer
  useEffect(() => {
    if (!isActive) return;

    const updateTimer = () => {
      if (!vault?.vaultExpiry) return;
      
      const expiry = new Date(vault.vaultExpiry).getTime();
      const now = Date.now();
      const diff = Math.max(0, expiry - now);

      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);

      setTimeLeft({ hours, minutes, seconds });

      if (diff === 0) {
        refetch();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [vault?.vaultExpiry, isActive, refetch]);

  const handleExtend = useCallback(async () => {
    const result = await extendVault(`/api/chat/${roomId}/vault`, {});
    if (result) {
      refetch();
    }
  }, [roomId, extendVault, refetch]);

  const handleRevoke = useCallback(async () => {
    const result = await revokeVault(`/api/chat/${roomId}/vault`);
    if (result) {
      setShowRevokeConfirm(false);
      refetch();
    }
  }, [roomId, revokeVault, refetch]);

  const statusBadge = getStatusBadge(vaultStatus);
  const canExtend = isActive && (vault?.extensionCount || 0) < (vault?.maxExtensions || 3);
  const timeColor = getTimeColor(hoursRemaining);
  const isExpiringSoon = hoursRemaining < 2 && isActive;

  // Expired or Revoked state
  if (!isActive) {
    return (
      <div className="glass-card p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gray-500/20 flex items-center justify-center">
              <Clock className="w-5 h-5 text-gray-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white">The Vault</h3>
                <span className={`px-2 py-0.5 rounded-full text-xs ${statusBadge.className}`}>
                  {statusBadge.text}
                </span>
              </div>
              <p className="text-sm text-white/60">
                {vaultStatus === "EXPIRED"
                  ? "This conversation has expired and been archived"
                  : "This conversation has been ended"}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`glass-card p-4 mb-4 ${isExpiringSoon ? "border-red-500/30" : ""}`}>
        {/* Expiring Warning */}
        {isExpiringSoon && (
          <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm text-red-400">This conversation expires soon!</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          {/* Timer Display */}
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12">
              {/* Circular Progress */}
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-white/10"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <path
                  className={timeColor}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray={`${Math.min((hoursRemaining / 24) * 100, 100)}, 100`}
                  style={{ transition: "stroke-dasharray 1s ease" }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <Clock className={`w-4 h-4 ${timeColor}`} />
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white">The Vault</h3>
                <span className={`px-2 py-0.5 rounded-full text-xs ${statusBadge.className}`}>
                  {statusBadge.text}
                </span>
              </div>
              <p className={`text-lg font-mono font-bold ${timeColor}`}>
                {formatTime(timeLeft.hours, timeLeft.minutes, timeLeft.seconds)}
              </p>
              <p className="text-xs text-white/40">
                Extended {vault?.extensionCount || 0}/{vault?.maxExtensions || 3} times
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {canExtend && (
              <button
                onClick={handleExtend}
                disabled={isExtending}
                className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1"
              >
                {isExtending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    +6h ({vault?.extensionCost || 25} pts)
                  </>
                )}
              </button>
            )}

            {isFemale && (
              <button
                onClick={() => setShowRevokeConfirm(true)}
                disabled={isRevoking}
                className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                title="End Conversation"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Revoke Confirmation Modal */}
      {showRevokeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">End Conversation?</h3>
                <p className="text-sm text-white/60">This action cannot be undone</p>
              </div>
            </div>

            <p className="text-white/80 mb-4">
              You are about to end this conversation. The other person will no longer be able to send messages.
            </p>

            <label className="flex items-center gap-3 p-3 rounded-lg bg-white/5 cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={showDeleteConfirm}
                onChange={(e) => setShowDeleteConfirm(e.target.checked)}
                className="rounded border-white/20 bg-white/5"
              />
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-400" />
                <span className="text-sm text-white">Also delete chat history</span>
              </div>
            </label>

            <div className="flex gap-3">
              <button
                onClick={() => setShowRevokeConfirm(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                disabled={isRevoking}
                className="flex-1 py-2 px-4 rounded-xl bg-red-500 text-white font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {isRevoking ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "End Conversation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
