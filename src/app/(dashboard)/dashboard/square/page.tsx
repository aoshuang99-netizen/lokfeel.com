"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Users, 
  Bot, 
  Sparkles, 
  MapPin, 
  Briefcase,
  Heart,
  ChevronDown,
  Filter,
  Loader2,
  UserPlus,
  BadgeCheck,
  Tag,
  ArrowRightLeft
} from "lucide-react";

// LinkedIn icon component
function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );
}

// 用户类型
interface SquareUser {
  id: string;
  userId: string;
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
  isBot: boolean;
  isNew: boolean;
  joinedAt: string;
  popularity: number;
  botType?: string;
  activityLevel?: string;
  interests?: string[];
  matchScore?: number;
  matchReason?: string;
  profileCompletion?: number;
  tags?: string[];
  linkedInVerified?: boolean;
  verificationBadge?: string;
}

// 筛选类型
type FilterType = 'all' | 'bots' | 'new';
type GenderFilter = 'ALL' | 'MALE' | 'FEMALE' | 'NON_BINARY';

// 可用标签
const AVAILABLE_TAGS = [
  { value: '', label: 'All Tags', icon: Tag },
  { value: 'kink', label: 'Kink', icon: Heart },
  { value: 'gay', label: 'Gay', icon: Heart },
  { value: 'lesbian', label: 'Lesbian', icon: Heart },
  { value: 'bisexual', label: 'Bisexual', icon: Heart },
  { value: 'open', label: 'Open Relationship', icon: ArrowRightLeft },
  { value: 'travel', label: 'Travel', icon: MapPin },
  { value: 'fitness', label: 'Fitness', icon: Heart },
];

export default function SquarePage() {
  const router = useRouter();
  const [users, setUsers] = useState<SquareUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  
  // 筛选状态
  const [filter, setFilter] = useState<FilterType>('all');
  const [gender, setGender] = useState<GenderFilter>('ALL');
  const [ageRange, setAgeRange] = useState({ min: 18, max: 65 });
  const [selectedTag, setSelectedTag] = useState('');
  const [oppositeGender, setOppositeGender] = useState(true);
  
  // 分页
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalStats, setTotalStats] = useState({ totalBots: 0, totalNewUsers: 0 });
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  // 加载用户数据
  const loadUsers = useCallback(async (reset = false) => {
    const currentPage = reset ? 1 : page;
    if (reset) setLoading(true);
    else setLoadingMore(true);
    
    try {
      const params = new URLSearchParams({
        type: filter,
        gender,
        ageMin: ageRange.min.toString(),
        ageMax: ageRange.max.toString(),
        page: currentPage.toString(),
        limit: '20',
        oppositeGender: oppositeGender.toString(),
        ...(selectedTag && { tag: selectedTag }),
      });
      
      const res = await fetch(`/api/square?${params}`);
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.message);
      
      if (reset) {
        setUsers(data.data.users);
        setPage(2);
      } else {
        setUsers(prev => [...prev, ...data.data.users]);
        setPage(prev => prev + 1);
      }
      
      setHasMore(data.data.pagination.hasMore);
      setTotalStats(data.data.stats);
      if (data.data.availableTags) {
        setAvailableTags(data.data.availableTags);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filter, gender, ageRange, page, selectedTag, oppositeGender]);

  // 初始加载
  useEffect(() => {
    loadUsers(true);
  }, [filter, gender, ageRange.min, ageRange.max, selectedTag, oppositeGender]);

  // 性别标签
  const getGenderLabel = (gender: string) => {
    const labels: Record<string, string> = {
      MALE: 'He/Him',
      FEMALE: 'She/Her',
      NON_BINARY: 'They/Them',
      OTHER: 'Other',
    };
    return labels[gender] || gender;
  };

  // 活跃度标签
  const getActivityLabel = (level?: string) => {
    const labels: Record<string, { text: string; color: string }> = {
      GHOST: { text: 'Offline', color: 'bg-gray-500' },
      LOW: { text: 'Occasional', color: 'bg-yellow-500' },
      MEDIUM: { text: 'Active', color: 'bg-green-500' },
      HIGH: { text: 'Very Active', color: 'bg-emerald-500' },
      FULL: { text: 'Always Online', color: 'bg-primary' },
    };
    return labels[level || 'MEDIUM'] || { text: 'Active', color: 'bg-green-500' };
  };

  // 获取头像URL - 女用户使用真实头像
  const getAvatarUrl = (user: SquareUser) => {
    if (user.avatar) return user.avatar;
    
    // 女用户使用真实风格头像
    if (user.gender === 'FEMALE') {
      return `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.displayName}&gender=female&style=realistic`;
    }
    
    // 男用户和其他使用默认头像
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.displayName}`;
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <Users className="w-6 h-6 text-primary" />
                Square
              </h1>
              <p className="text-sm text-white/50 mt-1">
                Discover {totalStats.totalBots.toLocaleString()} digital users & {totalStats.totalNewUsers.toLocaleString()} new members
              </p>
            </div>
            
            {/* Stats */}
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-white/60">
                <Bot className="w-4 h-4" />
                <span>{totalStats.totalBots}</span>
              </div>
              <div className="flex items-center gap-1.5 text-white/60">
                <UserPlus className="w-4 h-4" />
                <span>{totalStats.totalNewUsers}</span>
              </div>
            </div>
          </div>
          
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mt-4">
            {/* Type Filter */}
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
              {(['all', 'bots', 'new'] as FilterType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    filter === type
                      ? 'bg-primary text-white'
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  {type === 'all' && 'All'}
                  {type === 'bots' && (
                    <span className="flex items-center gap-1">
                      <Bot className="w-3.5 h-3.5" />
                      Digital
                    </span>
                  )}
                  {type === 'new' && (
                    <span className="flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      New
                    </span>
                  )}
                </button>
              ))}
            </div>
            
            {/* Tag Filter */}
            <div className="relative">
              <select
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                className="appearance-none bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 pr-8 text-sm text-white focus:outline-none focus:border-primary"
              >
                {AVAILABLE_TAGS.map((tag) => (
                  <option key={tag.value} value={tag.value}>{tag.label}</option>
                ))}
              </select>
              <Tag className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
            </div>
            
            {/* Gender Toggle */}
            <button
              onClick={() => setOppositeGender(!oppositeGender)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                oppositeGender
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'bg-white/5 text-white/60 border border-white/10'
              }`}
              title={oppositeGender ? "Showing opposite gender only" : "Showing all genders"}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              {oppositeGender ? 'Opposite Gender' : 'All Genders'}
            </button>
            
            {/* Age Range */}
            <div className="flex items-center gap-2 text-sm text-white/60">
              <span>Age:</span>
              <input
                type="number"
                value={ageRange.min}
                onChange={(e) => setAgeRange(prev => ({ ...prev, min: parseInt(e.target.value) || 18 }))}
                className="w-14 bg-white/5 border border-white/10 rounded px-2 py-1 text-center text-white"
                min={18}
                max={100}
              />
              <span>-</span>
              <input
                type="number"
                value={ageRange.max}
                onChange={(e) => setAgeRange(prev => ({ ...prev, max: parseInt(e.target.value) || 65 }))}
                className="w-14 bg-white/5 border border-white/10 rounded px-2 py-1 text-center text-white"
                min={18}
                max={100}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-error">{error}</p>
            <button
              onClick={() => loadUsers(true)}
              className="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-20">
            <Users className="w-16 h-16 text-white/20 mx-auto mb-4" />
            <p className="text-white/60">No users found</p>
            <p className="text-sm text-white/40 mt-1">Try adjusting your filters</p>
          </div>
        ) : (
          <>
            {/* User Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {users.map((user) => (
                <Link
                  key={user.id}
                  href={`/dashboard/profile/${user.userId}`}
                  className="group relative bg-surface border border-white/5 rounded-2xl overflow-hidden hover:border-primary/30 transition-all hover:shadow-lg hover:shadow-primary/5"
                >
                  {/* Avatar */}
                  <div className="relative aspect-[4/5] overflow-hidden">
                    <img
                      src={getAvatarUrl(user)}
                      alt={user.displayName}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    
                    {/* Badges */}
                    <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                      {user.isBot && (
                        <span className="px-2 py-0.5 bg-primary/90 text-white text-xs font-medium rounded-full flex items-center gap-1">
                          <Bot className="w-3 h-3" />
                          AI
                        </span>
                      )}
                      {user.isNew && (
                        <span className="px-2 py-0.5 bg-green-500/90 text-white text-xs font-medium rounded-full flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          New
                        </span>
                      )}
                      {user.linkedInVerified && (
                        <span className="px-2 py-0.5 bg-blue-500/90 text-white text-xs font-medium rounded-full flex items-center gap-1">
                          <LinkedinIcon className="w-3 h-3" />
                          Verified
                        </span>
                      )}
                      {user.verificationBadge && (
                        <span className="px-2 py-0.5 bg-amber-500/90 text-white text-xs font-medium rounded-full flex items-center gap-1">
                          <BadgeCheck className="w-3 h-3" />
                          {user.verificationBadge}
                        </span>
                      )}
                    </div>
                    
                    {/* Activity Indicator (Bot only) */}
                    {user.isBot && user.activityLevel && (
                      <div className="absolute top-3 right-3">
                        <span className={`w-2.5 h-2.5 rounded-full ${getActivityLabel(user.activityLevel).color} animate-pulse`} />
                      </div>
                    )}
                    
                    {/* Match Score Badge */}
                    {user.matchScore && user.matchScore > 0 && (
                      <div className="absolute top-3 right-3">
                        <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                          user.matchScore >= 80 ? 'bg-green-500/90 text-white' :
                          user.matchScore >= 60 ? 'bg-yellow-500/90 text-white' :
                          'bg-white/20 text-white'
                        }`}>
                          {user.matchScore}% Match
                        </span>
                      </div>
                    )}
                    
                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    
                    {/* Info */}
                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      <h3 className="text-lg font-semibold text-white">
                        {user.displayName}, {user.age}
                      </h3>
                      <p className="text-sm text-white/70">
                        {getGenderLabel(user.gender)}
                      </p>
                      
                      {/* Details */}
                      <div className="mt-2 space-y-1">
                        {user.location && (
                          <p className="text-xs text-white/50 flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {user.location}
                          </p>
                        )}
                        {user.occupation && (
                          <p className="text-xs text-white/50 flex items-center gap-1">
                            <Briefcase className="w-3 h-3" />
                            {user.occupation}
                            {user.company && ` @ ${user.company}`}
                          </p>
                        )}
                      </div>
                      
                      {/* Tags */}
                      {user.tags && user.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {user.tags.slice(0, 3).map((tag, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 bg-primary/30 text-white/90 text-xs rounded"
                            >
                              {tag}
                            </span>
                          ))}
                          {user.tags.length > 3 && (
                            <span className="text-xs text-white/50">
                              +{user.tags.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                      
                      {/* Bio */}
                      {user.bio && (
                        <p className="mt-2 text-xs text-white/60 line-clamp-2">
                          {user.bio}
                        </p>
                      )}
                      
                      {/* Interests (Bot only) */}
                      {user.isBot && user.interests && user.interests.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {user.interests.slice(0, 3).map((interest, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 bg-white/10 text-white/70 text-xs rounded"
                            >
                              {interest}
                            </span>
                          ))}
                          {user.interests.length > 3 && (
                            <span className="text-xs text-white/50">
                              +{user.interests.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                      
                      {/* Popularity */}
                      <div className="mt-3 flex items-center gap-1 text-xs text-white/40">
                        <Heart className="w-3 h-3" />
                        <span>{user.popularity} matches</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            
            {/* Load More */}
            {hasMore && (
              <div className="mt-8 text-center">
                <button
                  onClick={() => loadUsers()}
                  disabled={loadingMore}
                  className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-medium hover:bg-white/10 transition-colors disabled:opacity-50 flex items-center gap-2 mx-auto"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" />
                      Load More
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
