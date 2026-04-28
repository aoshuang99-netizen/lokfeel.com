"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Search, Filter, Eye, Plus, X } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

const mockMatches = [
  { id: 1, user1: { name: "Sarah Chen", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100" }, user2: { name: "Alex", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100" }, score: 94, status: "accepted", createdAt: "2024-03-10", messages: 15 },
  { id: 2, user1: { name: "Michael Park", avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100" }, user2: { name: "Emma", avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100" }, score: 89, status: "pending", createdAt: "2024-03-12", messages: 0 },
  { id: 3, user1: { name: "James Lee", avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100" }, user2: { name: "Maya", avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100" }, score: 78, status: "expired", createdAt: "2024-03-08", messages: 2 },
  { id: 4, user1: { name: "David Kim", avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100" }, user2: { name: "Lisa", avatar: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=100" }, score: 85, status: "accepted", createdAt: "2024-03-15", messages: 8 },
  { id: 5, user1: { name: "Tom Brown", avatar: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=100" }, user2: { name: "Amy", avatar: "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=100" }, score: 92, status: "accepted", createdAt: "2024-03-16", messages: 23 },
];

export default function MatchesManagementPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 100]);
  const [selectedMatch, setSelectedMatch] = useState<typeof mockMatches[0] | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const filteredMatches = mockMatches.filter((match) => {
    const matchesSearch = match.user1.name.toLowerCase().includes(searchQuery.toLowerCase()) || match.user2.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || match.status === statusFilter;
    const matchesScore = match.score >= scoreRange[0] && match.score <= scoreRange[1];
    return matchesSearch && matchesStatus && matchesScore;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Match Management</h1>
          <p className="text-foreground-muted">View and manage all matches</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Create Match
        </button>
      </div>

      <div className="glass-card p-4 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-subtle" />
          <input type="text" placeholder="Search matches..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="input-feeld pl-11" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-feeld w-auto">
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-card-border bg-background-tertiary">
                <th className="text-left py-4 px-6 text-sm font-medium text-foreground-muted">Users</th>
                <th className="text-left py-4 px-6 text-sm font-medium text-foreground-muted">Score</th>
                <th className="text-left py-4 px-6 text-sm font-medium text-foreground-muted">Status</th>
                <th className="text-left py-4 px-6 text-sm font-medium text-foreground-muted">Created</th>
                <th className="text-left py-4 px-6 text-sm font-medium text-foreground-muted">Messages</th>
                <th className="text-right py-4 px-6 text-sm font-medium text-foreground-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredMatches.map((match) => (
                <tr key={match.id} className="border-b border-card-border hover:bg-background-tertiary">
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        <Image src={match.user1.avatar || '/default-avatar.png'} alt={match.user1.name} width={32} height={32} className="w-8 h-8 rounded-full border-2 border-card-border object-cover" />
                        <Image src={match.user2.avatar || '/default-avatar.png'} alt={match.user2.name} width={32} height={32} className="w-8 h-8 rounded-full border-2 border-card-border object-cover" />
                      </div>
                      <div>
                        <p className="text-foreground">{match.user1.name}</p>
                        <p className="text-xs text-foreground-muted">&</p>
                        <p className="text-foreground">{match.user2.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6">
                    <span className={`match-score ${match.score >= 90 ? "match-score-high" : match.score >= 80 ? "match-score-medium" : "match-score-low"}`}>{match.score}%</span>
                  </td>
                  <td className="py-4 px-6">
                    <span className={`badge ${match.status === "accepted" ? "badge-success" : match.status === "pending" ? "badge-warning" : "badge-error"}`}>{match.status}</span>
                  </td>
                  <td className="py-4 px-6 text-foreground-muted">{match.createdAt}</td>
                  <td className="py-4 px-6 text-foreground">{match.messages}</td>
                  <td className="py-4 px-6">
                    <div className="flex items-center justify-end gap-2">
                      <button className="p-2 rounded-lg hover:bg-background-tertiary text-foreground-muted hover:text-foreground"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => { setSelectedMatch(match); setShowCancelDialog(true); }} className="p-2 rounded-lg hover:bg-error/20 text-foreground-muted hover:text-error"><X className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-card-border flex items-center justify-between">
          <p className="text-sm text-foreground-muted">Showing {filteredMatches.length} matches</p>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showCancelDialog}
        onClose={() => setShowCancelDialog(false)}
        onConfirm={() => setShowCancelDialog(false)}
        title="Cancel Match"
        description={`Are you sure you want to cancel the match between ${selectedMatch?.user1.name} and ${selectedMatch?.user2.name}?`}
        confirmText="Cancel Match"
        variant="danger"
      />
    </div>
  );
}
