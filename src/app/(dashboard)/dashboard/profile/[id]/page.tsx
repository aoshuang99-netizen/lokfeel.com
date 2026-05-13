"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { CardVerificationWall } from "@/components/payment/CardVerificationWall";
import {
  ArrowLeft,
  MapPin,
  Briefcase,
  GraduationCap,
  Heart,
  Shield,
  BadgeCheck,
  Bot,
  Sparkles,
  Crown,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { Skeleton, LoadingScreen, InlineError } from "@/components/ui";
import { toast } from "sonner";
import { isMaleGender, isFemaleGender } from "@/lib/gender-utils";

// LinkedIn icon component
function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );
}

// 用户详情类型
interface UserProfile {
  id: string;
  profileId: string;
  displayName: string;
  age: number;
  gender: string;
  location?: string;
  bio?: string;
  avatar?: string;
  avatarType?: string;
  occupation?: string;
  company?: string;
  industry?: string;
  education?: string;
  isBot: boolean;
  isNew: boolean;
  joinedAt: string;
  popularity: number;
  matchScore?: number;
  matchReason?: string;
  tags?: string[];
  linkedInVerified?: boolean;
  verificationBadge?: string;
  attachmentStyle?: string;
  communicationStyle?: string;
  conflictResolution?: string;
  loveLanguage?: string;
  lifePriorities?: string[];
  relationshipGoal?: string;
  boundaries?: string[];
  dealbreakers?: string[];
  emotionalAvailability?: string;
  interests?: string[];
  photos?: string[];
}

// 当前用户状态
interface CurrentUserStatus {
  gender: string;
  remainingConnections: number;
  hasActiveSubscription: boolean;
  subscriptionPlan?: string;
}

// Helper icon component
function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
}

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUserStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [showCardVerification, setShowCardVerification] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [imageError, setImageError] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`/api/profile/${userId}`);
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.message);
      
      setProfile(data.profile);
      setCurrentUser(data.currentUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      loadProfile();
    }
  }, [userId, loadProfile]);

  const handleConnect = async () => {
    if (!profile || !currentUser) return;
    
    if (currentUser.remainingConnections <= 0) {
      if (isMaleGender(currentUser.gender)) {
        router.push('/dashboard/subscription');
        return;
      }
      setError('You have used all your free connection requests this week');
      return;
    }
    
    setConnectLoading(true);
    try {
      const res = await fetch('/api/matches/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: profile.id }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        // Handle card verification requirement
        if (data.code === 'CARD_VERIFICATION_REQUIRED') {
          setShowCardVerification(true);
          return;
        }
        throw new Error(data.message);
      }
      
      setCurrentUser(prev => prev ? {
        ...prev,
        remainingConnections: prev.remainingConnections - 1
      } : null);
      
      setShowConnectModal(false);
      toast.success('Connection request sent!');
      router.push('/dashboard/connections');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send connection request');
      toast.error('Failed to send connection request');
    } finally {
      setConnectLoading(false);
    }
  };

  const getAvatarUrl = (user: UserProfile) => {
    if (user.avatar && !imageError) return user.avatar;

    // Fallback to real photos from Unsplash — gender-matched portraits
    // Using deterministic photo selection based on user name for consistency
    const femalePhotos = [
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&h=800&fit=crop&crop=face',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=600&h=800&fit=crop&crop=face',
      'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=600&h=800&fit=crop&crop=face',
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&h=800&fit=crop&crop=face',
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=600&h=800&fit=crop&crop=face',
    ];
    const malePhotos = [
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&h=800&fit=crop&crop=face',
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&h=800&fit=crop&crop=face',
      'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=600&h=800&fit=crop&crop=face',
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=600&h=800&fit=crop&crop=face',
      'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=600&h=800&fit=crop&crop=face',
    ];

    const photos = isFemaleGender(user.gender) ? femalePhotos : malePhotos;
    const index = user.displayName.length % photos.length;
    return photos[index];
  };

  const getGenderLabel = (gender: string) => {
    const labels: Record<string, string> = {
      MALE: 'He/Him',
      FEMALE: 'She/Her',
      NON_BINARY: 'They/Them',
    };
    return labels[gender] || gender;
  };

  const getRelationshipGoalLabel = (goal?: string) => {
    const labels: Record<string, string> = {
      'MONOGAMY': 'Long-term Relationship',
      'ETHICAL_NON_MONOGAMY': 'Open Relationship',
      'POLYAMORY': 'Polyamory',
      'CASUAL_DATING': 'Casual Dating',
      'FRIENDSHIP_FIRST': 'Friends First',
      'KINK_BDSM': 'Alternative Dynamics',
    };
    return labels[goal || ''] || goal;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          <Skeleton variant="rectangular" height={300} className="rounded-2xl" />
          <div className="glass-card p-6 space-y-4">
            <Skeleton variant="text" width="60%" height={32} />
            <Skeleton variant="text" width="40%" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-background pb-20 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-20 h-20 rounded-full bg-error/10 flex items-center justify-center mx-auto mb-6"
          >
            <AlertCircle className="w-10 h-10 text-error" />
          </motion.div>
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {error ? 'Unable to load profile' : 'Profile not found'}
          </h2>
          <p className="text-foreground-muted mb-6">{error || 'This user profile could not be found.'}</p>
          <div className="flex items-center justify-center gap-3">
            <button onClick={loadProfile} className="btn-primary">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </button>
            <Link href="/dashboard/explore" className="btn-secondary">
              Back to Explore
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const photos = profile.photos || [getAvatarUrl(profile)];
  const isMale = isMaleGender(currentUser?.gender);
  const canConnect = currentUser && currentUser.remainingConnections > 0;

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-card-border">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/dashboard/explore" className="flex items-center gap-2 text-foreground-muted hover:text-foreground transition-colors">
              <ArrowLeft className="w-5 h-5" />
              Back
            </Link>
            
            {currentUser && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-foreground-muted">Remaining connections:</span>
                <span className={`font-semibold ${currentUser.remainingConnections > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {currentUser.remainingConnections}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Photo Gallery */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-surface mb-6"
        >
          <img
            src={photos[activePhotoIndex]}
            alt={profile.displayName}
            className="w-full h-full object-cover"
            loading="eager"
            decoding="async"
            onError={() => setImageError(true)}
          />
          
          {photos.length > 1 && (
            <>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setActivePhotoIndex(prev => prev > 0 ? prev - 1 : photos.length - 1)}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/50 rounded-full flex items-center justify-center text-foreground hover:bg-black/70 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setActivePhotoIndex(prev => prev < photos.length - 1 ? prev + 1 : 0)}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/50 rounded-full flex items-center justify-center text-foreground hover:bg-black/70 transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </motion.button>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                {photos.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActivePhotoIndex(idx)}
                    className={`w-2 h-2 rounded-full transition-colors ${idx === activePhotoIndex ? 'bg-accent-lime' : 'bg-foreground-muted/30'}`}
                  />
                ))}
              </div>
            </>
          )}
          
          <div className="absolute top-4 left-4 flex flex-wrap gap-2">
            {profile.isBot && (
              <span className="px-3 py-1 bg-primary/90 text-foreground text-sm font-medium rounded-full flex items-center gap-1">
                <Bot className="w-4 h-4" />
                AI User
              </span>
            )}
            {profile.isNew && (
              <span className="px-3 py-1 bg-green-500/90 text-foreground text-sm font-medium rounded-full flex items-center gap-1">
                <Sparkles className="w-4 h-4" />
                New
              </span>
            )}
            {profile.linkedInVerified && (
              <span className="px-3 py-1 bg-blue-500/90 text-foreground text-sm font-medium rounded-full flex items-center gap-1">
                <LinkedinIcon className="w-4 h-4" />
                LinkedIn Verified
              </span>
            )}
          </div>
          
          {profile.matchScore && profile.matchScore > 0 && (
            <div className="absolute top-4 right-4">
              <div className={`px-4 py-2 rounded-full font-bold text-lg ${
                profile.matchScore >= 80 ? 'bg-accent-lime/90 text-white' :
                profile.matchScore >= 60 ? 'bg-amber-500/90 text-white' :
                'bg-background-tertiary text-foreground backdrop-blur-sm'
              }`}>
                {profile.matchScore}% Match
              </div>
            </div>
          )}
        </motion.div>

        {/* Basic Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-surface rounded-2xl p-6 mb-6"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-1">
                {profile.displayName}, {profile.age}
              </h1>
              <p className="text-foreground-muted">{getGenderLabel(profile.gender)}</p>
            </div>
            
            <motion.button
              whileHover={{ scale: canConnect ? 1.02 : 1 }}
              whileTap={{ scale: canConnect ? 0.98 : 1 }}
              onClick={() => setShowConnectModal(true)}
              disabled={!canConnect}
              className={`px-6 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all ${
                canConnect
                  ? 'bg-primary text-foreground hover:bg-primary/90 cursor-pointer'
                  : 'bg-background-tertiary text-foreground-subtle cursor-not-allowed'
              }`}
            >
              <Heart className="w-5 h-5" />
              {canConnect ? 'Connect' : 'No Connections Left'}
            </motion.button>
          </div>
          
          {profile.tags && profile.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {profile.tags.map((tag, i) => (
                <span key={i} className="px-3 py-1 bg-primary/20 text-primary text-sm rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {profile.location && (
              <div className="flex items-center gap-2 text-foreground-muted">
                <MapPin className="w-4 h-4" />
                <span>{profile.location}</span>
              </div>
            )}
            {profile.occupation && (
              <div className="flex items-center gap-2 text-foreground-muted">
                <Briefcase className="w-4 h-4" />
                <span>{profile.occupation}</span>
              </div>
            )}
            {profile.company && (
              <div className="flex items-center gap-2 text-foreground-muted">
                <BuildingIcon className="w-4 h-4" />
                <span>{profile.company}</span>
              </div>
            )}
            {profile.education && (
              <div className="flex items-center gap-2 text-foreground-muted">
                <GraduationCap className="w-4 h-4" />
                <span>{profile.education}</span>
              </div>
            )}
          </div>
        </motion.div>

        {profile.bio && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-surface rounded-2xl p-6 mb-6"
          >
            <h2 className="text-lg font-semibold text-foreground mb-3">About</h2>
            <p className="text-foreground-muted leading-relaxed">{profile.bio}</p>
          </motion.div>
        )}

        {profile.matchReason && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-primary/10 border border-primary/20 rounded-2xl p-6 mb-6"
          >
            <h2 className="text-lg font-semibold text-primary mb-3 flex items-center gap-2">
              <BadgeCheck className="w-5 h-5" />
              Why You Might Match
            </h2>
            <p className="text-foreground-muted leading-relaxed">{profile.matchReason}</p>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-surface rounded-2xl p-6 mb-6"
        >
          <h2 className="text-lg font-semibold text-foreground mb-4">Relationship Profile</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {profile.relationshipGoal && (
              <div>
                <p className="text-sm text-foreground-subtle mb-1">Looking for</p>
                <p className="text-foreground font-medium">{getRelationshipGoalLabel(profile.relationshipGoal)}</p>
              </div>
            )}
            {profile.attachmentStyle && (
              <div>
                <p className="text-sm text-foreground-subtle mb-1">Attachment Style</p>
                <p className="text-foreground font-medium">{profile.attachmentStyle}</p>
              </div>
            )}
            {profile.communicationStyle && (
              <div>
                <p className="text-sm text-foreground-subtle mb-1">Communication Style</p>
                <p className="text-foreground font-medium">{profile.communicationStyle}</p>
              </div>
            )}
            {profile.conflictResolution && (
              <div>
                <p className="text-sm text-foreground-subtle mb-1">Conflict Resolution</p>
                <p className="text-foreground font-medium">{profile.conflictResolution}</p>
              </div>
            )}
            {profile.loveLanguage && (
              <div>
                <p className="text-sm text-foreground-subtle mb-1">Love Language</p>
                <p className="text-foreground font-medium">{profile.loveLanguage}</p>
              </div>
            )}
            {profile.emotionalAvailability && (
              <div>
                <p className="text-sm text-foreground-subtle mb-1">Emotional Availability</p>
                <p className="text-foreground font-medium">{profile.emotionalAvailability}</p>
              </div>
            )}
          </div>
          
          {profile.lifePriorities && profile.lifePriorities.length > 0 && (
            <div className="mt-6">
              <p className="text-sm text-foreground-subtle mb-2">Life Priorities</p>
              <div className="flex flex-wrap gap-2">
                {profile.lifePriorities.map((priority, i) => (
                  <span key={i} className="px-3 py-1 bg-background-tertiary text-foreground-muted text-sm rounded-full">
                    {priority}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {profile.interests && profile.interests.length > 0 && (
            <div className="mt-6">
              <p className="text-sm text-foreground-subtle mb-2">Interests</p>
              <div className="flex flex-wrap gap-2">
                {profile.interests.map((interest, i) => (
                  <span key={i} className="px-3 py-1 bg-background-tertiary text-foreground-muted text-sm rounded-full">
                    {interest}
                  </span>
                ))}
              </div>
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-surface rounded-2xl p-6"
        >
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-400" />
            Verification Status
          </h2>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Identity Verified</span>
              <BadgeCheck className="w-5 h-5 text-green-400" />
            </div>
            {profile.linkedInVerified && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">LinkedIn Verified</span>
                <div className="flex items-center gap-2">
                  <LinkedinIcon className="w-5 h-5 text-blue-400" />
                  <span className="text-green-400 text-sm">Verified</span>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Profile Status</span>
              <span className="text-green-400 text-sm">Active</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Member Since</span>
              <span className="text-foreground-subtle text-sm">
                {new Date(profile.joinedAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Card Verification Modal */}
      {showCardVerification && (
        <CardVerificationWall
          variant="modal"
          title="Verify Your Card to Connect"
          description="You've used your free matches. Verify your card to continue — identity check only, no charges."
          onSuccess={() => {
            setShowCardVerification(false);
            toast.success("Card verified! You can now connect.");
          }}
        />
      )}

      {/* Connect Modal */}
      <AnimatePresence>
        {showConnectModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowConnectModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface rounded-2xl p-6 max-w-md w-full"
            >
              <h3 className="text-xl font-bold text-foreground mb-4">Send Connection Request</h3>
              
              <div className="flex items-center gap-4 mb-6">
                <img
                  src={getAvatarUrl(profile)}
                  alt={profile.displayName}
                  className="w-16 h-16 rounded-full object-cover"
                  loading="lazy"
                  decoding="async"
                  onError={() => setImageError(true)}
                />
                <div>
                  <p className="text-foreground font-semibold">{profile.displayName}</p>
                  <p className="text-foreground-muted text-sm">{profile.age} years old</p>
                  {profile.matchScore && (
                    <p className="text-primary text-sm">{profile.matchScore}% Match</p>
                  )}
                </div>
              </div>
              
              <div className="bg-background-tertiary rounded-xl p-4 mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-foreground-muted">Your remaining connections:</span>
                  <span className={`font-bold ${currentUser!.remainingConnections > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {currentUser!.remainingConnections}
                  </span>
                </div>
                <p className="text-sm text-foreground-subtle">
                  {isMale ? 'Male users get 5 free connections. Upgrade to Premium for unlimited.' : 'Female users get 5 free connections per week.'}
                </p>
              </div>
              
              <div className="flex gap-3">
                <button onClick={() => setShowConnectModal(false)} className="flex-1 px-4 py-3 bg-background-tertiary text-foreground rounded-xl hover:bg-background-tertiary transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleConnect}
                  disabled={connectLoading || !canConnect}
                  className="flex-1 px-4 py-3 bg-primary text-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {connectLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Heart className="w-5 h-5" />
                      Send Request
                    </>
                  )}
                </button>
              </div>
              
              {isMale && !currentUser?.hasActiveSubscription && currentUser!.remainingConnections <= 0 && (
                <Link href="/dashboard/subscription" className="mt-4 flex items-center justify-center gap-2 text-primary hover:underline">
                  <Crown className="w-4 h-4" />
                  Upgrade to Premium
                </Link>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
