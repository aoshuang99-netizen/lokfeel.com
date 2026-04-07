"use client";

import { useState } from "react";
import { Calendar, Download, TrendingUp, Users, Heart, MessageCircle, CreditCard } from "lucide-react";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const userSignupsData = [
  { month: "Jan", signups: 820 }, { month: "Feb", signups: 1240 }, { month: "Mar", signups: 1580 },
  { month: "Apr", signups: 1820 }, { month: "May", signups: 2100 }, { month: "Jun", signups: 2450 },
  { month: "Jul", signups: 2680 }, { month: "Aug", signups: 2890 },
];

const matchSuccessData = [
  { month: "Jan", created: 1200, success: 240 }, { month: "Feb", created: 1580, success: 340 },
  { month: "Mar", created: 1920, success: 420 }, { month: "Apr", created: 2150, success: 510 },
  { month: "May", created: 2480, success: 620 }, { month: "Jun", created: 2800, success: 720 },
  { month: "Jul", created: 3100, success: 840 }, { month: "Aug", created: 3421, success: 920 },
];

const messageVolumeData = [
  { day: "Mon", messages: 45000 }, { day: "Tue", messages: 52000 }, { day: "Wed", messages: 48000 },
  { day: "Thu", messages: 55000 }, { day: "Fri", messages: 62000 }, { day: "Sat", messages: 71000 }, { day: "Sun", messages: 68000 },
];

const subscriptionConversionData = [
  { name: "Free Users", value: 11613, color: "#818cf8" },
  { name: "Premium Users", value: 1234, color: "#c94d7a" },
];

const keyMetrics = [
  { label: "Avg Match Score", value: "84.2%", change: "+2.3%", trend: "up" },
  { label: "Match Success Rate", value: "26.8%", change: "+4.1%", trend: "up" },
  { label: "Msg Response Rate", value: "68.5%", change: "-1.2%", trend: "down" },
  { label: "Premium Conversion", value: "9.6%", change: "+0.8%", trend: "up" },
];

export default function AnalyticsPage() {
  const [dateRange, setDateRange] = useState("30d");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-white/60">Track your platform's performance</p>
        </div>
        <div className="flex gap-3">
          <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} className="input-feeld w-auto">
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="1y">Last year</option>
          </select>
          <button className="btn-secondary flex items-center gap-2">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {keyMetrics.map((metric, idx) => (
          <div key={idx} className="glass-card p-5">
            <p className="text-sm text-white/60 mb-2">{metric.label}</p>
            <p className="text-2xl font-bold text-white">{metric.value}</p>
            <p className={`text-sm mt-1 ${metric.trend === "up" ? "text-success" : "text-error"}`}>
              {metric.change} vs last period
            </p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* User Signups */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-4">User Signups</h2>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={userSignupsData}>
              <defs>
                <linearGradient id="signupGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#c94d7a" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#c94d7a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="month" stroke="rgba(255,255,255,0.4)" />
              <YAxis stroke="rgba(255,255,255,0.4)" />
              <Tooltip contentStyle={{ backgroundColor: "#1a1926", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
              <Area type="monotone" dataKey="signups" stroke="#c94d7a" fill="url(#signupGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Match Success Rate */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Match Success Rate</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={matchSuccessData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="month" stroke="rgba(255,255,255,0.4)" />
              <YAxis stroke="rgba(255,255,255,0.4)" />
              <Tooltip contentStyle={{ backgroundColor: "#1a1926", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
              <Legend />
              <Line type="monotone" dataKey="created" stroke="#818cf8" strokeWidth={2} name="Matches Created" />
              <Line type="monotone" dataKey="success" stroke="#c94d7a" strokeWidth={2} name="Successful" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Message Volume */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Message Volume</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={messageVolumeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="day" stroke="rgba(255,255,255,0.4)" />
              <YAxis stroke="rgba(255,255,255,0.4)" />
              <Tooltip contentStyle={{ backgroundColor: "#1a1926", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
              <Bar dataKey="messages" fill="url(#msgGrad)" radius={[4, 4, 0, 0]} />
              <defs>
                <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" />
                  <stop offset="100%" stopColor="#c94d7a" />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Subscription Conversion */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Subscription Distribution</h2>
          <div className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={subscriptionConversionData} cx="50%" cy="50%" innerRadius={80} outerRadius={120} paddingAngle={5} dataKey="value">
                  {subscriptionConversionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "#1a1926", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
