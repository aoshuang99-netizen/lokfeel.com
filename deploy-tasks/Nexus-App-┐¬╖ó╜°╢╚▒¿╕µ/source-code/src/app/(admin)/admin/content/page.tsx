"use client";

import { useState, useEffect } from "react";
import { FileText, Save, Eye, Plus, CheckSquare, Square, Trash2, Globe, Mail } from "lucide-react";

interface ContentItem {
  id: string;
  title: string;
  type: "page" | "template";
  status: "published" | "draft";
  lastUpdated: string;
  description?: string;
}

export default function ContentManagementPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "page" | "template">("all");

  // Load content list
  useEffect(() => {
    fetchItems();
  }, [filter]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const url = new URL("/api/admin/content", window.location.origin);
      if (filter !== "all") {
        url.searchParams.set("type", filter);
      }
      const res = await fetch(url.toString(), { credentials: "include" });
      const data = await res.json();
      if (data.success) {
        setItems(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch content:", error);
    } finally {
      setLoading(false);
    }
  };

  // Toggle select all
  const toggleSelectAll = () => {
    if (selectedKeys.size === items.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(items.map((i) => i.id)));
    }
  };

  // Toggle select single item
  const toggleSelect = (id: string) => {
    const next = new Set(selectedKeys);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedKeys(next);
  };

  // Batch operations
  const handleBatchAction = async (action: "publish" | "draft" | "delete") => {
    if (selectedKeys.size === 0) return;
    if (!confirm(`Confirm ${action === "delete" ? "delete" : action === "publish" ? "publish" : "set as draft"} ${selectedKeys.size} items?`)) return;

    try {
      const res = await fetch("/api/admin/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: Array.from(selectedKeys) }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedKeys(new Set());
        fetchItems();
      }
    } catch (error) {
      console.error("Batch action failed:", error);
    }
  };

  // Select item for editing
  const handleSelectItem = (item: ContentItem) => {
    setSelectedItem(item);
    setContent(`# ${item.title}\n\nContent here...`);
  };

  // Save content
  const handleSave = async () => {
    if (!selectedItem) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/admin/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedItem.id,
          title: selectedItem.title,
          content,
          status: selectedItem.status,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        fetchItems();
      }
    } catch (error) {
      console.error("Save failed:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const statusColor = (status: string) =>
    status === "published" ? "text-emerald-400 bg-emerald-500/10" : "text-amber-400 bg-amber-500/10";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Content Management</h1>
          <p className="text-[11px] text-foreground-muted">Manage static pages and email templates</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary flex items-center gap-2 text-xs px-3 py-1.5">
            <Plus className="w-3.5 h-3.5" />
            New Content
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-4 py-2 border-b border-card-border">
        <div className="flex gap-1">
          {[
            { key: "all", label: "All" },
            { key: "page", label: "Pages" },
            { key: "template", label: "Email Templates" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key as "all" | "page" | "template")}
              className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
                filter === key
                  ? "bg-primary text-white"
                  : "text-foreground-muted hover:text-foreground hover:bg-background-tertiary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="text-[11px] text-foreground-muted">
          Total: {items.length} items
        </div>
      </div>

      {/* Batch operation bar */}
      {selectedKeys.size > 0 && (
        <div className="flex items-center gap-3 py-2 px-3 bg-primary/10 border border-primary/20 rounded-lg">
          <span className="text-xs text-primary font-medium">Selected: {selectedKeys.size} items</span>
          <div className="flex-1" />
          <button
            onClick={() => handleBatchAction("publish")}
            className="text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
          >
            Batch Publish
          </button>
          <button
            onClick={() => handleBatchAction("draft")}
            className="text-[11px] px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
          >
            Batch Draft
          </button>
          <button
            onClick={() => handleBatchAction("delete")}
            className="text-[11px] px-2.5 py-1 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
          >
            <Trash2 className="w-3 h-3 inline mr-1" />
            Batch Delete
          </button>
        </div>
      )}

      {/* Main content area: table + editor */}
      <div className="grid lg:grid-cols-5 gap-4" style={{ minHeight: "calc(100vh - 280px)" }}>
        {/* Content list table */}
        <div className={`${selectedItem ? "lg:col-span-2" : "lg:col-span-5"} transition-all duration-300`}>
          <div className="glass-card overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[32px_1fr_80px_80px_100px] gap-2 px-3 py-2 bg-background-tertiary/50 border-b border-card-border text-[11px] font-medium text-foreground-muted uppercase tracking-wider">
              <div className="flex items-center">
                <button onClick={toggleSelectAll} className="text-foreground-muted hover:text-primary transition-colors">
                  {selectedKeys.size === items.length && items.length > 0 ? (
                    <CheckSquare className="w-3.5 h-3.5" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              <div>Title</div>
              <div>Type</div>
              <div>Status</div>
              <div>Updated</div>
            </div>

            {/* Table content */}
            {loading ? (
              <div className="py-8 text-center text-foreground-muted text-sm">Loading...</div>
            ) : (
              <div className="divide-y divide-card-border/50">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={`grid grid-cols-[32px_1fr_80px_80px_100px] gap-2 px-3 py-2 hover:bg-background-tertiary/30 transition-colors cursor-pointer ${
                      selectedItem?.id === item.id ? "bg-primary/10" : ""
                    }`}
                    onClick={() => handleSelectItem(item)}
                  >
                    <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleSelect(item.id)}
                        className="text-foreground-muted hover:text-primary transition-colors"
                      >
                        {selectedKeys.has(item.id) ? (
                          <CheckSquare className="w-3.5 h-3.5 text-primary" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      {item.type === "page" ? (
                        <Globe className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      ) : (
                        <Mail className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      )}
                      <span className="text-xs text-foreground truncate">{item.title}</span>
                    </div>
                    <div className="flex items-center">
                      <span className="text-[11px] text-foreground-muted">
                        {item.type === "page" ? "Page" : "Template"}
                      </span>
                    </div>
                    <div className="flex items-center">
                      <span className={`badge text-[10px] px-1.5 py-0.5 ${statusColor(item.status)}`}>
                        {item.status === "published" ? "Published" : "Draft"}
                      </span>
                    </div>
                    <div className="flex items-center text-[11px] text-foreground-muted">
                      {new Date(item.lastUpdated).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Editor panel */}
        {selectedItem && (
          <div className="lg:col-span-3">
            <div className="glass-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{selectedItem.title}</h2>
                  <p className="text-[11px] text-foreground-muted">Edit using Markdown</p>
                </div>
                <div className="flex gap-2">
                  <button className="btn-secondary flex items-center gap-1.5 text-[11px] px-2.5 py-1.5">
                    <Eye className="w-3.5 h-3.5" />
                    Preview
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="btn-primary flex items-center gap-1.5 text-[11px] px-3 py-1.5"
                  >
                    {isSaving ? (
                      <span className="w-3.5 h-3.5 border-2 border-card-border border-t-white rounded-full animate-spin" />
                    ) : saved ? (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        Saved
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        Save Changes
                      </>
                    )}
                  </button>
                </div>
              </div>

              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-[500px] bg-background-tertiary text-foreground placeholder:text-foreground-subtle p-3 rounded-lg border border-card-border focus:border-primary/50 focus:outline-none resize-none font-mono text-[11px] leading-relaxed"
                placeholder="Write content using Markdown..."
              />

              <div className="p-3 bg-background-tertiary/50 rounded-lg">
                <h4 className="text-[11px] font-medium text-foreground-muted mb-1.5">Markdown Tips</h4>
                <ul className="text-[11px] text-foreground-subtle space-y-0.5">
                  <li>Use # for headings, ## for subheadings</li>
                  <li>Use **text** for bold, *text* for italic</li>
                  <li>Use - for bullet lists</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
