"use client";

import { useState } from "react";
import { FileText, Save, Eye, Plus } from "lucide-react";

const pages = [
  { id: "about", title: "About Page", lastUpdated: "2024-03-15", status: "published" },
  { id: "privacy", title: "Privacy Policy", lastUpdated: "2024-03-10", status: "published" },
  { id: "terms", title: "Terms of Service", lastUpdated: "2024-03-10", status: "published" },
  { id: "cookies", title: "Cookie Policy", lastUpdated: "2024-02-20", status: "draft" },
];

const templates = [
  { id: "welcome", name: "Welcome Email", description: "Sent when users create an account" },
  { id: "verification", name: "Email Verification", description: "Sent when users need to verify email" },
  { id: "match-notification", name: "New Match Notification", description: "Sent when user gets a new match" },
  { id: "message-notification", name: "New Message Notification", description: "Sent when user receives a message" },
  { id: "subscription", name: "Subscription Confirmation", description: "Sent when user subscribes to Premium" },
];

const mockContent: Record<string, string> = {
  about: `# About Nexus

## Our Mission
We're building the future of relationship matching — one where technology helps people find genuine connection, not just endless options.

## Our Values
- Authentic Connection
- Safety First
- Quality Over Quantity
- Continuous Learning
`,
  privacy: `# Privacy Policy

## 1. Introduction
At Nexus, we believe your personal information belongs to you...

## 2. Information We Collect
We collect information you provide directly, including:
- Account information
- Profile information
- Messages and interactions
`,
  terms: `# Terms of Service

## 1. Agreement to Terms
By accessing or using our service, you agree to be bound by these Terms...

## 2. User Eligibility
You must be at least 18 years of age to use Nexus.
`,
};

export default function ContentManagementPage() {
  const [selectedPage, setSelectedPage] = useState("about");
  const [content, setContent] = useState(mockContent[selectedPage]);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handlePageSelect = (pageId: string) => {
    setSelectedPage(pageId);
    setContent(mockContent[pageId] || "");
  };

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    mockContent[selectedPage] = content;
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Content Management</h1>
          <p className="text-white/60">Manage static pages and email templates</p>
        </div>
        <button onClick={handleSave} disabled={isSaving} className="btn-primary flex items-center gap-2">
          {isSaving ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving...</> : saved ? <><Save className="w-4 h-4" />Saved!</> : <><Save className="w-4 h-4" />Save Changes</>}
        </button>
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1">
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-white/60 mb-3">Static Pages</h3>
            <div className="space-y-1">
              {pages.map((page) => (
                <button
                  key={page.id}
                  onClick={() => handlePageSelect(page.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    selectedPage === page.id ? "bg-primary/20 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{page.title}</p>
                    <p className="text-xs text-white/40">{page.lastUpdated}</p>
                  </div>
                  <span className={`badge ${page.status === "published" ? "badge-success" : "badge-warning"}`}>{page.status}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="glass-card p-4 mt-4">
            <h3 className="text-sm font-semibold text-white/60 mb-3">Email Templates</h3>
            <div className="space-y-1">
              {templates.map((template) => (
                <button
                  key={template.id}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-white/60 hover:bg-white/5 hover:text-white transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{template.name}</p>
                    <p className="text-xs text-white/40 truncate">{template.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Editor */}
        <div className="lg:col-span-3">
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">{pages.find((p) => p.id === selectedPage)?.title || "Email Template"}</h2>
                <p className="text-sm text-white/60">Edit content using Markdown</p>
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  Preview
                </button>
              </div>
            </div>

            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-[500px] bg-transparent text-white placeholder:text-white/40 p-4 rounded-xl border border-white/10 focus:border-primary/50 focus:outline-none resize-none font-mono text-sm"
              placeholder="Write your content here using Markdown..."
            />

            <div className="mt-4 p-4 bg-white/5 rounded-xl">
              <h4 className="text-sm font-medium text-white/60 mb-2">Tips</h4>
              <ul className="text-sm text-white/40 space-y-1">
                <li>• Use # for headings, ## for subheadings</li>
                <li>• Use **text** for bold, *text* for italic</li>
                <li>• Use - for bullet lists</li>
                <li>• Use [text](url) for links</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
