"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, BellOff, Check, X, Settings, MessageCircle, Heart, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface NotificationSettings {
  matchNotifications: boolean;
  messageNotifications: boolean;
  likeNotifications: boolean;
  vaultExpiryNotifications: boolean;
  marketingEmails: boolean;
  pushEnabled: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  matchNotifications: true,
  messageNotifications: true,
  likeNotifications: true,
  vaultExpiryNotifications: true,
  marketingEmails: false,
  pushEnabled: false,
};

export function PushNotificationManager() {
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>("default");

  useEffect(() => {
    loadSettings();
    checkPermission();
  }, []);

  const checkPermission = () => {
    if ("Notification" in window) {
      setPermissionStatus(Notification.permission);
      if (Notification.permission === "default") {
        // Show prompt after 10 seconds
        setTimeout(() => setShowPermissionPrompt(true), 10000);
      }
    }
  };

  const loadSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      
      if (data.profile) {
        setSettings({
          matchNotifications: data.profile.matchNotifications ?? true,
          messageNotifications: data.profile.messageNotifications ?? true,
          likeNotifications: data.profile.likeNotifications ?? true,
          vaultExpiryNotifications: data.profile.vaultExpiryNotifications ?? true,
          marketingEmails: data.profile.marketingEmails ?? false,
          pushEnabled: permissionStatus === "granted",
        });
      }
    } catch (error) {
      console.error("Load settings error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const requestPermission = async () => {
    if (!("Notification" in window)) {
      toast.error("Push notifications not supported");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setPermissionStatus(permission);
      
      if (permission === "granted") {
        setSettings((prev) => ({ ...prev, pushEnabled: true }));
        await saveSettings({ ...settings, pushEnabled: true });
        toast.success("Push notifications enabled!");
        setShowPermissionPrompt(false);
      } else {
        toast.error("Permission denied");
      }
    } catch (error) {
      toast.error("Failed to enable notifications");
    }
  };

  const saveSettings = async (newSettings: NotificationSettings) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchNotifications: newSettings.matchNotifications,
          messageNotifications: newSettings.messageNotifications,
          likeNotifications: newSettings.likeNotifications,
          vaultExpiryNotifications: newSettings.vaultExpiryNotifications,
          marketingEmails: newSettings.marketingEmails,
        }),
      });

      if (!res.ok) throw new Error("Failed to save");
      toast.success("Settings saved");
    } catch (error) {
      toast.error("Failed to save settings");
    }
  };

  const updateSetting = async (key: keyof NotificationSettings, value: boolean) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await saveSettings(newSettings);
  };

  // Permission Prompt Banner
  if (showPermissionPrompt && permissionStatus === "default") {
    return (
      <motion.div
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -50 }}
        className="fixed top-4 left-4 right-4 max-w-md mx-auto z-50"
      >
        <div className="glass-card p-4 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Bell className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h4 className="font-medium text-white mb-1">Enable Notifications</h4>
            <p className="text-sm text-white/60 mb-3">
              Get notified about new matches, messages, and when your Vault is about to expire.
            </p>
            <div className="flex gap-2">
              <button
                onClick={requestPermission}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Enable
              </button>
              <button
                onClick={() => setShowPermissionPrompt(false)}
                className="px-4 py-2 rounded-lg bg-white/10 text-white/70 text-sm hover:bg-white/20 transition-colors"
              >
                Not Now
              </button>
            </div>
          </div>
          <button
            onClick={() => setShowPermissionPrompt(false)}
            className="text-white/40 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Push Status */}
      <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              settings.pushEnabled ? "bg-green-500/20" : "bg-white/10"
            }`}>
              {settings.pushEnabled ? (
                <Bell className="w-5 h-5 text-green-400" />
              ) : (
                <BellOff className="w-5 h-5 text-white/40" />
              )}
            </div>
            <div>
              <h4 className="font-medium text-white">Push Notifications</h4>
              <p className="text-sm text-white/50">
                {settings.pushEnabled ? "Enabled" : "Disabled"}
              </p>
            </div>
          </div>
          {!settings.pushEnabled && permissionStatus !== "denied" && (
            <button
              onClick={requestPermission}
              className="px-4 py-2 rounded-lg bg-primary/20 text-primary text-sm hover:bg-primary/30 transition-colors"
            >
              Enable
            </button>
          )}
        </div>
      </div>

      {/* Notification Types */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-white/60 uppercase tracking-wider">Notify Me About</h4>
        
        <ToggleItem
          icon={Heart}
          label="New Matches"
          description="When someone likes you back"
          checked={settings.matchNotifications}
          onChange={(v) => updateSetting("matchNotifications", v)}
        />
        
        <ToggleItem
          icon={MessageCircle}
          label="New Messages"
          description="When you receive a message"
          checked={settings.messageNotifications}
          onChange={(v) => updateSetting("messageNotifications", v)}
        />
        
        <ToggleItem
          icon={Sparkles}
          label="New Likes"
          description="When someone likes your profile"
          checked={settings.likeNotifications}
          onChange={(v) => updateSetting("likeNotifications", v)}
        />
        
        <ToggleItem
          icon={Bell}
          label="Vault Expiry"
          description="When a conversation is about to expire"
          checked={settings.vaultExpiryNotifications}
          onChange={(v) => updateSetting("vaultExpiryNotifications", v)}
        />
      </div>

      {/* Email Settings */}
      <div className="pt-6 border-t border-white/10">
        <ToggleItem
          icon={Settings}
          label="Marketing Emails"
          description="Tips, updates, and promotional offers"
          checked={settings.marketingEmails}
          onChange={(v) => updateSetting("marketingEmails", v)}
        />
      </div>
    </div>
  );
}

function ToggleItem({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ElementType;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5 text-white/40" />
        <div>
          <p className="text-white font-medium">{label}</p>
          <p className="text-xs text-white/50">{description}</p>
        </div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`w-12 h-6 rounded-full transition-colors relative ${
          checked ? "bg-primary" : "bg-white/20"
        }`}
      >
        <motion.div
          className="w-5 h-5 rounded-full bg-white absolute top-0.5"
          animate={{ left: checked ? "26px" : "2px" }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      </button>
    </div>
  );
}

// Hook for showing notifications
export function usePushNotifications() {
  const showNotification = useCallback((title: string, options?: NotificationOptions) => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, {
        icon: "/icon-192x192.png",
        badge: "/icon-96x96.png",
        ...options,
      });
    }
  }, []);

  const showMatchNotification = useCallback((userName: string) => {
    showNotification("It's a Match! 🎉", {
      body: `You and ${userName} liked each other! Start chatting now.`,
      tag: "match",
    });
  }, [showNotification]);

  const showMessageNotification = useCallback((userName: string, message: string) => {
    showNotification(`New message from ${userName}`, {
      body: message,
      tag: "message",
    });
  }, [showNotification]);

  const showVaultExpiryNotification = useCallback((userName: string) => {
    showNotification("Vault Expiring Soon ⏰", {
      body: `Your conversation with ${userName} expires in 2 hours. Extend it if you want to keep chatting!`,
      tag: "vault",
    });
  }, [showNotification]);

  return {
    showNotification,
    showMatchNotification,
    showMessageNotification,
    showVaultExpiryNotification,
  };
}
