"use client";

import Link from "next/link";
import { Heart, MessageCircle, User, Sparkles, TrendingUp, ChevronRight, Star } from "lucide-react";

const weeklyMatches = [
  {
    id: 1,
    name: "Sarah",
    age: 28,
    image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop",
    score: 94,
    reason: "You both have secure attachment styles and value emotional depth in relationships.",
    isNew: true,
  },
  {
    id: 2,
    name: "Michael",
    age: 31,
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop",
    score: 89,
    reason: "Your communication preferences align — both prefer direct, honest conversations.",
    isNew: true,
  },
  {
    id: 3,
    name: "Emma",
    age: 29,
    image: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&h=200&fit=crop",
    score: 87,
    reason: "Complementary attachment patterns — you bring stability, they bring adventure.",
    isNew: false,
  },
];

export default function DashboardPage() {
  const profileCompletion = 75;
  const unreadMatches = 2;
  const unreadMessages = 5;

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="relative">
        <div className="glow-orb glow-orb-primary w-64 h-64 -top-20 -right-20 opacity-20" />
        <div className="relative">
          <h1 className="text-3xl font-bold text-white mb-2">
            Welcome back, <span className="text-gradient">Alex</span>
          </h1>
          <p className="text-white/60">
            You have {unreadMatches} new matches waiting for you
          </p>
        </div>
      </div>

      {/* Subscription Banner */}
      <div className="glass-card border-primary/30 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Upgrade to Premium</h3>
              <p className="text-sm text-white/60">Unlock unlimited matches and advanced filters</p>
            </div>
          </div>
          <Link href="/dashboard/subscription" className="btn-primary">
            Learn More
          </Link>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Heart className="w-5 h-5 text-primary" />
            </div>
            <span className="text-white/60 text-sm">New Matches</span>
          </div>
          <p className="text-2xl font-bold text-white">{unreadMatches}</p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-secondary" />
            </div>
            <span className="text-white/60 text-sm">Unread Messages</span>
          </div>
          <p className="text-2xl font-bold text-white">{unreadMessages}</p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-success" />
            </div>
            <span className="text-white/60 text-sm">Profile Progress</span>
          </div>
          <p className="text-2xl font-bold text-white">{profileCompletion}%</p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
              <Star className="w-5 h-5 text-warning" />
            </div>
            <span className="text-white/60 text-sm">Your Tier</span>
          </div>
          <p className="text-2xl font-bold text-white">Free</p>
        </div>
      </div>

      {/* Weekly Matches */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-white">This Week's Matches</h2>
            <p className="text-sm text-white/60">Curated based on your relationship blueprint</p>
          </div>
          <Link href="/dashboard/matches" className="btn-ghost text-sm flex items-center gap-1">
            View All <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {weeklyMatches.map((match) => (
            <div key={match.id} className="glass-card overflow-hidden group">
              <div className="relative h-48">
                <img
                  src={match.image}
                  alt={match.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                {match.isNew && (
                  <span className="absolute top-3 right-3 badge badge-primary">New</span>
                )}
                <div className="absolute bottom-3 right-3">
                  <span className={`match-score ${match.score >= 90 ? 'match-score-high' : match.score >= 80 ? 'match-score-medium' : 'match-score-low'}`}>
                    {match.score}%
                  </span>
                </div>
              </div>

              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-white">{match.name}, {match.age}</h3>
                </div>
                <p className="text-sm text-white/60 mb-4 line-clamp-2">{match.reason}</p>

                <div className="flex gap-2">
                  <Link
                    href={`/dashboard/matches/${match.id}`}
                    className="btn-primary flex-1 text-sm py-2"
                  >
                    View Match
                  </Link>
                  <Link
                    href={`/dashboard/chat/${match.id}`}
                    className="btn-secondary flex-1 text-sm py-2"
                  >
                    Message
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Profile Completion CTA */}
      {profileCompletion < 100 && (
        <section className="glass-card p-6">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0">
              <User className="w-8 h-8 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white mb-1">Complete Your Profile</h3>
              <p className="text-sm text-white/60 mb-3">
                A complete profile increases your match quality by 73%
              </p>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all"
                    style={{ width: `${profileCompletion}%` }}
                  />
                </div>
                <span className="text-sm text-white/60">{profileCompletion}%</span>
              </div>
            </div>
            <Link href="/dashboard/profile" className="btn-primary whitespace-nowrap">
              Continue
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
