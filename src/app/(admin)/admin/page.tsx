"use client";

import { Users, Heart, MessageCircle, DollarSign, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const stats = [
  { id: 1, name: "Total Users", value: "12,847", change: "+12%", trend: "up", icon: Users },
  { id: 2, name: "Active Matches", value: "3,421", change: "+8%", trend: "up", icon: Heart },
  { id: 3, name: "Messages Today", value: "24,892", change: "+23%", trend: "up", icon: MessageCircle },
  { id: 4, name: "Revenue MTD", value: "$42,890", change: "+15%", trend: "up", icon: DollarSign },
];

const userGrowthData = [
  { month: "Jan", users: 3200 }, { month: "Feb", users: 4500 }, { month: "Mar", users: 5800 },
  { month: "Apr", users: 7200 }, { month: "May", users: 8900 }, { month: "Jun", users: 10500 },
  { month: "Jul", users: 11800 }, { month: "Aug", users: 12847 },
];

const matchCreationData = [
  { day: "Mon", matches: 145 }, { day: "Tue", matches: 189 }, { day: "Wed", matches: 201 },
  { day: "Thu", matches: 178 }, { day: "Fri", matches: 223 }, { day: "Sat", matches: 267 }, { day: "Sun", matches: 234 },
];

const conversionData = [
  { stage: "Sign Up", value: 12847 }, { stage: "Profile Complete", value: 9234 },
  { stage: "First Match", value: 6789 }, { stage: "Message Sent", value: 4521 }, { stage: "Premium", value: 1234 },
];

export default function AdminDashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
        <p className="text-white/60">Overview of your platform's performance</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.id} className="glass-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.trend === "up" ? "bg-success/20" : "bg-error/20"}`}>
                <stat.icon className={`w-5 h-5 ${stat.trend === "up" ? "text-success" : "text-error"}`} />
              </div>
              <span className={`flex items-center gap-1 text-sm font-medium ${stat.trend === "up" ? "text-success" : "text-error"}`}>
                {stat.trend === "up" ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                {stat.change}
              </span>
            </div>
            <p className="text-2xl font-bold text-white mb-1">{stat.value}</p>
            <p className="text-sm text-white/60">{stat.name}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-4">User Growth</h2>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={userGrowthData}>
              <defs>
                <linearGradient id="userGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#c94d7a" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#c94d7a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="month" stroke="rgba(255,255,255,0.4)" fontSize={12} />
              <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} />
              <Tooltip contentStyle={{ backgroundColor: "#1a1926", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
              <Area type="monotone" dataKey="users" stroke="#c94d7a" strokeWidth={2} fill="url(#userGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Matches This Week</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={matchCreationData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="day" stroke="rgba(255,255,255,0.4)" fontSize={12} />
              <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} />
              <Tooltip contentStyle={{ backgroundColor: "#1a1926", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
              <Bar dataKey="matches" fill="url(#barGrad)" radius={[4, 4, 0, 0]} />
              <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" />
                  <stop offset="100%" stopColor="#c94d7a" />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Conversion Funnel</h2>
        <div className="space-y-4">
          {conversionData.map((stage, idx) => {
            const percentage = (stage.value / conversionData[0].value) * 100;
            return (
              <div key={idx}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-white/80">{stage.stage}</span>
                  <span className="text-sm font-medium text-white">{stage.value.toLocaleString()} ({percentage.toFixed(1)}%)</span>
                </div>
                <div className="h-3 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-primary to-secondary rounded-full" style={{ width: `${percentage}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Recent Signups</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-3 px-4 text-sm font-medium text-white/60">User</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-white/60">Email</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-white/60">Role</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-white/60">Joined</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "Sarah Chen", email: "sarah@example.com", role: "user", joined: "2 hours ago" },
                { name: "Michael Park", email: "michael@example.com", role: "premium", joined: "4 hours ago" },
                { name: "Emma Wilson", email: "emma@example.com", role: "user", joined: "6 hours ago" },
                { name: "James Lee", email: "james@example.com", role: "premium", joined: "8 hours ago" },
              ].map((user, idx) => (
                <tr key={idx} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-3 px-4 text-white">{user.name}</td>
                  <td className="py-3 px-4 text-white/60">{user.email}</td>
                  <td className="py-3 px-4"><span className={`badge ${user.role === "premium" ? "badge-primary" : "badge-secondary"}`}>{user.role}</span></td>
                  <td className="py-3 px-4 text-white/60">{user.joined}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
