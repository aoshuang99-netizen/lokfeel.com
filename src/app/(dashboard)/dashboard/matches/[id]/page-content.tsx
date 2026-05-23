"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Heart,
  MessageCircle,
  MapPin,
  Calendar,
  Shield,
  Clock,
  Loader2,
  Ban,
  CheckCircle,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { useApiGet, useApiPost } from "@/hooks/use-api";
import { getAvatarKind, getAvatarBackground, parseEmojiAvatar, isBrokenAvatarUrl, getRealPhotoAvatarUrl } from "@/lib/avatar-utils";

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

interface MatchUser {
  id: string;
  name: string | null;
  image: string | null;
  gender?: string | null;
  profile?: {
    displayName: string | null;
    age: number | null;
    avatar: string | null;
    city: string | null;
    bio: string | null;
    relationshipGoal: string | null;
    attachmentStyle: string | null;
    communicationStyle: string | null;
    loveLanguage: string | null;
  };
}

interface MatchDetail {
  id: string;
  senderId: string;
  receiverId: string;
  score: number;
  reason: string | null;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  chatRoom: { id: string } | null;
  sender: MatchUser;
  receiver: MatchUser;
  matchReactions: Array<{
    id: string;
    userId: string;
    reaction: string;
    createdAt: string;
  }>;
}

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------

export default function MatchDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const matchId = params.id;

  const { data: match, isLoading, refetch } = useApiGet<{ match: MatchDetail }>(
    matchId ? `/api/matches/${matchId}` : null
  );
  const { post, isLoading: isReacting } = useApiPost();

  const [currentUser, setCurrentUser] = useState<{ id: string } | null>(null);

  // Fetch current user
  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) setCurrentUser(data.user);
      })
      .catch(() => {});
  }, []);

  const matchData = match?.match;
  const isSender = matchData ? matchData.senderId === currentUser?.id : false;
  const otherUser = matchData
    ? isSender
      ? matchData.receiver
      : matchData.sender
    : null;

  const myReaction = matchData?.matchReactions.find(
    (r) => r.userId === currentUser?.id
  )?.reaction;
  const otherReaction = matchData?.matchReactions.find(
    (r) => r.userId !== currentUser?.id
  )?.reaction;

  const handleReaction = async (reaction: string) => {
    const result = await post(`/api/matches/${matchId}`, { reaction });
    if (result) {
      refetch();
    }
  };

  const handleMessage = () => {
    if (matchData?.chatRoom) {
      router.push(`/dashboard/chats/${matchData.chatRoom.id}`);
    }
  };

  const handleUnmatch = async () => {
    if (!confirm("Are you sure you want to unmatch? This cannot be undone.")) return;
    const result = await post(`/api/matches/${matchId}`, { reaction: "PASS" });
    if (result) {
      router.push("/dashboard/connections");
    }
  };

  // Avatar rendering
  const renderAvatar = (user: MatchUser | null) => {
    if (!user) return null;
    const avatarField = user.profile?.avatar || user.image;
    const kind = getAvatarKind(avatarField);

    return (
      <div className={`w-20 h-20 rounded-2xl overflow-hidden flex items-center justify-center ${getAvatarBackground(kind, avatarField)}`}>
        {(() => {
          if (kind === 'emoji' && avatarField) {
            const parsed = parseEmojiAvatar(avatarField);
            return <span className="text-5xl">{parsed?.emoji}</span>;
          }
          const photoUrl =
            kind === 'photo' && avatarField && !isBrokenAvatarUrl(avatarField)
              ? avatarField
              : getRealPhotoAvatarUrl(user.id || user.name || 'unknown', user.gender ?? undefined, 'preview', user.profile?.age ?? undefined);
          return (
            <img
              src={photoUrl}
              alt={user.name || 'User'}
              className="w-full h-full object-cover object-top"
              loading="lazy"
              decoding="async"
            />
          );
        })()}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <span className="ml-3 text-foreground-muted">Loading match...</span>
      </div>
    );
  }

  if (!matchData) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="w-12 h-12 text-error mx-auto mb-4" />
        <h2 className="text-xl font-bold text-foreground mb-2">Match Not Found</h2>
        <p className="text-foreground-muted mb-6">This match may have expired or been removed.</p>
        <Link href="/dashboard/connections" className="auth-cta-secondary inline-block">
          Back to Connections
        </Link>
      </div>
    );
  }

  const displayName = otherUser?.profile?.displayName || otherUser?.name || "User";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-xl hover:bg-input-bg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-foreground-muted" />
        </button>
        <h1 className="text-2xl font-bold text-foreground font-display">Match Details</h1>
      </div>

      {/* User Card */}
      <div className="card p-6 space-y-5">
        {/* Avatar + Name */}
        <div className="flex items-center gap-4">
          {renderAvatar(otherUser)}
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-foreground truncate">{displayName}</h2>
            <div className="flex items-center gap-3 text-sm text-foreground-muted mt-1">
              {otherUser?.profile?.age && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {otherUser.profile.age}
                </span>
              )}
              {otherUser?.profile?.city && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {otherUser.profile.city}
                </span>
              )}
            </div>
          </div>

          {/* Match Score Badge */}
          <div className="flex flex-col items-center gap-1">
            <div className="w-12 h-12 rounded-full bg-primary-muted flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <span className="text-xs font-bold text-primary">{matchData.score}%</span>
          </div>
        </div>

        {/* Bio */}
        {otherUser?.profile?.bio && (
          <div>
            <h3 className="text-sm font-semibold text-foreground-muted mb-1.5">About</h3>
            <p className="text-sm text-foreground leading-relaxed">{otherUser.profile.bio}</p>
          </div>
        )}

        {/* Match Reason */}
        {matchData.reason && (
          <div className="p-3 rounded-xl bg-primary-muted/30 border border-primary-muted/50">
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-primary mb-0.5">Compatibility Match</p>
                <p className="text-sm text-foreground-muted">{matchData.reason}</p>
              </div>
            </div>
          </div>
        )}

        {/* Profile Details */}
        <div className="grid grid-cols-2 gap-3">
          {otherUser?.profile?.relationshipGoal && (
            <div className="p-3 rounded-xl bg-input-bg">
              <p className="text-xs text-foreground-muted mb-0.5">Looking for</p>
              <p className="text-sm font-medium text-foreground">{otherUser.profile.relationshipGoal}</p>
            </div>
          )}
          {otherUser?.profile?.attachmentStyle && (
            <div className="p-3 rounded-xl bg-input-bg">
              <p className="text-xs text-foreground-muted mb-0.5">Attachment</p>
              <p className="text-sm font-medium text-foreground">{otherUser.profile.attachmentStyle}</p>
            </div>
          )}
          {otherUser?.profile?.communicationStyle && (
            <div className="p-3 rounded-xl bg-input-bg">
              <p className="text-xs text-foreground-muted mb-0.5">Communication</p>
              <p className="text-sm font-medium text-foreground">{otherUser.profile.communicationStyle}</p>
            </div>
          )}
          {otherUser?.profile?.loveLanguage && (
            <div className="p-3 rounded-xl bg-input-bg">
              <p className="text-xs text-foreground-muted mb-0.5">Love Language</p>
              <p className="text-sm font-medium text-foreground">{otherUser.profile.loveLanguage}</p>
            </div>
          )}
        </div>
      </div>

      {/* Status Card */}
      <div className="card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground-muted">Match Status</h3>

        {/* Status Badge */}
        <div className="flex items-center gap-2">
          {matchData.status === "ACCEPTED" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-success-muted text-success text-sm font-medium">
              <CheckCircle className="w-4 h-4" /> Accepted
            </span>
          ) : matchData.status === "PENDING" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning-muted text-warning text-sm font-medium">
              <Clock className="w-4 h-4" /> Pending
            </span>
          ) : matchData.status === "EXPIRED" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-error-muted text-error text-sm font-medium">
              <AlertCircle className="w-4 h-4" /> Expired
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-foreground-faint text-foreground-muted text-sm font-medium">
              <Ban className="w-4 h-4" /> {matchData.status}
            </span>
          )}
          <span className="text-xs text-foreground-muted ml-auto">
            {new Date(matchData.createdAt).toLocaleDateString()}
          </span>
        </div>

        {/* Reactions */}
        {(myReaction || otherReaction) && (
          <div className="flex items-center gap-4 text-sm">
            {myReaction && (
              <span className="text-foreground-muted">
                You: <span className="text-foreground font-medium">{myReaction}</span>
              </span>
            )}
            {otherReaction && (
              <span className="text-foreground-muted">
                Them: <span className="text-foreground font-medium">{otherReaction}</span>
              </span>
            )}
          </div>
        )}

        {/* Expiry Warning */}
        {matchData.status === "PENDING" && matchData.expiresAt && (
          <div className="p-3 rounded-xl bg-warning-muted/20 border border-warning-muted/50">
            <p className="text-sm text-warning">
              <Clock className="w-4 h-4 inline mr-1" />
              This match expires on {new Date(matchData.expiresAt).toLocaleDateString()}. Respond now!
            </p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="card p-5 space-y-3">
        {/* Message Button */}
        {matchData.status === "ACCEPTED" && matchData.chatRoom && (
          <button
            onClick={handleMessage}
            className="auth-cta w-full flex items-center justify-center gap-2"
          >
            <MessageCircle className="w-5 h-5" />
            Send Message
          </button>
        )}

        {/* Accept / Pass (for pending matches) */}
        {matchData.status === "PENDING" && !myReaction && (
          <div className="flex gap-3">
            <button
              onClick={() => handleReaction("INTERESTED")}
              disabled={isReacting}
              className="flex-1 auth-cta flex items-center justify-center gap-2"
            >
              <Heart className="w-5 h-5" />
              Accept
            </button>
            <button
              onClick={() => handleReaction("PASS")}
              disabled={isReacting}
              className="flex-1 auth-cta-secondary flex items-center justify-center gap-2"
            >
              <Ban className="w-5 h-5" />
              Pass
            </button>
          </div>
        )}

        {/* Unmatch */}
        <button
          onClick={handleUnmatch}
          className="w-full p-3 rounded-xl border border-error-muted text-error text-sm font-medium hover:bg-error-muted/20 transition-colors"
        >
          Unmatch
        </button>
      </div>
    </div>
  );
}
