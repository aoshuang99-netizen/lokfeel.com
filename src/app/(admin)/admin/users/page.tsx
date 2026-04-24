"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Filter, MoreVertical, Ban, CheckCircle, Eye, UserPlus } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

const mockUsers = [
  { id: 1, name: "Sarah Chen", email: "sarah@example.com", role: "user", profileStatus: "complete", joined: "2024-01-15", matches: 12, lastActive: "2 hours ago", isVerified: true, isBanned: false },
  { id: 2, name: "Michael Park", email: "michael@example.com", role: "premium", profileStatus: "complete", joined: "2024-02-20", matches: 28, lastActive: "1 hour ago", isVerified: true, isBanned: false },
  { id: 3, name: "Emma Wilson", email: "emma@example.com", role: "user", profileStatus: "pending", joined: "2024-03-10", matches: 5, lastActive: "3 hours ago", isVerified: false, isBanned: false },
  { id: 4, name: "James Lee", email: "james@example.com", role: "premium", profileStatus: "complete", joined: "2024-01-05", matches: 45, lastActive: "Online", isVerified: true, isBanned: false },
  { id: 5, name: "David Kim", email: "david@example.com", role: "user", profileStatus: "incomplete", joined: "2024-03-18", matches: 0, lastActive: "1 day ago", isVerified: false, isBanned: false },
  { id: 6, name: "Lisa Wang", email: "lisa@example.com", role: "admin", profileStatus: "complete", joined: "2023-12-01", matches: 0, lastActive: "Online", isVerified: true, isBanned: false },
  { id: 7, name: "Tom Brown", email: "tom@example.com", role: "user", profileStatus: "complete", joined: "2024-02-28", matches: 18, lastActive: "5 hours ago", isVerified: true, isBanned: true },
];

export default function UsersPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedUser, setSelectedUser] = useState<typeof mockUsers[0] | null>(null);
  const [showBanDialog, setShowBanDialog] = useState(false);

  const filteredUsers = mockUsers.filter((user) => {
    const matchesSearch = user.name.toLowerCase().includes(searchQuery.toLowerCase()) || user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === "all" || user.role === roleFilter;
    const matchesStatus = statusFilter === "all" || (statusFilter === "banned" ? user.isBanned : !user.isBanned);
    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">User Management</h1>
          <p className="text-foreground-muted">Manage and monitor all users</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <UserPlus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-subtle" />
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-feeld pl-11"
          />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="input-feeld w-auto">
          <option value="all">All Roles</option>
          <option value="user">Users</option>
          <option value="premium">Premium</option>
          <option value="admin">Admin</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-feeld w-auto">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="banned">Banned</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-card-border bg-background-tertiary">
                <th className="text-left py-4 px-6 text-sm font-medium text-foreground-muted">User</th>
                <th className="text-left py-4 px-6 text-sm font-medium text-foreground-muted">Role</th>
                <th className="text-left py-4 px-6 text-sm font-medium text-foreground-muted">Profile</th>
                <th className="text-left py-4 px-6 text-sm font-medium text-foreground-muted">Matches</th>
                <th className="text-left py-4 px-6 text-sm font-medium text-foreground-muted">Last Active</th>
                <th className="text-left py-4 px-6 text-sm font-medium text-foreground-muted">Status</th>
                <th className="text-right py-4 px-6 text-sm font-medium text-foreground-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="border-b border-card-border hover:bg-background-tertiary transition-colors">
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-foreground font-semibold">
                        {user.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-foreground flex items-center gap-2">
                          {user.name}
                          {user.isVerified && <CheckCircle className="w-4 h-4 text-success" />}
                        </p>
                        <p className="text-sm text-foreground-muted">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6">
                    <span className={`badge ${user.role === "admin" ? "badge-secondary" : user.role === "premium" ? "badge-primary" : "badge-secondary"}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="py-4 px-6">
                    <span className={`badge ${user.profileStatus === "complete" ? "badge-success" : user.profileStatus === "pending" ? "badge-warning" : "badge-error"}`}>
                      {user.profileStatus}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-foreground">{user.matches}</td>
                  <td className="py-4 px-6 text-foreground-muted">{user.lastActive}</td>
                  <td className="py-4 px-6">
                    {user.isBanned ? (
                      <span className="badge badge-error">Banned</span>
                    ) : (
                      <span className="badge badge-success">Active</span>
                    )}
                  </td>
                  <td className="py-4 px-6">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/admin/users/${user.id}`} className="p-2 rounded-lg hover:bg-background-tertiary text-foreground-muted hover:text-foreground transition-colors">
                        <Eye className="w-4 h-4" />
                      </Link>
                      {!user.isBanned && user.role !== "admin" && (
                        <button
                          onClick={() => { setSelectedUser(user); setShowBanDialog(true); }}
                          className="p-2 rounded-lg hover:bg-error/20 text-foreground-muted hover:text-error transition-colors"
                        >
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-card-border flex items-center justify-between">
          <p className="text-sm text-foreground-muted">Showing {filteredUsers.length} of {mockUsers.length} users</p>
          <div className="flex gap-2">
            <button className="btn-secondary text-sm" disabled>Previous</button>
            <button className="btn-primary text-sm">Next</button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showBanDialog}
        onClose={() => setShowBanDialog(false)}
        onConfirm={() => setShowBanDialog(false)}
        title="Ban User"
        description={`Are you sure you want to ban ${selectedUser?.name}? They will lose access to their account.`}
        confirmText="Ban User"
        variant="warning"
      />
    </div>
  );
}
