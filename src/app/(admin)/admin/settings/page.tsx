"use client";

import { useState } from "react";
import { Save, Plus, Trash2, Check } from "lucide-react";

interface ConfigItem {
  id: string;
  key: string;
  value: string;
  description: string;
  type: "string" | "number" | "boolean";
}

const mockConfig: ConfigItem[] = [
  { id: "1", key: "MIN_MATCH_SCORE", value: "70", description: "Minimum compatibility score for matches", type: "number" },
  { id: "2", key: "MAX_MATCHES_PER_WEEK", value: "5", description: "Maximum matches per user per week (Free tier)", type: "number" },
  { id: "3", key: "MATCH_EXPIRY_DAYS", value: "14", description: "Days before a match expires", type: "number" },
  { id: "4", key: "PREMIUM_PRICE_MONTHLY", value: "9.99", description: "Premium subscription monthly price (USD)", type: "number" },
  { id: "5", key: "PREMIUM_PRICE_YEARLY", value: "79.99", description: "Premium subscription yearly price (USD)", type: "number" },
  { id: "6", key: "MAX_MESSAGE_LENGTH", value: "2000", description: "Maximum characters per message", type: "number" },
  { id: "7", key: "PROFILE_COMPLETION_THRESHOLD", value: "60", description: "Minimum profile completion % for matching", type: "number" },
  { id: "8", key: "ENABLE_VERIFICATION", value: "true", description: "Require email verification for new accounts", type: "boolean" },
];

export default function SystemSettingsPage() {
  const [config, setConfig] = useState(mockConfig);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAddConfig = () => {
    if (!newKey || !newValue) return;
    const newConfig: ConfigItem = {
      id: Date.now().toString(),
      key: newKey,
      value: newValue,
      description: newDescription,
      type: newValue === "true" || newValue === "false" ? "boolean" : isNaN(Number(newValue)) ? "string" : "number",
    };
    setConfig([...config, newConfig]);
    setNewKey("");
    setNewValue("");
    setNewDescription("");
  };

  const handleDelete = (id: string) => {
    setConfig(config.filter((item) => item.id !== id));
  };

  const handleUpdate = (id: string, value: string) => {
    setConfig(config.map((item) => item.id === id ? { ...item, value } : item));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">System Settings</h1>
          <p className="text-foreground-muted">Configure platform parameters</p>
        </div>
        <button onClick={handleSave} disabled={isSaving} className="btn-primary flex items-center gap-2">
          {isSaving ? <><span className="w-4 h-4 border-2 border-card-border border-t-white rounded-full animate-spin" />Saving...</> : saved ? <><Check className="w-4 h-4" />Saved!</> : <><Save className="w-4 h-4" />Save Changes</>}
        </button>
      </div>

      {/* Matching Settings */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Matching Configuration</h2>
        <div className="space-y-4">
          {config.filter((c) => c.key.includes("MATCH")).map((item) => (
            <div key={item.id} className="flex items-start gap-4 p-4 bg-background-tertiary rounded-xl">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <code className="text-primary font-mono">{item.key}</code>
                  <span className={`badge ${item.type === "number" ? "badge-secondary" : "badge-primary"}`}>{item.type}</span>
                </div>
                <p className="text-sm text-foreground-muted mb-2">{item.description}</p>
                {item.type === "boolean" ? (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={item.value === "true"} onChange={(e) => handleUpdate(item.id, e.target.checked.toString())} className="w-5 h-5 rounded border-card-border bg-background-tertiary text-primary" />
                    <span className="text-foreground">{item.value === "true" ? "Enabled" : "Disabled"}</span>
                  </label>
                ) : (
                  <input type={item.type === "number" ? "number" : "text"} value={item.value} onChange={(e) => handleUpdate(item.id, e.target.value)} className="input-feeld max-w-xs" />
                )}
              </div>
              <button onClick={() => handleDelete(item.id)} className="p-2 rounded-lg hover:bg-error/20 text-foreground-muted hover:text-error"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing Settings */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Pricing Configuration</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {config.filter((c) => c.key.includes("PRICE")).map((item) => (
            <div key={item.id} className="p-4 bg-background-tertiary rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <code className="text-primary font-mono">{item.key}</code>
              </div>
              <p className="text-sm text-foreground-muted mb-2">{item.description}</p>
              <div className="flex items-center gap-2">
                <span className="text-foreground-muted">$</span>
                <input type="number" value={item.value} onChange={(e) => handleUpdate(item.id, e.target.value)} className="input-feeld max-w-[150px]" step="0.01" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* General Settings */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">General Settings</h2>
        <div className="space-y-4">
          {config.filter((c) => !c.key.includes("MATCH") && !c.key.includes("PRICE")).map((item) => (
            <div key={item.id} className="flex items-start gap-4 p-4 bg-background-tertiary rounded-xl">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <code className="text-primary font-mono">{item.key}</code>
                  <span className={`badge ${item.type === "number" ? "badge-secondary" : "badge-primary"}`}>{item.type}</span>
                </div>
                <p className="text-sm text-foreground-muted mb-2">{item.description}</p>
                {item.type === "boolean" ? (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={item.value === "true"} onChange={(e) => handleUpdate(item.id, e.target.checked.toString())} className="w-5 h-5 rounded border-card-border bg-background-tertiary text-primary" />
                    <span className="text-foreground">{item.value === "true" ? "Enabled" : "Disabled"}</span>
                  </label>
                ) : (
                  <input type={item.type === "number" ? "number" : "text"} value={item.value} onChange={(e) => handleUpdate(item.id, e.target.value)} className="input-feeld max-w-xs" />
                )}
              </div>
              <button onClick={() => handleDelete(item.id)} className="p-2 rounded-lg hover:bg-error/20 text-foreground-muted hover:text-error"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Add New Config */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Add New Configuration</h2>
        <div className="grid md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm text-foreground-muted mb-2">Key</label>
            <input type="text" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="CONFIG_KEY" className="input-feeld" />
          </div>
          <div>
            <label className="block text-sm text-foreground-muted mb-2">Value</label>
            <input type="text" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="value" className="input-feeld" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-foreground-muted mb-2">Description</label>
            <div className="flex gap-2">
              <input type="text" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Optional description" className="input-feeld flex-1" />
              <button onClick={handleAddConfig} className="btn-primary" disabled={!newKey || !newValue}><Plus className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
