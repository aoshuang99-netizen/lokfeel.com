"use client";

import { useState } from "react";
import Link from "next/link";
import { Heart, X, MessageCircle, Filter, ChevronRight } from "lucide-react";

type TabType = "new" | "accepted" | "passed" | "expired";

const mockMatches = [
  { id: 1, name: "Sarah", age: 28, image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop", score: 94, reason: "Secure attachment alignment + shared values", status: "new" },
  { id: 2, name: "Michael", age: 31, image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop", score: 89, reason: "Communication style match + complementary needs", status: "new" },
  { id: 3, name: "Emma", age: 29, image: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&h=200&fit=crop", score: 87, reason: "Balanced attachment patterns", status: "new" },
  { id: 4, name: "James", age: 33, image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop", score: 92, reason: "Emotional availability + growth mindset", status: "accepted" },
  { id: 5, name: "Maya", age: 27, image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop", score: 85, reason: "Shared relationship goals", status: "accepted" },
  { id: 6, name: "David", age: 30, image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop", score: 78, reason: "Some value alignment", status: "passed" },
  { id: 7, name: "Alex", age: 29, image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop", score: 82, reason: "Good baseline compatibility", status: "passed" },
];

export default function MatchesPage() {
  const [activeTab, setActiveTab] = useState<TabType>("new");
  const [matches, setMatches] = useState(mockMatches);

  const filteredMatches = matches.filter((m) => {
    if (activeTab === "new") return m.status === "new";
    if (activeTab === "accepted") return m.status === "accepted";
    if (activeTab === "passed") return m.status === "passed";
    if (activeTab === "expired") return m.status === "expired";
    return true;
  });

  const tabs: { id: TabType; label: string; count: number }[] = [
    { id: "new", label: "New", count: matches.filter((m) => m.status === "new").length },
    { id: "accepted", label: "Accepted", count: matches.filter((m) => m.status === "accepted").length },
    { id: "passed", label: "Passed", count: matches.filter((m) => m.status === "passed").length },
    { id: "expired", label: "Expired", count: matches.filter((m) => m.status === "expired").length },
  ];

  const handlePass = (id: number) => {
    setMatches((prev) => prev.map((m) => m.id === id ? { ...m, status: "passed" } : m));
  };

  const handleUndo = (id: number) => {
    setMatches((prev) => prev.map((m) => m.id === id ? { ...m, status: "new" } : m));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Your Matches</h1>
          <p className="text-white/60">Discover curated connections based on your blueprint</p>
        </div>
        <button className="btn-secondary flex items-center gap-2">
          <Filter className="w-4 h-4" />
          Filter
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-white border border-primary/30"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                activeTab === tab.id ? "bg-primary text-white" : "bg-white/10"
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Match Grid */}
      {filteredMatches.length > 0 ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMatches.map((match) => (
            <div key={match.id} className="glass-card overflow-hidden group">
              <Link href={`/dashboard/matches/${match.id}`}>
                <div className="relative h-56">
                  <img
                    src={match.image}
                    alt={match.name}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-3 right-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-white">{match.name}, {match.age}</h3>
                      <span className={`match-score ${match.score >= 90 ? 'match-score-high' : match.score >= 80 ? 'match-score-medium' : 'match-score-low'}`}>
                        {match.score}%
                      </span>
                    </div>
                  </div>
                </div>
              </Link>

              <div className="p-4">
                <p className="text-sm text-white/60 mb-4 line-clamp-2">{match.reason}</p>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-secondary rounded-full"
                        style={{ width: `${match.score}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-white/40">Compatibility Score</p>
                </div>

                <div className="flex gap-2">
                  {activeTab === "new" && (
                    <>
                      <Link
                        href={`/dashboard/matches/${match.id}`}
                        className="btn-primary flex-1 text-sm py-2"
                      >
                        Interested
                      </Link>
                      <button
                        onClick={() => handlePass(match.id)}
                        className="btn-secondary p-2"
                        title="Pass"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </>
                  )}
                  {activeTab === "accepted" && (
                    <>
                      <Link
                        href={`/dashboard/chat/${match.id}`}
                        className="btn-primary flex-1 text-sm py-2 flex items-center justify-center gap-2"
                      >
                        <MessageCircle className="w-4 h-4" />
                        Message
                      </Link>
                      <Link
                        href={`/dashboard/matches/${match.id}`}
                        className="btn-secondary flex-1 text-sm py-2"
                      >
                        Details
                      </Link>
                    </>
                  )}
                  {activeTab === "passed" && (
                    <button
                      onClick={() => handleUndo(match.id)}
                      className="btn-secondary w-full text-sm py-2"
                    >
                      Undo Pass
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
            <Heart className="w-8 h-8 text-white/30" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">No matches in this category</h3>
          <p className="text-white/60">
            {activeTab === "new" && "Check back soon for new matches!"}
            {activeTab === "accepted" && "Accept some matches to see them here"}
            {activeTab === "passed" && "Passes won't show up here"}
            {activeTab === "expired" && "No expired matches"}
          </p>
        </div>
      )}
    </div>
  );
}
