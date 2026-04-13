"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  MapPin,
  Briefcase,
  GraduationCap,
  Heart,
  MessageCircle,
  Shield,
  BadgeCheck,
  Calendar,
  Clock,
  Star,
  Bot,
  Sparkles,
  Lock,
  Crown,
  Zap
} from "lucide-react";

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
  // 详细资料
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
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  // 加载用户资料
  useEffect(() => {
    const loadProfile = async () => {
      try {
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
    };

    if (userId) {
      loadProfile();
    }
  }, [userId]);

  // 发送连接申请
  const handleConnect = async () => {
    if (!profile || !currentUser) return;
    
    // 检查是否还有剩余次数
    if (currentUser.remainingConnections <= 0) {
      if (currentUser.gender === 'MALE') {
        // 男用户需要购买套餐
        router.push('/dashboard/subscription');
        return;
      }
      // 女用户免费次数用完
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
      
      if (!res.ok) throw new Error(data.message);
      
      // 成功，更新剩余次数
      setCurrentUser(prev => prev ? {
        ...prev,
        remainingConnections: prev.remainingConnections - 1
      } : null);
      
      setShowConnectModal(false);
      // 可以显示成功提示或跳转到匹配页面
      router.push('/dashboard/matches');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send connection request');
    } finally {
      setConnectLoading(false);
    }
  };

  // 获取头像URL
  const getAvatarUrl = (user: UserProfile) => {
    if (user.avatar) return user.avatar;
    
    // 女用户使用真实风格头像
    if (user.gender === 'FEMALE') {
      return `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.displayName}&gender=female&style=realistic`;
    }
    
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.displayName}`;
  };

  // 获取性别标签
  const getGenderLabel = (gender: string) => {
    const labels: Record<string, string> = {
      MALE: 'He/Him',
      FEMALE: 'She/Her',
      NON_BINARY: 'They/Them',
    };
    return labels[gender] || gender;
  };

  // 获取关系目标标签
  const getRelationshipGoalLabel = (goal?: string) => {
    const labels: Record<string, string> = {
      'LONG_TERM': 'Long-term Relationship',
      'DATING': 'Dating',
      'FRIENDSHIP': 'Friendship',
      'NOT_SURE': 'Figuring it out',
    };
    return labels[goal || ''] || goal;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-error mb-4">{error || 'Profile not found'}</p>
          <Link
            href="/dashboard/square"
            className="text-primary hover:underline flex items-center gap-2 justify-center"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Square
          </Link>
        </div>
      </div>
    );
  }

  const photos = profile.photos || [getAvatarUrl(profile)];
  const isMale = currentUser?.gender === 'MALE';
  const canConnect = currentUser && currentUser.remainingConnections > 0;

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/dashboard/square"
              className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              Back
            </Link>
            
            {/* Connection Status */}
            {currentUser && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-white/60">Remaining connections:</span>
                <span className={`font-semibold ${
                  currentUser.remainingConnections > 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {currentUser.remainingConnections}
                </span>
                {isMale && !currentUser.hasActiveSubscription && (
                  <span className="text-xs text-white/40">(Upgrade for more)</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Photo Gallery */}
        <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-surface mb-6">
          <img
            src={photos[activePhotoIndex]}
            alt={profile.displayName}
            className="w-full h-full object-cover"
          />
          
          {/* Photo Navigation */}
          {photos.length > 1 && (
            <>
              <button
                onClick={() => setActivePhotoIndex(prev => prev > 0 ? prev - 1 : photos.length - 1)}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors"
              >
                ←
              </button>
              <button
                onClick={() => setActivePhotoIndex(prev => prev < photos.length - 1 ? prev + 1 : 0)}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors"
              >
                →
              </button>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                {photos.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActivePhotoIndex(idx)}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      idx === activePhotoIndex ? 'bg-white' : 'bg-white/40'
                    }`}
                  />
                ))}
              </div>
            </>
          )}
          
          {/* Badges */}
          <div className="absolute top-4 left-4 flex flex-wrap gap-2">
            {profile.isBot && (
              <span className="px-3 py-1 bg-primary/90 text-white text-sm font-medium rounded-full flex items-center gap-1">
                <Bot className="w-4 h-4" />
                AI User
              </span>
            )}
            {profile.isNew && (
              <span className="px-3 py-1 bg-green-500/90 text-white text-sm font-medium rounded-full flex items-center gap-1">
                <Sparkles className="w-4 h-4" />
                New
              </span>
            )}
            {profile.linkedInVerified && (
              <span className="px-3 py-1 bg-blue-500/90 text-white text-sm font-medium rounded-full flex items-center gap-1">
                <LinkedinIcon className="w-4 h-4" />
                LinkedIn Verified
              </span>
            )}
            {profile.verificationBadge && (
              <span className="px-3 py-1 bg-amber-500/90 text-white text-sm font-medium rounded-full flex items-center gap-1">
                <BadgeCheck className="w-4 h-4" />
                {profile.verificationBadge}
              </span>
            )}
          </div>
          
          {/* Match Score */}
          {profile.matchScore && profile.matchScore > 0 && (
            <div className="absolute top-4 right-4">
              <div className={`px-4 py-2 rounded-full font-bold text-lg ${
                profile.matchScore >= 80 ? 'bg-green-500/90 text-white' :
                profile.matchScore >= 60 ? 'bg-yellow-500/90 text-white' :
                'bg-white/20 text-white backdrop-blur-sm'
              }`}>
                {profile.matchScore}% Match
              </div>
            </div>
          )}
        </div>

        {/* Basic Info */}
        <div className="bg-surface rounded-2xl p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-1">
                {profile.displayName}, {profile.age}
              </h1>
              <p className="text-white/60">{getGenderLabel(profile.gender)}</p>
            </div>
            
            {/* Connect Button */}
            <button
              onClick={() => setShowConnectModal(true)}
              disabled={!canConnect}
              className={`px-6 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all ${
                canConnect
                  ? 'bg-primary text-white hover:bg-primary/90'
                  : 'bg-white/10 text-white/40 cursor-not-allowed'
              }`}
            >
              <Heart className="w-5 h-5" />
              {canConnect ? 'Connect' : 'No Connections Left'}
            </button>
          </div>
          
          {/* Tags */}
          {profile.tags && profile.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {profile.tags.map((tag, i) => (
                <span
                  key={i}
                  className="px-3 py-1 bg-primary/20 text-primary text-sm rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          
          {/* Quick Info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {profile.location && (
              <div className="flex items-center gap-2 text-white/60">
                <MapPin className="w-4 h-4" />
                <span>{profile.location}</span>
              </div>
            )}
            {profile.occupation && (
              <div className="flex items-center gap-2 text-white/60">
                <Briefcase className="w-4 h-4" />
                <span>{profile.occupation}</span>
              </div>
            )}
            {profile.company && (
              <div className="flex items-center gap-2 text-white/60">
                <BuildingIcon className="w-4 h-4" />
                <span>{profile.company}</span>
              </div>
            )}
            {profile.education && (
              <div className="flex items-center gap-2 text-white/60">
                <GraduationCap className="w-4 h-4" />
                <span>{profile.education}</span>
              </div>
            )}
          </div>
        </div>

        {/* Bio */}
        {profile.bio && (
          <div className="bg-surface rounded-2xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-white mb-3">About</h2>
            <p className="text-white/70 leading-relaxed">{profile.bio}</p>
          </div>
        )}

        {/* Match Reason */}
        {profile.matchReason && (
          <div className="bg-primary/10 border border-primary/20 rounded-2xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-primary mb-3 flex items-center gap-2">
              <Star className="w-5 h-5" />
              Why You Might Match
            </h2>
            <p className="text-white/70 leading-relaxed">{profile.matchReason}</p>
          </div>
        )}

        {/* Relationship Details */}
        <div className="bg-surface rounded-2xl p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Relationship Profile</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {profile.relationshipGoal && (
              <div>
                <p className="text-sm text-white/40 mb-1">Looking for</p>
                <p className="text-white font-medium">{getRelationshipGoalLabel(profile.relationshipGoal)}</p>
              </div>
            )}
            
            {profile.attachmentStyle && (
              <div>
                <p className="text-sm text-white/40 mb-1">Attachment Style</p>
                <p className="text-white font-medium">{profile.attachmentStyle}</p>
              </div>
            )}
            
            {profile.communicationStyle && (
              <div>
                <p className="text-sm text-white/40 mb-1">Communication Style</p>
                <p className="text-white font-medium">{profile.communicationStyle}</p>
              </div>
            )}
            
            {profile.conflictResolution && (
              <div>
                <p className="text-sm text-white/40 mb-1">Conflict Resolution</p>
                <p className="text-white font-medium">{profile.conflictResolution}</p>
              </div>
            )}
            
            {profile.loveLanguage && (
              <div>
                <p className="text-sm text-white/40 mb-1">Love Language</p>
                <p className="text-white font-medium">{profile.loveLanguage}</p>
              </div>
            )}
            
            {profile.emotionalAvailability && (
              <div>
                <p className="text-sm text-white/40 mb-1">Emotional Availability</p>
                <p className="text-white font-medium">{profile.emotionalAvailability}</p>
              </div>
            )}
          </div>
          
          {/* Life Priorities */}
          {profile.lifePriorities && profile.lifePriorities.length > 0 && (
            <div className="mt-6">
              <p className="text-sm text-white/40 mb-2">Life Priorities</p>
              <div className="flex flex-wrap gap-2">
                {profile.lifePriorities.map((priority, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-white/5 text-white/70 text-sm rounded-full"
                  >
                    {priority}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {/* Interests */}
          {profile.interests && profile.interests.length > 0 && (
            <div className="mt-6">
              <p className="text-sm text-white/40 mb-2">Interests</p>
              <div className="flex flex-wrap gap-2">
                {profile.interests.map((interest, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-white/5 text-white/70 text-sm rounded-full"
                  >
                    {interest}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Verification Info */}
        <div className="bg-surface rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-400" />
            Verification Status
          </h2>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-white/60">Identity Verified</span>
              <BadgeCheck className="w-5 h-5 text-green-400" />
            </div>
            {profile.linkedInVerified && (
              <div className="flex items-center justify-between">
                <span className="text-white/60">LinkedIn Verified</span>
                <div className="flex items-center gap-2">
                  <LinkedinIcon className="w-5 h-5 text-blue-400" />
                  <span className="text-green-400 text-sm">Verified</span>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-white/60">Profile Status</span>
              <span className="text-green-400 text-sm">Active</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/60">Member Since</span>
              <span className="text-white/40 text-sm">
                {new Date(profile.joinedAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Connect Modal */}
      {showConnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">Send Connection Request</h3>
            
            <div className="flex items-center gap-4 mb-6">
              <img
                src={getAvatarUrl(profile)}
                alt={profile.displayName}
                className="w-16 h-16 rounded-full object-cover"
              />
              <div>
                <p className="text-white font-semibold">{profile.displayName}</p>
                <p className="text-white/60 text-sm">{profile.age} years old</p>
                {profile.matchScore && (
                  <p className="text-primary text-sm">{profile.matchScore}% Match</p>
                )}
              </div>
            </div>
            
            <div className="bg-white/5 rounded-xl p-4 mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white/60">Your remaining connections:</span>
                <span className={`font-bold ${
                  currentUser!.remainingConnections > 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {currentUser!.remainingConnections}
                </span>
              </div>
              
              {isMale ? (
                <p className="text-sm text-white/40">
                  Male users get 5 free connections. Upgrade to Premium for unlimited connections.
                </p>
              ) : (
                <p className="text-sm text-white/40">
                  Female users get 5 free connections per week.
                </p>
              )}
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setShowConnectModal(false)}
                className="flex-1 px-4 py-3 bg-white/5 text-white rounded-xl hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                disabled={connectLoading || !canConnect}
                className="flex-1 px-4 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {connectLoading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                ) : (
                  <>
                    <Heart className="w-5 h-5" />
                    Send Request
                  </>
                )}
              </button>
            </div>
            
            {isMale && !currentUser?.hasActiveSubscription && currentUser!.remainingConnections <= 0 && (
              <Link
                href="/dashboard/subscription"
                className="mt-4 flex items-center justify-center gap-2 text-primary hover:underline"
              >
                <Crown className="w-4 h-4" />
                Upgrade to Premium
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper icon component
function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
}
