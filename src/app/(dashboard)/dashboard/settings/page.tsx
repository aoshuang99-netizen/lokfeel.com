"use client";

import { useState } from "react";
import { User, Bell, Shield, Trash2, Download, Save, Check } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("account");
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [saved, setSaved] = useState(false);

  const [settings, setSettings] = useState({
    // Account
    email: "alex@example.com",
    name: "Alex Chen",
    newPassword: "",
    confirmPassword: "",
    
    // Notifications
    emailNotifications: true,
    pushNotifications: true,
    matchNotifications: true,
    messageNotifications: true,
    marketingEmails: false,
    
    // Privacy
    profileVisibility: "visible",
    showOnlineStatus: true,
    readReceipts: false,
    showDistance: true,
  });

  const tabs = [
    { id: "account", label: "Account", icon: User },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "privacy", label: "Privacy", icon: Shield },
  ];

  const handleChange = (field: string, value: boolean | string) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleExportData = async () => {
    setShowExportDialog(false);
    // In production, this would trigger a data export
    alert("Your data export has been initiated. You'll receive an email when it's ready.");
  };

  const handleDeleteAccount = () => {
    setShowDeleteDialog(false);
    // In production, this would initiate account deletion
    alert("Account deletion initiated. You'll receive a confirmation email.");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-white/60">Manage your account preferences</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all ${
              activeTab === tab.id
                ? "border-primary text-white"
                : "border-transparent text-white/60 hover:text-white"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Account Settings */}
      {activeTab === "account" && (
        <div className="space-y-6">
          <div className="glass-card p-6 space-y-6">
            <h2 className="text-lg font-semibold text-white">Account Information</h2>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Full Name</label>
                <input
                  type="text"
                  value={settings.name}
                  onChange={(e) => handleChange("name", e.target.value)}
                  className="input-feeld"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Email Address</label>
                <input
                  type="email"
                  value={settings.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  className="input-feeld"
                />
              </div>
            </div>
          </div>

          <div className="glass-card p-6 space-y-6">
            <h2 className="text-lg font-semibold text-white">Change Password</h2>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">New Password</label>
                <input
                  type="password"
                  value={settings.newPassword}
                  onChange={(e) => handleChange("newPassword", e.target.value)}
                  className="input-feeld"
                  placeholder="Leave blank to keep current"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Confirm Password</label>
                <input
                  type="password"
                  value={settings.confirmPassword}
                  onChange={(e) => handleChange("confirmPassword", e.target.value)}
                  className="input-feeld"
                  placeholder="Confirm new password"
                />
              </div>
            </div>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Danger Zone</h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl bg-white/5">
                <div>
                  <p className="font-medium text-white">Export Your Data</p>
                  <p className="text-sm text-white/60">Download all your data in a portable format</p>
                </div>
                <button
                  onClick={() => setShowExportDialog(true)}
                  className="btn-secondary flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl bg-error/10 border border-error/20">
                <div>
                  <p className="font-medium text-white">Delete Account</p>
                  <p className="text-sm text-white/60">Permanently delete your account and all data</p>
                </div>
                <button
                  onClick={() => setShowDeleteDialog(true)}
                  className="btn-secondary flex items-center gap-2 text-error border-error/30 hover:bg-error/10"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notification Settings */}
      {activeTab === "notifications" && (
        <div className="glass-card p-6 space-y-6">
          <h2 className="text-lg font-semibold text-white">Notification Preferences</h2>

          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-medium text-white/80 mb-4">Channel Preferences</h3>
              <div className="space-y-4">
                <label className="flex items-center justify-between p-4 rounded-xl bg-white/5 cursor-pointer">
                  <div>
                    <p className="font-medium text-white">Email Notifications</p>
                    <p className="text-sm text-white/60">Receive notifications via email</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.emailNotifications}
                    onChange={(e) => handleChange("emailNotifications", e.target.checked)}
                    className="w-5 h-5 rounded border-white/20 bg-white/5 text-primary"
                  />
                </label>

                <label className="flex items-center justify-between p-4 rounded-xl bg-white/5 cursor-pointer">
                  <div>
                    <p className="font-medium text-white">Push Notifications</p>
                    <p className="text-sm text-white/60">Receive push notifications on your device</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.pushNotifications}
                    onChange={(e) => handleChange("pushNotifications", e.target.checked)}
                    className="w-5 h-5 rounded border-white/20 bg-white/5 text-primary"
                  />
                </label>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-white/80 mb-4">Activity Notifications</h3>
              <div className="space-y-4">
                <label className="flex items-center justify-between p-4 rounded-xl bg-white/5 cursor-pointer">
                  <div>
                    <p className="font-medium text-white">New Matches</p>
                    <p className="text-sm text-white/60">Get notified when you have new matches</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.matchNotifications}
                    onChange={(e) => handleChange("matchNotifications", e.target.checked)}
                    className="w-5 h-5 rounded border-white/20 bg-white/5 text-primary"
                  />
                </label>

                <label className="flex items-center justify-between p-4 rounded-xl bg-white/5 cursor-pointer">
                  <div>
                    <p className="font-medium text-white">Messages</p>
                    <p className="text-sm text-white/60">Get notified for new messages</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.messageNotifications}
                    onChange={(e) => handleChange("messageNotifications", e.target.checked)}
                    className="w-5 h-5 rounded border-white/20 bg-white/5 text-primary"
                  />
                </label>

                <label className="flex items-center justify-between p-4 rounded-xl bg-white/5 cursor-pointer">
                  <div>
                    <p className="font-medium text-white">Marketing Emails</p>
                    <p className="text-sm text-white/60">Updates, tips, and special offers</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.marketingEmails}
                    onChange={(e) => handleChange("marketingEmails", e.target.checked)}
                    className="w-5 h-5 rounded border-white/20 bg-white/5 text-primary"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Privacy Settings */}
      {activeTab === "privacy" && (
        <div className="glass-card p-6 space-y-6">
          <h2 className="text-lg font-semibold text-white">Privacy Settings</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Profile Visibility</label>
              <select
                value={settings.profileVisibility}
                onChange={(e) => handleChange("profileVisibility", e.target.value)}
                className="input-feeld"
              >
                <option value="visible">Visible to everyone</option>
                <option value="matches">Only to matches</option>
                <option value="hidden">Hidden</option>
              </select>
            </div>

            <label className="flex items-center justify-between p-4 rounded-xl bg-white/5 cursor-pointer">
              <div>
                <p className="font-medium text-white">Show Online Status</p>
                <p className="text-sm text-white/60">Let others see when you're online</p>
              </div>
              <input
                type="checkbox"
                checked={settings.showOnlineStatus}
                onChange={(e) => handleChange("showOnlineStatus", e.target.checked)}
                className="w-5 h-5 rounded border-white/20 bg-white/5 text-primary"
              />
            </label>

            <label className="flex items-center justify-between p-4 rounded-xl bg-white/5 cursor-pointer">
              <div>
                <p className="font-medium text-white">Read Receipts</p>
                <p className="text-sm text-white/60">Show when you've read messages</p>
              </div>
              <input
                type="checkbox"
                checked={settings.readReceipts}
                onChange={(e) => handleChange("readReceipts", e.target.checked)}
                className="w-5 h-5 rounded border-white/20 bg-white/5 text-primary"
              />
            </label>

            <label className="flex items-center justify-between p-4 rounded-xl bg-white/5 cursor-pointer">
              <div>
                <p className="font-medium text-white">Show Distance</p>
                <p className="text-sm text-white/60">Display your distance from others</p>
              </div>
              <input
                type="checkbox"
                checked={settings.showDistance}
                onChange={(e) => handleChange("showDistance", e.target.checked)}
                className="w-5 h-5 rounded border-white/20 bg-white/5 text-primary"
              />
            </label>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="btn-primary flex items-center gap-2"
        >
          {isSaving ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving...
            </>
          ) : saved ? (
            <>
              <Check className="w-4 h-4" />
              Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Changes
            </>
          )}
        </button>
      </div>

      {/* Confirm Dialogs */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDeleteAccount}
        title="Delete Account"
        description="Are you sure you want to delete your account? This action cannot be undone and all your data will be permanently removed."
        confirmText="Delete Account"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        onConfirm={handleExportData}
        title="Export Your Data"
        description="We'll prepare your data for download. You'll receive an email when it's ready (usually within 24 hours)."
        confirmText="Start Export"
        variant="info"
      />
    </div>
  );
}
