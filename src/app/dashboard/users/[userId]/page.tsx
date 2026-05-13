"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Heart,
  MessageCircle,
  ArrowLeft,
  MapPin,
  Calendar,
  User,
  Sparkles,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { ZoomIn } from "lucide-react";
import {
  getAvatarKind,
  getAvatarBackground,
  parseEmojiAvatar,
  getRealPhotoAvatarUrl,
} from "@/lib/avatar-utils";

// ═════════════════════════════════════
// DESIGN TOKENS — Dateasy Dark (Purple + Lime)
// ═════════════════════════════════════
const COLORS = {
  primary: "#4c1d95",
  primaryLight: "#8b5cf6",
  accent: "#a3e635",
  pink: "#f472b6",
};

interface UserProfile {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  isBot: boolean;
  createdAt: string;
  profile: {
    id: string;
    displayName: string | null;
    age: number | null;
    avatar: string | null;
    avatarType: string | null;
    city: string | null;
    bio: string | null;
    relationshipGoal: string | null;
    attachmentStyle: string | null;
    communicationStyle: string | null;
    loveLanguage: string | null;
    emotionalAvailability: boolean | null;
    interests: string | null;
    selectedTags: string[] | null;
    gallery: string[] | null;
    gender: string | null;
    lookingFor: string | null;
    education: string | null;
    occupation: string | null;
    height: number | null;
    drinking: string | null;
    smoking: string | null;
    kids: string | null;
    pets: string | null;
    languages: string | null;
  } | null;
  matchStatus: string | null;
  myReaction: string | null;
  matchId: string | null;
}

// ═════════════════════════════════════
// AVATAR COMPONENT — Real HD Photo with Lightbox
// ═════════════════════════════════════
function UserAvatar({ user, size = 320 }: { user: UserProfile; size?: number }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const avatar = user.profile?.avatar;
  const kind = getAvatarKind(avatar);

  if (kind === 'emoji') {
    const parsed = parseEmojiAvatar(avatar);
    return (
      <div
        className="rounded-3xl flex items-center justify-center text-8xl"
        style={{
          width: size,
          height: size,
          background: getAvatarBackground(kind, avatar),
        }}
      >
        {parsed?.emoji}
      </div>
    );
  }

  // Always use real photo
  const photoUrl = (kind === 'photo' && avatar)
    ? avatar
    : getRealPhotoAvatarUrl(user.id || user.name || 'default', user.profile?.gender || undefined, 'preview');
  const fullResUrl = photoUrl.replace(/w=\d+&h=\d+/, 'w=1200&h=1600');

  return (
    <>
      <div
        className="rounded-3xl overflow-hidden cursor-pointer relative"
        style={{ width: size, height: size }}
        onClick={() => setLightboxOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setLightboxOpen(true); }}
      >
        {!loaded && (
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-secondary/10 animate-pulse" />
        )}
        <img
          src={photoUrl}
          alt={user.profile?.displayName || user.name || "User"}
          className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          crossOrigin="anonymous"
          loading="eager"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={(e) => {
            const img = e.currentTarget;
            img.src = getRealPhotoAvatarUrl(user.id || user.name || 'default', user.profile?.gender || undefined, 'preview');
          }}
        />
        {/* Zoom hint */}
        <div className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
          <ZoomIn className="w-4 h-4 text-white" />
        </div>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.92)" }}
            onClick={() => setLightboxOpen(false)}
          >
            <button
              onClick={() => setLightboxOpen(false)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
            <motion.img
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              src={fullResUrl}
              alt={user.profile?.displayName || user.name || "User"}
              className="max-w-[90vw] max-h-[85vh] object-contain rounded-2xl"
              onClick={(e) => e.stopPropagation()}
              draggable={false}
              loading="eager"
              decoding="async"
              style={{ willChange: 'transform' }}
            />
            <p className="absolute bottom-6 text-white/30 text-xs">Tap anywhere to close</p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ═════════════════════════════════════
// TAG COMPONENT
// ═════════════════════════════════════
function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-white/5 text-foreground-muted border border-white/10">
      {children}
    </span>
  );
}

// ═════════════════════════════════════
// MAIN PAGE COMPONENT
// ═════════════════════════════════════
export default function UserDetailPage({ params }: { params: { userId: string } }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const userId = params.userId;

  useEffect(() => {
    if (!session?.user?.id) return;
    fetchUserData();
  }, [session, userId]);

  async function fetchUserData() {
    try {
      setLoading(true);
      const res = await fetch(`/api/users/${userId}`);
      if (!res.ok) {
        throw new Error(`Failed to load user: ${res.status}`);
      }
      const data = await res.json();
      setUser(data.user);
    } catch (err: any) {
      setError(err.message || "Failed to load user");
    } finally {
      setLoading(false);
    }
  }

  async function handleReaction(reaction: 'LIKE' | 'PASS') {
    if (!user || !session?.user?.id) return;

    setActionLoading(true);
    try {
      const res = await fetch('/api/matches/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: user.id,
          reaction,
        }),
      });

      if (!res.ok) throw new Error('Failed to react');

      const data = await res.json();
      toast.success(reaction === 'LIKE' ? '❤️ Liked!' : 'Passed');
      
      // 如果 like 且匹配成功，跳转到聊天
      if (reaction === 'LIKE' && data.matched) {
        router.push(`/dashboard/chats/${data.matchId}`);
      } else {
        // 返回推荐列表
        router.push('/dashboard');
      }
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center gap-4">
        <p className="text-foreground-muted">{error || "User not found"}</p>
        <Link
          href="/dashboard"
          className="text-primary hover:text-primaryLight transition-colors"
        >
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  const displayName = user.profile?.displayName || user.name || "Anonymous";
  const age = user.profile?.age || "";
  const city = user.profile?.city || "";
  const bio = user.profile?.bio || "";
  const tags = user.profile?.selectedTags || [];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-foreground">
      {/* Top Bar */}
      <div className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 rounded-xl hover:bg-white/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-sm text-foreground-muted">Back</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col md:flex-row gap-8"
        >
          {/* Avatar */}
          <div className="flex-shrink-0 mx-auto md:mx-0">
            <UserAvatar user={user} size={320} />
          </div>

          {/* Info */}
          <div className="flex-1 flex flex-col justify-center">
            <h1 className="text-4xl font-bold font-display text-foreground">
              {displayName}, {age}
            </h1>

            {city && (
              <p className="flex items-center gap-1.5 text-foreground-muted mt-2">
                <MapPin className="w-4 h-4" />
                {city}
              </p>
            )}

            {/* Match Status */}
            {user.matchStatus && (
              <div className="mt-4">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                  user.matchStatus === 'ACCEPTED' 
                    ? 'bg-green-500/20 text-green-400' 
                    : user.matchStatus === 'PENDING'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-white/5 text-foreground-muted'
                }`}>
                  {user.matchStatus === 'ACCEPTED' && <Check className="w-3.5 h-3.5" />}
                  {user.matchStatus}
                </span>
              </div>
            )}

            {/* Quick Tags */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {tags.slice(0, 6).map((tag: string) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            )}

            {/* Action Buttons */}
            {!user.matchStatus && (
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => handleReaction('PASS')}
                  disabled={actionLoading}
                  className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-red-500/20 hover:border-red-500/30 transition-all duration-300 group"
                >
                  <X className="w-6 h-6 text-foreground-muted group-hover:text-red-400" />
                </button>
                <button
                  onClick={() => handleReaction('LIKE')}
                  disabled={actionLoading}
                  className="flex-1 h-14 rounded-2xl bg-gradient-to-r from-primary to-primaryLight flex items-center justify-center gap-2 text-foreground font-semibold hover:shadow-lg hover:shadow-primary/20 transition-all duration-300"
                >
                  {actionLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Heart className="w-5 h-5" />
                      Like
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Already matched actions */}
            {user.matchStatus === 'ACCEPTED' && user.matchId && (
              <Link
                href={`/dashboard/chats/${user.matchId}`}
                className="mt-6 block"
              >
                <button className="w-full h-14 rounded-2xl bg-gradient-to-r from-primary to-primaryLight flex items-center justify-center gap-2 text-foreground font-semibold">
                  <MessageCircle className="w-5 h-5" />
                  Send Message
                </button>
              </Link>
            )}
          </div>
        </motion.div>

        {/* Bio Section */}
        {bio && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mt-10 bg-[#111111] rounded-2xl p-6 border border-white/5"
          >
            <h2 className="text-lg font-semibold text-foreground mb-3">About</h2>
            <p className="text-foreground-muted leading-relaxed">{bio}</p>
          </motion.div>
        )}

        {/* Details Grid */}
        {user.profile && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-4"
          >
            {user.profile.relationshipGoal && (
              <div className="bg-[#111111] rounded-2xl p-4 border border-white/5">
                <p className="text-foreground-faint text-xs mb-1">Relationship Goal</p>
                <p className="text-foreground font-medium">{user.profile.relationshipGoal}</p>
              </div>
            )}
            {user.profile.attachmentStyle && (
              <div className="bg-[#111111] rounded-2xl p-4 border border-white/5">
                <p className="text-foreground-faint text-xs mb-1">Attachment Style</p>
                <p className="text-foreground font-medium">{user.profile.attachmentStyle}</p>
              </div>
            )}
            {user.profile.communicationStyle && (
              <div className="bg-[#111111] rounded-2xl p-4 border border-white/5">
                <p className="text-foreground-faint text-xs mb-1">Communication</p>
                <p className="text-foreground font-medium">{user.profile.communicationStyle}</p>
              </div>
            )}
            {user.profile.loveLanguage && (
              <div className="bg-[#111111] rounded-2xl p-4 border border-white/5">
                <p className="text-foreground-faint text-xs mb-1">Love Language</p>
                <p className="text-foreground font-medium">{user.profile.loveLanguage}</p>
              </div>
            )}
            {user.profile.education && (
              <div className="bg-[#111111] rounded-2xl p-4 border border-white/5">
                <p className="text-foreground-faint text-xs mb-1">Education</p>
                <p className="text-foreground font-medium">{user.profile.education}</p>
              </div>
            )}
            {user.profile.occupation && (
              <div className="bg-[#111111] rounded-2xl p-4 border border-white/5">
                <p className="text-foreground-faint text-xs mb-1">Occupation</p>
                <p className="text-foreground font-medium">{user.profile.occupation}</p>
              </div>
            )}
          </motion.div>
        )}

        {/* All Tags */}
        {tags.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-6 bg-[#111111] rounded-2xl p-6 border border-white/5"
          >
            <h2 className="text-lg font-semibold text-foreground mb-3">Interests</h2>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag: string) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
