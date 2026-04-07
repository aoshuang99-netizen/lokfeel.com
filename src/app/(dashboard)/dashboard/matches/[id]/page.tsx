"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, MessageCircle, AlertTriangle, Heart, Shield, Zap } from "lucide-react";

interface MatchDetailPageProps {
  params: Promise<{ id: string }>;
}

const mockMatchData = {
  id: "1",
  name: "Sarah",
  age: 28,
  image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=500&fit=crop",
  bio: "Adventure seeker. Book lover. Coffee enthusiast. Looking for someone to explore life with.",
  location: "San Francisco, CA",
  isOnline: true,
  lastActive: "Active now",
  dimensions: {
    overall: 94,
    attachment: 92,
    communication: 88,
    conflict: 85,
    values: 96,
    lifestyle: 89,
  },
  explanation: "You and Sarah share a remarkable alignment in relationship values and attachment security. Both of you exhibit secure attachment patterns, meaning you both feel comfortable with intimacy while maintaining healthy independence. Your communication preferences are notably similar — you both value direct, honest conversations over passive-aggressive behavior.",
  strengths: [
    "Both have secure attachment styles, creating a stable foundation",
    "Aligned values around family, career, and personal growth",
    "Complementary communication styles that balance directness with empathy",
    "Shared enthusiasm for adventure and trying new experiences",
  ],
  warnings: [
    "Both have busy careers — need to schedule intentional connection time",
    "Similar perfectionist tendencies might create stress during conflict",
  ],
  profile: {
    traits: ["Adventurous", "Emotionally intelligent", "Open-minded", "Ambitious"],
    interests: ["Travel", "Reading", "Hiking", "Cooking", "Live music"],
    relationshipGoals: "Long-term partnership, eventual family",
    attachmentStyle: "Secure",
  },
};

export default function MatchDetailPage({ params }: MatchDetailPageProps) {
  const { id } = use(params);
  const match = mockMatchData;

  const dimensionLabels = {
    attachment: "Attachment Style",
    communication: "Communication",
    conflict: "Conflict Resolution",
    values: "Values & Goals",
    lifestyle: "Lifestyle",
  };

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
                src={match.image}
                alt={match.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              {match.isOnline && (
                <span className="absolute top-4 left-4 flex items-center gap-2 badge badge-success">
                  <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                  Online
                </span>
              )}
              <div className="absolute bottom-4 left-4 right-4">
                <h2 className="text-2xl font-bold text-white">{match.name}, {match.age}</h2>
                <p className="text-white/60 text-sm">{match.location}</p>
              </div>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-white/80 text-sm">{match.bio}</p>

              <div className="flex flex-wrap gap-2">
                {match.profile.traits.map((trait, idx) => (
                  <span key={idx} className="text-xs px-3 py-1 rounded-full bg-white/5 text-white/80">
                    {trait}
                  </span>
                ))}
              </div>

              <div className="pt-4 flex gap-2">
                <Link
                  href={`/dashboard/chat/${id}`}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-4 h-4" />
                  Connect
                </Link>
                <button className="btn-secondary p-3">
                  <Heart className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Quick Info */}
          <div className="glass-card p-4">
            <h3 className="font-semibold text-white mb-3">Details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-white/60">Relationship Goals</dt>
                <dd className="text-white">{match.profile.relationshipGoals}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/60">Attachment Style</dt>
                <dd className="text-white">{match.profile.attachmentStyle}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/60">Last Active</dt>
                <dd className="text-white">{match.lastActive}</dd>
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
              <span className="text-4xl font-bold text-gradient">{match.dimensions.overall}%</span>
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
                    strokeDasharray={`${match.dimensions.overall * 2.64} 264`}
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
              {(Object.keys(match.dimensions) as Array<keyof typeof match.dimensions>).filter(k => k !== 'overall').map((key) => (
                <div key={key}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-white/80">{dimensionLabels[key as keyof typeof dimensionLabels]}</span>
                    <span className="text-sm font-semibold text-white">{match.dimensions[key]}%</span>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all"
                      style={{ width: `${match.dimensions[key]}%` }}
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
            <p className="text-white/80 leading-relaxed mb-6">{match.explanation}</p>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-success/10 border border-success/20 rounded-xl p-4">
                <h4 className="font-semibold text-success mb-2 flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Strengths
                </h4>
                <ul className="space-y-2">
                  {match.strengths.map((strength, idx) => (
                    <li key={idx} className="text-sm text-white/80 flex items-start gap-2">
                      <span className="text-success mt-1">•</span>
                      {strength}
                    </li>
                  ))}
                </ul>
              </div>

              {match.warnings.length > 0 && (
                <div className="bg-warning/10 border border-warning/20 rounded-xl p-4">
                  <h4 className="font-semibold text-warning mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Considerations
                  </h4>
                  <ul className="space-y-2">
                    {match.warnings.map((warning, idx) => (
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
