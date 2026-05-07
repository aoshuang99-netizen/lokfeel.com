"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { 
  User, 
  Bell, 
  Shield, 
  Trash2, 
  Download, 
  Save, 
  Check, 
  Loader2,
  Heart,
  Users,
  GitBranch,
  Zap,
  Coffee,
  UserPlus,
  ArrowRight,
  GitMerge,
  Sparkles,
  Circle,
  Shield as ShieldIcon,
  Plane,
  Dumbbell,
  Palette,
  Music,
  Utensils,
  Cpu,
  Book,
  Gamepad2,
  Mountain,
  Camera,
  Tag,
  AlertCircle,
  MapPin,
  Briefcase,
  Building2,
  Factory,
  Info,
  Infinity
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { motion, AnimatePresence } from "framer-motion";

// 可用标签配置
const AVAILABLE_TAGS = [
  // 关系类型
  { id: 'MONOGAMY', label: 'Monogamy', category: 'relationship', icon: Heart, description: 'Committed to one person' },
  { id: 'ETHICAL_NON_MONOGAMY', label: 'Ethical Non-Monogamy', category: 'relationship', icon: Users, description: 'Multiple consensual relationships' },
  { id: 'POLYAMORY', label: 'Polyamory', category: 'relationship', icon: GitBranch, description: 'Loving multiple people' },
  { id: 'KINK_BDSM', label: 'Kink/BDSM', category: 'relationship', icon: Zap, description: 'Alternative relationship dynamics' },
  { id: 'CASUAL_DATING', label: 'Casual Dating', category: 'relationship', icon: Coffee, description: 'No strings attached' },
  { id: 'FRIENDSHIP_FIRST', label: 'Friendship First', category: 'relationship', icon: UserPlus, description: 'Build connection gradually' },
  // 性取向
  { id: 'STRAIGHT', label: 'Straight', category: 'orientation', icon: ArrowRight, description: 'Attracted to opposite gender' },
  { id: 'GAY', label: 'Gay', category: 'orientation', icon: Heart, description: 'Attracted to same gender (male)' },
  { id: 'LESBIAN', label: 'Lesbian', category: 'orientation', icon: Heart, description: 'Attracted to same gender (female)' },
  { id: 'BISEXUAL', label: 'Bisexual', category: 'orientation', icon: GitMerge, description: 'Attracted to multiple genders' },
  { id: 'PANSEXUAL', label: 'Pansexual', category: 'orientation', icon: Sparkles, description: 'Attracted regardless of gender' },
  { id: 'QUEER', label: 'Queer', category: 'orientation', icon: Zap, description: 'Fluid or non-normative orientation' },
  { id: 'ASEXUAL', label: 'Asexual', category: 'orientation', icon: Circle, description: 'Little or no sexual attraction' },
  { id: 'DEMISEXUAL', label: 'Demisexual', category: 'orientation', icon: ShieldIcon, description: 'Attraction after emotional bond' },
  // 兴趣标签
  { id: 'TRAVEL', label: 'Travel', category: 'interest', icon: Plane, description: 'Love exploring new places' },
  { id: 'FITNESS', label: 'Fitness', category: 'interest', icon: Dumbbell, description: 'Active lifestyle enthusiast' },
  { id: 'ART', label: 'Art', category: 'interest', icon: Palette, description: 'Creative and artistic' },
  { id: 'MUSIC', label: 'Music', category: 'interest', icon: Music, description: 'Music lover' },
  { id: 'FOOD', label: 'Food', category: 'interest', icon: Utensils, description: 'Foodie and culinary explorer' },
  { id: 'TECH', label: 'Tech', category: 'interest', icon: Cpu, description: 'Technology enthusiast' },
  { id: 'READING', label: 'Reading', category: 'interest', icon: Book, description: 'Book lover' },
  { id: 'GAMING', label: 'Gaming', category: 'interest', icon: Gamepad2, description: 'Gamer' },
  { id: 'OUTDOORS', label: 'Outdoors', category: 'interest', icon: Mountain, description: 'Nature and outdoor activities' },
  { id: 'PHOTOGRAPHY', label: 'Photography', category: 'interest', icon: Camera, description: 'Photography enthusiast' },
];

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  relationship: { label: 'Relationship Type', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
  orientation: { label: 'Sexual Orientation', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  interest: { label: 'Interests', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
};

interface SettingsData {
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  } | null;
  profile: {
    displayName: string;
    bio: string | null;
    city: string | null;
    country: string | null;
    age: number;
    gender: string;
    sexuality: string;
    occupation: string | null;
    company: string | null;
    industry: string | null;
    selectedTags: string[];
    preferredAgeMin: number | null;
    preferredAgeMax: number | null;
    preferredGender: string | null;
    preferredDistance: number | null;
  } | null;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("profile");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 设置数据
  const [settings, setSettings] = useState<SettingsData>({
    user: null,
    profile: null,
  });
  
  // 表单状态
  const [formData, setFormData] = useState({
    name: "",
    displayName: "",
    bio: "",
    city: "",
    country: "US",
    age: 25,
    occupation: "",
    company: "",
    industry: "",
    selectedTags: [] as string[],
    preferredAgeMin: 18,
    preferredAgeMax: 50,
    preferredGender: "Any",
    preferredDistance: 50,
    emailNotifications: true,
    pushNotifications: true,
    matchNotifications: true,
    messageNotifications: true,
    marketingEmails: false,
    profileVisibility: "visible",
    showOnlineStatus: true,
    readReceipts: false,
    showDistance: true,
  });

  // 加载设置
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/settings');
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.message);
      
      setSettings(data);
      
      // 初始化表单数据
      if (data.user) {
        setFormData(prev => ({
          ...prev,
          name: data.user.name || "",
        }));
      }
      
      if (data.profile) {
        setFormData(prev => ({
          ...prev,
          displayName: data.profile.displayName || "",
          bio: data.profile.bio || "",
          city: data.profile.city || "",
          country: data.profile.country || "US",
          age: data.profile.age || 25,
          occupation: data.profile.occupation || "",
          company: data.profile.company || "",
          industry: data.profile.industry || "",
          selectedTags: data.profile.selectedTags || [],
          preferredAgeMin: data.profile.preferredAgeMin || 18,
          preferredAgeMax: data.profile.preferredAgeMax || 50,
          preferredGender: data.profile.preferredGender || "Any",
          preferredDistance: data.profile.preferredDistance || 50,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  // 标签选择处理
  const toggleTag = (tagId: string) => {
    setFormData(prev => {
      const currentTags = prev.selectedTags;
      if (currentTags.includes(tagId)) {
        return { ...prev, selectedTags: currentTags.filter(t => t !== tagId) };
      }
      if (currentTags.length >= 5) {
        return prev; // 最多5个
      }
      return { ...prev, selectedTags: [...currentTags, tagId] };
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          displayName: formData.displayName,
          bio: formData.bio,
          city: formData.city,
          country: formData.country,
          age: formData.age,
          occupation: formData.occupation,
          company: formData.company,
          industry: formData.industry,
          selectedTags: formData.selectedTags,
          preferredAgeMin: formData.preferredAgeMin,
          preferredAgeMax: formData.preferredAgeMax,
          preferredGender: formData.preferredGender,
          preferredDistance: formData.preferredDistance,
        }),
      });
      
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.message);
      
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportData = async () => {
    setShowExportDialog(false);
    toast.success("Your data export has been initiated. You'll receive an email when it's ready.");
  };

  const handleDeleteAccount = async () => {
    try {
      const res = await fetch('/api/settings', { method: 'DELETE' });
      if (res.ok) {
        toast.success("Account deleted successfully");
        window.location.href = '/';
      }
    } catch (err) {
      toast.error('Failed to delete account');
    }
    setShowDeleteDialog(false);
  };

  const tabs = [
    { id: "profile", label: "Profile", icon: User },
    { id: "preferences", label: "Matching Preferences", icon: Heart },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "privacy", label: "Privacy", icon: Shield },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-foreground-muted">Manage your profile and preferences</p>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-card-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-foreground-muted hover:text-foreground"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Profile Tab */}
      {activeTab === "profile" && (
        <div className="space-y-6">
          {/* Basic Info */}
          <div className="glass-card p-6 space-y-6">
            <h2 className="text-lg font-semibold text-foreground">Basic Information</h2>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Display Name</label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={(e) => handleChange("displayName", e.target.value)}
                  className="input-feeld w-full"
                  placeholder="Your display name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Age</label>
                <input
                  type="number"
                  value={formData.age}
                  onChange={(e) => handleChange("age", parseInt(e.target.value) || 18)}
                  className="input-feeld w-full"
                  min={18}
                  max={100}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Bio</label>
              <textarea
                value={formData.bio}
                onChange={(e) => handleChange("bio", e.target.value)}
                className="input-feeld w-full h-24 resize-none"
                placeholder="Tell others about yourself..."
                maxLength={500}
              />
              <p className="text-xs text-foreground-subtle mt-1">{formData.bio?.length || 0}/500</p>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  <MapPin className="w-4 h-4 inline mr-1" />
                  City
                </label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => handleChange("city", e.target.value)}
                  className="input-feeld w-full"
                  placeholder="Your city"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Country</label>
                <select
                  value={formData.country}
                  onChange={(e) => handleChange("country", e.target.value)}
                  className="input-feeld w-full"
                >
                  <option value="US">United States</option>
                  <option value="UK">United Kingdom</option>
                  <option value="CA">Canada</option>
                  <option value="AU">Australia</option>
                  <option value="DE">Germany</option>
                  <option value="FR">France</option>
                  <option value="JP">Japan</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          </div>

          {/* Professional Info */}
          <div className="glass-card p-6 space-y-6">
            <h2 className="text-lg font-semibold text-foreground">Professional Information</h2>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  <Briefcase className="w-4 h-4 inline mr-1" />
                  Occupation
                </label>
                <input
                  type="text"
                  value={formData.occupation}
                  onChange={(e) => handleChange("occupation", e.target.value)}
                  className="input-feeld w-full"
                  placeholder="Job title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  <Building2 className="w-4 h-4 inline mr-1" />
                  Company
                </label>
                <input
                  type="text"
                  value={formData.company}
                  onChange={(e) => handleChange("company", e.target.value)}
                  className="input-feeld w-full"
                  placeholder="Company name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  <Factory className="w-4 h-4 inline mr-1" />
                  Industry
                </label>
                <input
                  type="text"
                  value={formData.industry}
                  onChange={(e) => handleChange("industry", e.target.value)}
                  className="input-feeld w-full"
                  placeholder="Industry sector"
                />
              </div>
            </div>
          </div>

          {/* Tags Selection */}
          <div className="glass-card p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Tag className="w-5 h-5 text-primary" />
                  Your Tags
                </h2>
                <p className="text-sm text-foreground-muted mt-1">
                  Select up to 5 tags that describe you. These help us find better matches.
                </p>
              </div>
              <span className={`text-sm font-medium ${
                formData.selectedTags.length >= 5 ? 'text-amber-400' : 'text-foreground-muted'
              }`}>
                {formData.selectedTags.length}/5
              </span>
            </div>

            {formData.selectedTags.length >= 5 && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm flex items-center gap-2">
                <Info className="w-4 h-4" />
                Maximum 5 tags selected. Remove one to add another.
              </div>
            )}

            {/* Selected Tags */}
            {formData.selectedTags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <AnimatePresence>
                  {formData.selectedTags.map((tagId) => {
                    const tag = AVAILABLE_TAGS.find(t => t.id === tagId);
                    if (!tag) return null;
                    const Icon = tag.icon;
                    return (
                      <motion.button
                        key={tagId}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        onClick={() => toggleTag(tagId)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${
                          CATEGORY_LABELS[tag.category].color
                        } hover:opacity-80`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {tag.label}
                        <span className="ml-1 opacity-60">×</span>
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}

            {/* Available Tags by Category */}
            <div className="space-y-4">
              {['relationship', 'orientation', 'interest'].map((category) => (
                <div key={category}>
                  <h3 className="text-sm font-medium text-foreground-muted mb-3 uppercase tracking-wide">
                    {CATEGORY_LABELS[category].label}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {AVAILABLE_TAGS
                      .filter(tag => tag.category === category && !formData.selectedTags.includes(tag.id))
                      .map((tag) => {
                        const Icon = tag.icon;
                        const isDisabled = formData.selectedTags.length >= 5;
                        return (
                          <button
                            key={tag.id}
                            onClick={() => !isDisabled && toggleTag(tag.id)}
                            disabled={isDisabled}
                            title={tag.description}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                              isDisabled
                                ? 'bg-background-tertiary border-card-border text-foreground-subtle cursor-not-allowed'
                                : 'bg-background-tertiary border-card-border text-foreground-muted hover:bg-background-tertiary hover:border-card-border'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            {tag.label}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Matching Preferences Tab */}
      {activeTab === "preferences" && (
        <div className="glass-card p-6 space-y-6">
          <h2 className="text-lg font-semibold text-foreground">Matching Preferences</h2>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Preferred Age Range</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={formData.preferredAgeMin}
                  onChange={(e) => handleChange("preferredAgeMin", parseInt(e.target.value) || 18)}
                  className="input-feeld w-20 text-center"
                  min={18}
                  max={100}
                />
                <span className="text-foreground-muted">to</span>
                <input
                  type="number"
                  value={formData.preferredAgeMax}
                  onChange={(e) => handleChange("preferredAgeMax", parseInt(e.target.value) || 50)}
                  className="input-feeld w-20 text-center"
                  min={18}
                  max={100}
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Preferred Gender</label>
              <select
                value={formData.preferredGender}
                onChange={(e) => handleChange("preferredGender", e.target.value)}
                className="input-feeld w-full"
              >
                <option value="Any">Any</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="NON_BINARY">Non-binary</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Maximum Distance: {formData.preferredDistance} miles
            </label>
            <input
              type="range"
              value={formData.preferredDistance}
              onChange={(e) => handleChange("preferredDistance", parseInt(e.target.value))}
              className="w-full accent-primary"
              min={5}
              max={500}
              step={5}
            />
            <div className="flex justify-between text-xs text-foreground-subtle mt-1">
              <span>5 miles</span>
              <span>500 miles</span>
            </div>
          </div>
        </div>
      )}

      {/* Notifications Tab */}
      {activeTab === "notifications" && (
        <div className="glass-card p-6 space-y-6">
          <h2 className="text-lg font-semibold text-foreground">Notification Preferences</h2>

          <div className="space-y-4">
            {[
              { key: 'emailNotifications', label: 'Email Notifications', desc: 'Receive notifications via email' },
              { key: 'pushNotifications', label: 'Push Notifications', desc: 'Receive push notifications on your device' },
              { key: 'matchNotifications', label: 'New Matches', desc: 'Get notified when you have new matches' },
              { key: 'messageNotifications', label: 'Messages', desc: 'Get notified for new messages' },
              { key: 'marketingEmails', label: 'Marketing Emails', desc: 'Updates, tips, and special offers' },
            ].map((item) => (
              <label key={item.key} className="flex items-center justify-between p-4 rounded-xl bg-background-tertiary cursor-pointer hover:bg-background-tertiary transition-colors">
                <div>
                  <p className="font-medium text-foreground">{item.label}</p>
                  <p className="text-sm text-foreground-muted">{item.desc}</p>
                </div>
                <input
                  type="checkbox"
                  checked={formData[item.key as keyof typeof formData] as boolean}
                  onChange={(e) => handleChange(item.key, e.target.checked)}
                  className="w-5 h-5 rounded border-card-border bg-background-tertiary text-primary accent-primary"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Privacy Tab */}
      {activeTab === "privacy" && (
        <div className="space-y-6">
          <div className="glass-card p-6 space-y-6">
            <h2 className="text-lg font-semibold text-foreground">Privacy Settings</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Profile Visibility</label>
                <select
                  value={formData.profileVisibility}
                  onChange={(e) => handleChange("profileVisibility", e.target.value)}
                  className="input-feeld w-full"
                >
                  <option value="visible">Visible to everyone</option>
                  <option value="matches">Only to matches</option>
                  <option value="hidden">Hidden</option>
                </select>
              </div>

              {[
                { key: 'showOnlineStatus', label: 'Show Online Status', desc: 'Let others see when you\'re online' },
                { key: 'readReceipts', label: 'Read Receipts', desc: 'Show when you\'ve read messages' },
                { key: 'showDistance', label: 'Show Distance', desc: 'Display your distance from others' },
              ].map((item) => (
                <label key={item.key} className="flex items-center justify-between p-4 rounded-xl bg-background-tertiary cursor-pointer hover:bg-background-tertiary transition-colors">
                  <div>
                    <p className="font-medium text-foreground">{item.label}</p>
                    <p className="text-sm text-foreground-muted">{item.desc}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData[item.key as keyof typeof formData] as boolean}
                    onChange={(e) => handleChange(item.key, e.target.checked)}
                    className="w-5 h-5 rounded border-card-border bg-background-tertiary text-primary accent-primary"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Danger Zone */}
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Danger Zone</h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl bg-background-tertiary">
                <div>
                  <p className="font-medium text-foreground">Export Your Data</p>
                  <p className="text-sm text-foreground-muted">Download all your data in a portable format</p>
                </div>
                <button
                  onClick={() => setShowExportDialog(true)}
                  className="btn-secondary flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                <div>
                  <p className="font-medium text-foreground">Delete Account</p>
                  <p className="text-sm text-foreground-muted">Permanently delete your account and all data</p>
                </div>
                <button
                  onClick={() => setShowDeleteDialog(true)}
                  className="btn-secondary flex items-center gap-2 text-red-400 border-red-500/30 hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="fixed bottom-6 right-6 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="btn-primary flex items-center gap-2 px-6 py-3 shadow-lg shadow-primary/20"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
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
