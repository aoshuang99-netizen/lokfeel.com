"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MessageCircle, AlertTriangle, Heart, Shield, Zap, Loader2, X, HelpCircle } from "lucide-react";
import { toast } from "sonner";

interface MatchDetailPageProps {
  params: Promise<{ id: string }>;
}

interface MatchData {
  id: string;
  otherUser: {
    id: string;
    name: string;
    age: number;
    avatar: string | null;
    city: string | null;
    bio: string | null;
    relationshipGoal: string | null;
    attachmentStyle: string | null;
    communicationStyle: string | null;
    loveLanguage: string | null;
  };
  matchScore: number;
  matchReason: string;
  conflictWarnings: string | null;
  compatibilityBreakdown: {
    attachment: number | null;
    communication: number | null;
    conflict: number | null;
    values: number | null;
    lifestyle: number | null;
  };
  status: string;
  myReaction: string | null;
  otherReaction: string | null;
  hasChatRoom: boolean;
  chatRoomId: string | null;
}

export default function MatchDetailPage({ params }: MatchDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const [match, setMatch] = useState<MatchData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReacting, setIsReacting] = useState(false);

  useEffect(() => {
    async function loadMatch() {
      try {
        const res = await fetch(`/api/matches/${id}`);
        if (!res.ok) throw new Error("Failed to load match");
        const data = await res.json();
        setMatch(data);
      } catch (error) {
        console.error("Load match error:", error);
        toast.error("Failed to load match details");
      } finally {
        setIsLoading(false);
      }
    }
    loadMatch();
  }, [id]);

  const handleReaction = async (reaction: "INTERESTED" | "PASS" | "MAYBE" | "BLOCK") => {
    setIsReacting(true);
    try {
      const res = await fetch(`/api/matches/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction }),
      });
      
      if (!res.ok) throw new Error("Failed to record reaction");
      
      const data = await res.json();
      toast.success(data.message);
      
      // Refresh match data
      const refreshRes = await fetch(`/api/matches/${id}`);
      const refreshData = await refreshRes.json();
      setMatch(refreshData);
      
      // If both interested and chat room created, redirect to chat
      if (reaction === "INTERESTED" && refreshData.hasChatRoom) {
        router.push(`/dashboard/chat/${refreshData.chatRoomId}`);
      }
    } catch (error) {
      console.error("Reaction error:", error);
      toast.error("Failed to record your response");
    } finally {
      setIsReacting(false);
    }
  };

  const dimensionLabels: Record<string, string> = {
    attachment: "Attachment Style",
    communication: "Communication",
    conflict: "Conflict Resolution",
    values: "Values & Goals",
    lifestyle: "Lifestyle",
  };

  const getReactionButton = () => {
    if (!match) return null;
    
    if (match.myReaction === "INTERESTED") {
      return (
        <div className="flex gap-2">
          {match.hasChatRoom ? (
            <Link
              href={`/dashboard/chat/${match.chatRoomId}`}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              <MessageCircle className="w-4 h-4" />
              Open Chat
            </Link>
          ) : (
            <button disabled className="btn-primary flex-1 opacity-50 cursor-not-allowed">
              <Heart className="w-4 h-4 inline mr-2" />
              Interested
            </button>
          )}
        </div>
      );
    }
    
    if (match.myReaction === "PASS") {
      return (
        <button disabled className="btn-secondary flex-1 opacity-50 cursor-not-allowed">
          <X className="w-4 h-4 inline mr-2" />
          Passed
        </button>
      );
    }

    return (
      <div className="flex gap-2">
        <button
          onClick={() => handleReaction("INTERESTED")}
          disabled={isReacting}
          className="btn-primary flex-1 flex items-center justify-center gap-2"
        >
          {isReacting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Heart className="w-4 h-4" />}
          Interested
        </button>
        <button
          onClick={() => handleReaction("MAYBE")}
          disabled={isReacting}
          className="btn-secondary flex items-center justify-center gap-2 px-4"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
        <button
          onClick={() => handleReaction("PASS")}
          disabled={isReacting}
          className="btn-ghost flex items-center justify-center gap-2 px-4"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!match) {
    return (
      <div className="max-w-4xl mx-auto text-center py-12">
        <p className="text-white/60">Match not found</p>
        <Link href="/dashboard/matches" className="btn-primary mt-4 inline-block">
          Back to Matches
        </Link>
      </div>
    );
  }

  const overallScore = Math.round(match.matchScore);
  const otherUser = match.otherUser;
  
  // Parse conflict warnings if exists
  const warnings = match.conflictWarnings ? JSON.parse(match.conflictWarnings) : [];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back Button */}
      <Link
        href="/dashboard/matches"
        className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Matches
      </Link>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Profile Card */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-card overflow-hidden">
            <div className="relative h-80">
              <img
                src={otherUser.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${otherUser.id}`}
                alt={otherUser.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              <div className="absolute bottom-4 left-4 right-4">
                <h2 className="text-2xl font-bold text-white">{otherUser.name}, {otherUser.age}</h2>
                <p className="text-white/60 text-sm">{otherUser.city || "Location unknown"}</p>
              </div>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-white/80 text-sm">{otherUser.bio || "No bio yet"}</p>

              <div className="flex flex-wrap gap-2">
                {otherUser.attachmentStyle && (
                  <span className="text-xs px-3 py-1 rounded-full bg-white/5 text-white/80">
                    {otherUser.attachmentStyle}
                  </span>
                )}
                {otherUser.communicationStyle && (
                  <span className="text-xs px-3 py-1 rounded-full bg-white/5 text-white/80">
                    {otherUser.communicationStyle}
                  </span>
                )}
                {otherUser.loveLanguage && (
                  <span className="text-xs px-3 py-1 rounded-full bg-white/5 text-white/80">
                    {otherUser.loveLanguage}
                  </span>
                )}
              </div>

              <div className="pt-4">
                {getReactionButton()}
              </div>
            </div>
          </div>

          {/* Quick Info */}
          <div className="glass-card p-4">
            <h3 className="font-semibold text-white mb-3">Details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-white/60">Relationship Goals</dt>
                <dd className="text-white">{otherUser.relationshipGoal || "Not specified"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/60">Attachment Style</dt>
                <dd className="text-white">{otherUser.attachmentStyle || "Not specified"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/60">Match Status</dt>
                <dd className="text-white capitalize">{match.status.toLowerCase()}</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Match Details */}
        <div className="lg:col-span-3 space-y-6">
          {/* Overall Score */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white">Overall Compatibility</h3>
              <span className="text-4xl font-bold text-gradient">{overallScore}%</span>
            </div>

            {/* Circular Progress */}
            <div className="flex justify-center mb-6">
              <div className="relative w-48 h-48">
                <svg className="w-full h-full circular-progress" viewBox="0 0 100 100">
                  <defs>
                    <linearGradient id="matchGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#c94d7a" />
                      <stop offset="100%" stopColor="#818cf8" />
                    </linearGradient>
                  </defs>
                  <circle
                    className="circular-progress-bg"
                    cx="50"
                    cy="50"
                    r="42"
                    strokeWidth="8"
                  />
                  <circle
                    className="circular-progress-fill"
                    cx="50"
                    cy="50"
                    r="42"
                    strokeWidth="8"
                    strokeDasharray={`${overallScore * 2.64} 264`}
                    stroke="url(#matchGradient)"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Heart className="w-12 h-12 text-primary" />
                </div>
              </div>
            </div>
          </div>

          {/* Dimension Scores */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Compatibility Breakdown</h3>
            <div className="space-y-4">
              {Object.entries(match.compatibilityBreakdown)
                .filter(([_, value]) => value !== null)
                .map(([key, value]) => (
                <div key={key}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-white/80">{dimensionLabels[key]}</span>
                    <span className="text-sm font-semibold text-white">{Math.round(value as number)}%</span>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all"
                      style={{ width: `${value}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Explanation */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold text-white">Why You Match</h3>
            </div>
            <p className="text-white/80 leading-relaxed mb-6">{match.matchReason}</p>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-success/10 border border-success/20 rounded-xl p-4">
                <h4 className="font-semibold text-success mb-2 flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Compatibility Strengths
                </h4>
                <p className="text-sm text-white/80">
                  Based on your relationship blueprints, you share strong alignment in 
                  attachment styles and communication preferences.
                </p>
              </div>

              {warnings.length > 0 && (
                <div className="bg-warning/10 border border-warning/20 rounded-xl p-4">
                  <h4 className="font-semibold text-warning mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Considerations
                  </h4>
                  <ul className="space-y-2">
                    {warnings.map((warning: string, idx: number) => (
                      <li key={idx} className="text-sm text-white/80 flex items-start gap-2">
                        <span className="text-warning mt-1">•</span>
                        {warning}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
