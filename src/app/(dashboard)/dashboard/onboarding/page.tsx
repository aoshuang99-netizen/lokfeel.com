"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Heart,
  ArrowRight,
  ArrowLeft,
  Check,
  Shield,
  Sparkles,
  MessageCircle,
  Users,
  MapPin,
  Target,
  Brain,
  Camera,
  Upload,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

// ══════════════════════════════════════
// CARTOON AVATARS for women (SVG-based)
// ══════════════════════════════════════

const CARTOON_AVATARS = [
  {
    id: "cute-cat",
    name: "Cute Cat 🐱",
    emoji: "🐱",
    color: "#FFB6C1",
  },
  {
    id: "dreamy-bunny",
    name: "Dreamy Bunny 🐰",
    emoji: "🐰",
    color: "#DDA0DD",
  },
  {
    id: "star-gazer",
    name: "Star Gazer ⭐",
    emoji: "⭐",
    color: "#87CEEB",
  },
  {
    id: "moon-child",
    name: "Moon Child 🌙",
    emoji: "🌙",
    color: "#E6E6FA",
  },
  {
    id: "sunny-flower",
    name: "Sunny Flower 🌸",
    emoji: "🌸",
    color: "#FFDAB9",
  },
  {
    id: "ocean-wave",
    name: "Ocean Wave 🌊",
    emoji: "🌊",
    color: "#B0E0E6",
  },
  {
    id: "forest-fairy",
    name: "Forest Fairy 🧚",
    emoji: "🧚",
    color: "#90EE90",
  },
  {
    id: "fire-spark",
    name: "Fire Spark 🔥",
    emoji: "🔥",
    color: "#FFA07A",
  },
];

// ══════════════════════════════════════
// Matching Engine Dimensions
// ══════════════════════════════════════

const ATTACHMENT_STYLES = [
  { value: "Secure", label: "Secure", description: "Comfortable with intimacy & independence. Trust comes naturally.", icon: "🛡️", score: 95 },
  { value: "Anxious-Preoccupied", label: "Anxious", description: "Craves closeness, fears abandonment. Highly attuned to partner's needs.", icon: "💫", score: 75 },
  { value: "Dismissive-Avoidant", label: "Avoidant", description: "Values independence. May struggle asking for emotional support.", icon: "🌊", score: 70 },
  { value: "Fearful-Avoidant", label: "Fearful", description: "Wants connection but fears hurt. Pulls close then pushes away.", icon: "🔥", score: 65 },
];

const COMMUNICATION_STYLES = [
  { value: "Direct", label: "Direct", description: "Clear, honest, to-the-point. No mind reading needed.", icon: "💬" },
  { value: "Reflective", label: "Reflective", description: "Thoughtful listener. Responds after careful consideration.", icon: "🤔" },
  { value: "Expressive", label: "Expressive", description: "Emotional & animated. Shares feelings openly.", icon: "❤️‍🔥" },
  { value: "Analytical", label: "Analytical", description: "Logical, fact-based. Prefers data over emotion.", icon: "📊" },
];

const CONFLICT_STYLES = [
  { value: "Collaborative", label: "Collaborative", description: "Works together to find a win-win solution.", icon: "🤝", score: 95 },
  { value: "Compromising", label: "Compromising", description: "Meets in the middle. Both give a little.", icon: "⚖️", score: 80 },
  { value: "Accommodating", label: "Accommodating", description: "Prioritizes harmony over being 'right'.", icon: "🕊️", score: 65 },
  { value: "Competing", label: "Assertive", description: "Stands firm on what matters. Values honesty.", icon: "⚡", score: 35 },
  { value: "Avoiding", label: "Avoiding", description: "Needs time to process. Prefers cooling off first.", icon: "🌀", score: 20 },
];

const LOVE_LANGUAGES = [
  { value: "Words of Affirmation", label: "Words of Affirmation", icon: "💬" },
  { value: "Quality Time", label: "Quality Time", icon: "⏰" },
  { value: "Physical Touch", label: "Physical Touch", icon: "✋" },
  { value: "Acts of Service", label: "Acts of Service", icon: "🛠️" },
  { value: "Gifts", label: "Gifts", icon: "🎁" },
];

const LIFE_PRIORITIES = [
  "Career & Ambition", "Family & Children", "Adventure & Travel",
  "Creative Expression", "Health & Wellness", "Financial Security",
  "Spiritual Growth", "Community & Friends", "Learning & Knowledge", "Work-Life Balance",
];

const RELATIONSHIP_GOALS = [
  { value: "LONG_TERM", label: "Long-Term Relationship", subtitle: "Building something lasting together", emoji: "💍" },
  { value: "DATING", label: "Dating & Exploring", subtitle: "Open to seeing where things go", emoji: "☕" },
  { value: "FRIENDSHIP", label: "Connection First", subtitle: "Friendship as foundation", emoji: "🤗" },
  { value: "NOT_SURE", label: "Figuring It Out", subtitle: "Honest about not knowing yet", emoji: "🔮" },
];

// ─── Onboarding Steps Definition ───────────────────────────

const STEPS = [
  { id: "welcome", title: "Welcome", icon: Heart },
  { id: "avatar", title: "Your Photo", icon: Camera },        // NEW: Avatar upload step
  { id: "attachment", title: "Attachment Style", icon: Shield },
  { id: "communication", title: "Communication", icon: MessageCircle },
  { id: "conflict", title: "Conflict Resolution", icon: Sparkles },
  { id: "values", title: "Values & Love Language", icon: Brain },
  { id: "lifestyle", title: "Preferences & Goals", icon: Target },
  { id: "complete", title: "You're Ready!", icon: Check },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Detect user gender from registration
  const [userGender, setUserGender] = useState<"man" | "woman" | "other" | null>(null);

  // Form state
  const [data, setData] = useState({
    attachmentStyle: "",
    communicationStyle: "",
    conflictResolution: "",
    loveLanguage: "",
    lifePriorities: [] as string[],
    emotionalAvailability: "",
    relationshipGoal: "LONG_TERM" as string,
    preferredGender: "" as string,
    preferredAgeMin: 22,
    preferredAgeMax: 45,
    city: "",
    displayName: "",
    age: 28,
    bio: "",

    // NEW: Avatar fields
    avatarUrl: "" as string | null,       // Uploaded photo URL or selected cartoon
    avatarType: "" as "photo" | "cartoon", // Type of avatar
    selectedCartoonId: "" as string,      // Selected cartoon avatar ID
  });

  // File upload ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const currentStep = STEPS[currentStepIndex];
  const progress = ((currentStepIndex + 1) / STEPS.length) * 100;
  const isLastStep = currentStepIndex === STEPS.length - 1;

  // Is this user male? → must upload real photo
  const isMaleUser = userGender === "man";

  // Check existing profile + detect gender
  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) return;
        const profileData = await res.json();

        // If already completed full onboarding, redirect
        if (profileData.profile?.onboardingStep >= 8) { // 8 steps now
          router.push("/dashboard");
          return;
        }

        // Detect gender from profile
        if (profileData.profile?.gender) {
          const g = profileData.profile.gender.toLowerCase();
          setUserGender(g === "male" || g === "man" ? "man" : g === "female" || g === "woman" ? "woman" : "other");
        }

        // Pre-fill partial data
        if (profileData.profile) {
          const p = profileData.profile;
          setData((prev) => ({
            ...prev,
            attachmentStyle: prev.attachmentStyle || p.attachmentStyle || "",
            communicationStyle: prev.communicationStyle || p.communicationStyle || "",
            conflictResolution: prev.conflictResolution || p.conflictResolution || "",
            loveLanguage: prev.loveLanguage || p.loveLanguage || "",
            lifePriorities: p.lifePriorities ? JSON.parse(p.lifePriorities) : [],
            emotionalAvailability: prev.emotionalAvailability || p.emotionalAvailability || "",
            relationshipGoal: prev.relationshipGoal || p.relationshipGoal || "LONG_TERM",
            preferredGender: prev.preferredGender || p.preferredGender || "",
            preferredAgeMin: prev.preferredAgeMin || p.preferredAgeMin || 22,
            preferredAgeMax: prev.preferredAgeMax || p.preferredAgeMax || 45,
            city: prev.city || p.city || "",
            displayName: prev.displayName || p.displayName || "",
            age: prev.age || p.age || 28,
            bio: prev.bio || p.bio || "",
            avatarUrl: p.avatar || null,
          }));
        }
      } catch (e) {
        console.error("Check status error:", e);
      } finally {
        setIsLoading(false);
      }
    }
    checkStatus();
  }, [router]);

  // Navigation
  const goNext = () => {
    if (isLastStep) return handleComplete();
    setCurrentStepIndex((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
  };

  // Validate current step
  const canProceed = (): boolean => {
    switch (currentStep.id) {
      case "welcome":
        return true;
      case "avatar":
        // Must have an avatar set (either uploaded photo or selected cartoon)
        return !!data.avatarUrl || !!data.selectedCartoonId;
      case "attachment":
        return !!data.attachmentStyle;
      case "communication":
        return !!data.communicationStyle;
      case "conflict":
        return !!data.conflictResolution;
      case "values":
        return !!data.loveLanguage && data.lifePriorities.length > 0;
      case "lifestyle":
        return !!data.relationshipGoal;
      default:
        return true;
    }
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate it's an image
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file (JPG, PNG, etc.)");
      return;
    }

    // For male users, warn about real photos
    if (isMaleUser) {
      // Could add AI face detection here later
    }

    // Max size 5MB
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5MB");
      return;
    }

    setIsUploading(true);
    setError("");

    try {
      // Convert to base64 for storage (in production, use S3/Cloudinary)
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setData((prev) => ({
          ...prev,
          avatarUrl: base64,
          avatarType: "photo",
          selectedCartoonId: "",
        }));
        toast.success(isMaleUser ? "Photo uploaded! Looking good 👍" : "Photo uploaded!");
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError("Failed to upload image");
      setIsUploading(false);
    }
  };

  // Select cartoon avatar
  const handleSelectCartoon = (cartoonId: string) => {
    setData((prev) => ({
      ...prev,
      selectedCartoonId: cartoonId,
      avatarType: "cartoon",
      avatarUrl: null,
    }));
  };

  // Save profile data
  const handleSave = async () => {
    setSaving(true);
    setError("");

    try {
      // Determine final avatar URL
      let finalAvatarUrl = data.avatarUrl;
      if (data.avatarType === "cartoon" && data.selectedCartoonId) {
        // Use emoji-based placeholder for cartoon avatars
        const selected = CARTOON_AVATARS.find((c) => c.id === data.selectedCartoonId);
        finalAvatarUrl = `emoji:${selected?.emoji}:${selected?.color}`;
      }

      const payload: Record<string, any> = {
        displayName: data.displayName || undefined,
        age: data.age || undefined,
        bio: data.bio || undefined,
        city: data.city || undefined,
        relationshipGoal: data.relationshipGoal,
        attachmentStyle: data.attachmentStyle || null,
        communicationStyle: data.communicationStyle || null,
        conflictResolution: data.conflictResolution || null,
        loveLanguage: data.loveLanguage || null,
        lifePriorities: data.lifePriorities.length > 0 ? JSON.stringify(data.lifePriorities) : null,
        emotionalAvailability: data.emotionalAvailability || null,
        preferredGender: data.preferredGender || null,
        preferredAgeMin: data.preferredAgeMin || null,
        preferredAgeMax: data.preferredAgeMax || null,
        // Avatar
        avatar: finalAvatarUrl || undefined,
        avatarType: data.avatarType || undefined,
        // Mark onboarding complete (8 steps now)
        onboardingStep: 8,
        profileStatus: "ACTIVE",
      };

      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) throw new Error(result.message || "Failed to save");

      toast.success("Your Relationship Blueprint is ready! 🎉");
      setTimeout(() => router.push("/dashboard"), 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = () => {
    if (!canProceed()) {
      setError("Please complete all required fields on this step");
      return;
    }
    handleSave();
  };

  // Toggle array items
  const toggleArrayItem = (item: string, field: "lifePriorities") => {
    setData((prev) => ({
      ...prev,
      [field]: prev[field].includes(item)
        ? prev[field].filter((i) => i !== item)
        : [...prev[field], item],
    }));
  };

  // ═══════ RENDER ═══════

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const IconComponent = currentStep.icon;

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/15 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-secondary/15 rounded-full blur-[100px]" />
      </div>

      {/* Progress Bar */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-white/5 z-50">
        <motion.div
          className="h-full bg-gradient-to-r from-primary via-secondary to-accent"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      {/* Step Indicator */}
      <div className="pt-8 pb-4 px-6">
        <p className="text-xs text-white/30 uppercase tracking-widest text-center mb-1">
          Step {currentStepIndex + 1} of {STEPS.length}
        </p>
        <h2 className="text-lg font-semibold text-white/80 text-center">{currentStep.title}</h2>
        {/* Estimated time remaining */}
        <p className="text-xs text-white/40 text-center mt-1">
          About {Math.max(1, Math.ceil((STEPS.length - currentStepIndex) * 0.5))} min remaining
        </p>
        {/* Dot indicator */}
        <div className="flex justify-center gap-1.5 mt-3">
          {STEPS.map((step, i) => (
            <button
              key={step.id}
              onClick={() => i <= currentStepIndex && setCurrentStepIndex(i)}
              className={
                i === currentStepIndex ? "h-1.5 rounded-full transition-all w-8 bg-primary" :
                i < currentStepIndex ? "h-1.5 rounded-full transition-all w-1.5 bg-primary/50" :
                "h-1.5 rounded-full transition-all w-1.5 bg-white/10"}
            />
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto px-6 pb-32">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-lg mx-auto"
          >
            {/* Error */}
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-error/15 border border-error/30 text-error text-sm text-center">
                {error}
              </div>
            )}

            {/* ═══ STEP 1: WELCOME ═══ */}
            {currentStep.id === "welcome" && (
              <div className="text-center py-8">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
                  className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary via-secondary to-accent flex items-center justify-center mx-auto mb-8 shadow-2xl"
                >
                  <Heart className="w-12 h-12 text-white" />
                </motion.div>
                <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
                  Build Your{" "}
                  <span className="bg-gradient-to-r from-pink-400 via-purple-400 to-amber-400 bg-clip-text text-transparent">Relationship Blueprint</span>
                </h1>
                <p className="text-white/60 text-base leading-relaxed max-w-md mx-auto mb-10">
                  LokFeel matches you based on who you are — not just what you look like.
                  Answer honestly; there are no wrong answers.
                </p>
                <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto text-left">
                  {[
                    { icon: Shield, text: "5-dimension compatibility scoring" },
                    { icon: Users, text: "Weekly curated matches (max 5)" },
                    { icon: MessageCircle, text: "Match explanation for every pairing" },
                    { icon: MapPin, text: "Location-aware matching" },
                  ].map((item) => (
                    <div key={item.text} className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.03]">
                      <item.icon className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-white/70">{item.text}</span>
                    </div>
                  ))}
                </div>

                {/* Gender hint (if unknown) */}
                {!userGender && (
                  <div className="mt-6 p-3 rounded-lg bg-white/[0.03] border border-white/10">
                    <p className="text-xs text-white/40">Tip: Your avatar options will be personalized based on your gender.</p>
                  </div>
                )}
              </div>
            )}

            {/* ═══ STEP 2: AVATAR UPLOAD ═══ */}
            {currentStep.id === "avatar" && (
              <div>
                <h3 className="text-xl font-bold text-white mb-2">
                  {isMaleUser ? "Upload Your Photo" : "Choose Your Avatar"}
                </h3>
                <p className="text-sm text-white/60 mb-4">
                  {isMaleUser
                    ? "Real photos build trust and better matches. Show your genuine self."
                    : "You can upload your own photo or pick a cute cartoon avatar!"}
                </p>

                {/* Value proposition banner */}
                <div className="mb-6 p-3 rounded-xl bg-gradient-to-r from-primary/20 to-secondary/20 border border-primary/30">
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold text-white">Pro Tip</span>
                  </div>
                  <p className="text-xs text-white/70">
                    {isMaleUser 
                      ? "Profiles with clear, genuine photos get 3x more matches. It's our quality promise to the community."
                      : "Profiles with photos (real or avatar) get 3x more matches. Choose what feels right for you!"}
                  </p>
                </div>

                {/* Avatar Preview */}
                <div className="flex justify-center mb-6">
                  <div
                    className={(data.avatarUrl || data.selectedCartoonId)
                      ? "relative w-32 h-32 rounded-full overflow-hidden border-3 flex items-center justify-center bg-white/5"
                      : "relative w-32 h-32 rounded-full overflow-hidden border-dashed border-white/30 border-3 flex items-center justify-center bg-white/5"}
                    style={((data.avatarUrl || data.selectedCartoonId) ? { borderColor: "#c94d7a" } : {})}
                  >
                    {data.avatarUrl && data.avatarType === "photo" ? (
                      <img src={data.avatarUrl} alt="Your photo" className="w-full h-full object-cover" />
                    ) : data.selectedCartoonId ? (
                      (() => {
                        const c = CARTOON_AVATARS.find((a) => a.id === data.selectedCartoonId);
                        return (
                          <div
                            className="w-full h-full flex items-center justify-center text-6xl"
                            style={{ backgroundColor: c?.color + "40" }}
                          >
                            {c?.emoji}
                          </div>
                        );
                      })()
                    ) : (
                      <div className="text-center p-4">
                        <Camera className="w-8 h-8 text-white/20 mx-auto mb-2" />
                        <span className="text-xs text-white/30 block">No photo</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Upload button (always shown) */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="w-full flex items-center justify-center gap-3 p-4 rounded-xl border-2 border-dashed border-white/20 hover:border-primary/50 hover:bg-white/[0.02] transition-all mb-6 group"
                >
                  {isUploading ? (
                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  ) : (
                    <>
                      <Upload className="w-5 h-5 text-white/40 group-hover:text-primary transition-colors" />
                      <span className="text-sm text-white/60 group-hover:text-white/80 transition-colors">
                        {isUploading ? "Uploading..." : data.avatarUrl && data.avatarType === "photo" ? "Change Photo" : "Upload Photo"}
                      </span>
                    </>
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                {/* Male user requirement notice */}
                {isMaleUser && !data.avatarUrl && (
                  <div className="mb-6 p-3 rounded-lg bg-warning/10 border border-warning/30 text-center">
                    <p className="text-xs text-warning font-medium">
                      ⚠️ A verified photo is required to start matching. Real photos only — no filters, no AI-generated images.
                    </p>
                  </div>
                )}

                {/* Cartoon Avatars (for women / non-male users) */}
                {!isMaleUser && (
                  <div>
                    <p className="text-sm text-white/50 text-center mb-3">
                      Or choose a cartoon avatar ↓
                    </p>
                    <div className="grid grid-cols-4 gap-3">
                      {CARTOON_AVATARS.map((avatar) => (
                        <button
                          key={avatar.id}
                          onClick={() => handleSelectCartoon(avatar.id)}
                          className={data.selectedCartoonId === avatar.id
                              ? "aspect-square rounded-xl flex flex-col items-center justify-center gap-1 transition-all ring-2 ring-primary scale-105 bg-white/10"
                              : "aspect-square rounded-xl flex flex-col items-center justify-center gap-1 transition-all bg-white/5 hover:bg-white/10"}
                        >
                          <span className="text-3xl">{avatar.emoji}</span>
                          {data.selectedCartoonId === avatar.id && (
                            <Check className="w-4 h-4 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Validation message */}
                {(data.avatarUrl || data.selectedCartoonId) && (
                  <div className="mt-4 text-center">
                    <p className="text-sm text-success flex items-center justify-center gap-1">
                      <Check className="w-4 h-4" />
                      Avatar ready! You look great.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ═══ STEP 3: ATTACHMENT STYLE ═══ */}
            {currentStep.id === "attachment" && (
              <SelectionStep
                title="What's your attachment style?"
                subtitle="This isn't about being 'good' or 'bad' — it's about understanding how you relate emotionally in close relationships."
                options={ATTACHMENT_STYLES.map((s) => ({
                  value: s.value, label: s.label, description: s.description,
                  icon: s.icon, detail: `Compatibility base: ${s.score}%`,
                }))}
                selected={data.attachmentStyle}
                onSelect={(v) => setData((prev) => ({ ...prev, attachmentStyle: v }))}
              />
            )}

            {/* ═══ STEP 4: COMMUNICATION STYLE ═══ */}
            {currentStep.id === "communication" && (
              <SelectionStep
                title="How do you prefer to communicate?"
                subtitle="In relationships, how do you typically express yourself?"
                options={COMMUNICATION_STYLES.map((s) => ({
                  value: s.value, label: s.label, description: s.description, icon: s.icon,
                }))}
                selected={data.communicationStyle}
                onSelect={(v) => setData((prev) => ({ ...prev, communicationStyle: v }))}
                columns={2}
              />
            )}

            {/* ═══ STEP 5: CONFLICT RESOLUTION ═══ */}
            {currentStep.id === "conflict" && (
              <SelectionStep
                title="How do you handle conflict?"
                subtitle="When disagreements arise, what's your natural tendency?"
                options={CONFLICT_STYLES.map((s) => ({
                  value: s.value, label: s.label, description: s.description,
                  icon: s.icon,
                  detail: s.score >= 70 ? `Healthy baseline: ${s.score}%` : s.score >= 40 ? `Moderate: ${s.score}%` : `Caution zone: ${s.score}%`,
                }))}
                selected={data.conflictResolution}
                onSelect={(v) => setData((prev) => ({ ...prev, conflictResolution: v }))}
              />
            )}

            {/* ═══ STEP 6: VALUES & LOVE LANGUAGE ═══ */}
            {currentStep.id === "values" && (
              <div>
                {/* Love Language */}
                <h3 className="text-xl font-bold text-white mb-2">Your primary love language?</h3>
                <p className="text-sm text-white/60 mb-6">What makes you feel most loved and appreciated?</p>
                <div className="grid grid-cols-1 gap-3 mb-8">
                  {LOVE_LANGUAGES.map((ll) => (
                    <button
                      key={ll.value}
                      onClick={() => setData((prev) => ({ ...prev, loveLanguage: ll.value }))}
                      className={data.loveLanguage === ll.value
                        ? "flex items-center gap-4 p-4 rounded-xl border transition-all text-left border-primary bg-primary/10 shadow-lg shadow-primary/10"
                        : "flex items-center gap-4 p-4 rounded-xl border transition-all text-left border-white/10 bg-white/[0.02] hover:border-white/20"}
                    >
                      <span className="text-2xl">{ll.icon}</span>
                      <span className="font-medium text-white">{ll.label}</span>
                      {data.loveLanguage === ll.value && (<Check className="w-5 h-5 text-primary ml-auto" />)}
                    </button>
                  ))}
                </div>

                {/* Life Priorities */}
                <h3 className="text-xl font-bold text-white mb-2">Life Priorities</h3>
                <p className="text-sm text-white/60 mb-4">Select up to 5 that matter most ({data.lifePriorities.length}/5)</p>
                <div className="grid grid-cols-2 gap-2">
                  {LIFE_PRIORITIES.map((priority) => (
                    <button
                      key={priority}
                      disabled={!data.lifePriorities.includes(priority) && data.lifePriorities.length >= 5}
                      onClick={() => toggleArrayItem(priority, "lifePriorities")}
                      className={data.lifePriorities.includes(priority)
                          ? "p-3 rounded-lg border text-sm transition-all border-primary bg-primary/10 text-white font-medium"
                          : "p-3 rounded-lg border text-sm transition-all border-white/5 bg-white/[0.02] text-white/60 hover:border-white/20 disabled:opacity-30"}
                    >
                      {data.lifePriorities.includes(priority) && (<Check className="inline w-3.5 h-3.5 mr-1 text-primary -mt-0.5" />)}
                      {priority}
                    </button>
                  ))}
                </div>

                {/* Emotional Availability */}
                <div className="mt-8">
                  <h3 className="text-lg font-bold text-white mb-3">Emotional availability now</h3>
                  <div className="space-y-2">
                    {[
                      { value: "Fully Available", label: "Fully Available", desc: "Ready for deep connection" },
                      { value: "Building Trust", label: "Building Trust", desc: "Opening up gradually" },
                      { value: "Processing Past", label: "Processing Past", desc: "Still healing from previous" },
                      { value: "Needs Space", label: "Needs Space", desc: "Preferring low pressure for now" },
                    ].map((ea) => (
                      <button
                        key={ea.value}
                        onClick={() => setData((prev) => ({ ...prev, emotionalAvailability: ea.value }))}
                        className={data.emotionalAvailability === ea.value
                            ? "w-full flex items-center gap-3 p-3 rounded-lg border text-sm transition-all border-primary bg-primary/10"
                            : "w-full flex items-center gap-3 p-3 rounded-lg border text-sm transition-all border-white/5 hover:border-white/15 text-white/70"}
                      >
                        <span className="font-medium">{ea.label}</span>
                        <span className="text-xs text-white/40 ml-auto">{ea.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ STEP 7: LIFESTYLE & GOALS ═══ */}
            {currentStep.id === "lifestyle" && (
              <div>
                <h3 className="text-xl font-bold text-white mb-2">What are you looking for?</h3>
                <p className="text-sm text-white/60 mb-4">Be honest — this helps us match you better.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
                  {RELATIONSHIP_GOALS.map((goal) => {
                    const isSelected = data.relationshipGoal === goal.value;
                    const baseClass = "p-4 rounded-xl border transition-all text-left ";
                    const selectedClass = baseClass + "border-primary bg-primary/10 shadow-lg shadow-primary/10";
                    const defaultClass = baseClass + "border-white/10 bg-white/[0.02] hover:border-white/20";
                    return (
                    <button key={goal.value} onClick={() => setData((prev) => ({ ...prev, relationshipGoal: goal.value }))} className={isSelected ? selectedClass : defaultClass}>
                      <span className="text-2xl block mb-2">{goal.emoji}</span>
                      <span className="font-bold text-white block">{goal.label}</span>
                      <span className="text-xs text-white/50 mt-1 block">{goal.subtitle}</span>
                    </button>
                    );
                  })}
                </div>

                {/* Preferred Gender */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    Who are you interested in? <span className="text-primary">*</span>
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {["Woman", "Man", "Non-binary", "Anyone"].map((g) => {
                      const gVal = g.toUpperCase().replace("-", "_");
                      const isActive = data.preferredGender === gVal;
                      const btnClass = isActive
                        ? "px-4 py-2 rounded-lg text-sm font-medium transition-all bg-primary text-white"
                        : "px-4 py-2 rounded-lg text-sm font-medium transition-all bg-white/5 text-white/60 hover:bg-white/10";
                      return (
                      <button key={g} onClick={() => setData((prev) => ({ ...prev, preferredGender: gVal as any }))} className={btnClass}>
                        {g}
                      </button>
                      );
                    })}
                  </div>
                </div>

                {/* Age Range */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-white/80 mb-3">
                    Preferred age range: {data.preferredAgeMin} – {data.preferredAgeMax}
                  </label>
                  <div className="flex gap-4">
                    <input type="range" min="18" max="55" value={data.preferredAgeMin}
                      onChange={(e) => setData((prev) => ({
                        ...prev, preferredAgeMin: parseInt(e.target.value),
                        preferredAgeMax: Math.max(prev.preferredAgeMax, parseInt(e.target.value)),
                      }))}
                      className="flex-1 accent-primary"
                    />
                    <input type="range" min="18" max="75" value={data.preferredAgeMax}
                      onChange={(e) => setData((prev) => ({
                        ...prev, preferredAgeMax: parseInt(e.target.value),
                        preferredAgeMin: Math.min(prev.preferredAgeMin, parseInt(e.target.value)),
                      }))}
                      className="flex-1 accent-secondary"
                    />
                  </div>
                  <div className="flex justify-between text-xs text-white/30 mt-1">
                    <span>{data.preferredAgeMin}yo</span><span>{data.preferredAgeMax}yo</span>
                  </div>
                </div>

                {/* Location */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-white/80 mb-2">City (optional)</label>
                  <input type="text" placeholder="" value={data.city}
                    onChange={(e) => setData((prev) => ({ ...prev, city: e.target.value }))}
                    className="input-feeld" autoComplete="address-level2"
                  />
                </div>
              </div>
            )}

            {/* ═══ STEP 8: COMPLETE ═══ */}
            {currentStep.id === "complete" && (
              <div className="text-center py-12">
                <motion.div
                  initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.2, type: "spring", stiffness: 150 }}
                  className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-primary/30"
                >
                  {/* Show avatar thumbnail in completion */}
                  {data.avatarUrl && data.avatarType === "photo" ? (
                    <img src={data.avatarUrl} alt="" className="w-24 h-24 rounded-3xl object-cover" />
                  ) : data.selectedCartoonId ? (
                    (() => {
                      const c = CARTOON_AVATARS.find((a) => a.id === data.selectedCartoonId);
                      return <span className="text-5xl">{c?.emoji}</span>;
                    })()
                  ) : (
                    <Check className="w-12 h-12 text-white" />
                  )}
                </motion.div>

                <h2 className="text-3xl font-bold text-white mb-3">Your Blueprint is Complete!</h2>
                <p className="text-white/60 mb-8 max-w-md mx-auto leading-relaxed">
                  We&apos;ve captured your unique relationship DNA. Based on your attachment style,
                  communication approach, values, and preferences, our engine will find people who truly complement you.
                </p>

                <div className="bg-white/5 rounded-xl p-4 mb-8 text-left max-w-sm mx-auto">
                  <p className="text-sm text-white/40 uppercase tracking-wider mb-3 font-medium">Your Profile Summary</p>
                  <div className="space-y-2 text-sm">
                    <SummaryRow label="Attachment" value={data.attachmentStyle || "Not set"} />
                    <SummaryRow label="Communication" value={data.communicationStyle || "Not set"} />
                    <SummaryRow label="Conflict Style" value={data.conflictResolution || "Not set"} />
                    <SummaryRow label="Love Language" value={data.loveLanguage || "Not set"} />
                    <SummaryRow label="Relationship Goal" value={data.relationshipGoal.replace("_", " ")} />
                    <SummaryRow label="Priorities" value={`${data.lifePriorities.length} selected`} />
                    <SummaryRow label="Avatar" value={data.avatarType === "cartoon" ? "Cartoon" : "Photo ✓"} />
                  </div>
                </div>

                <p className="text-sm text-white/40 mb-4">You&apos;ll receive up to 5 curated matches per week.</p>

                {/* Match timing expectation */}
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="bg-gradient-to-r from-primary/20 to-secondary/20 rounded-xl p-4 mb-6 max-w-sm mx-auto border border-primary/30"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold text-white">What happens next?</span>
                  </div>
                  <p className="text-xs text-white/70 leading-relaxed">
                    Your first curated matches will arrive within <span className="text-primary font-medium">24-48 hours</span>. 
                    We&apos;ll notify you by email when they&apos;re ready!
                  </p>
                </motion.div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Navigation — NO SKIP BUTTON (required flow) */}
      <div className="fixed bottom-0 left-0 right-0 z-50 glass-strong-safe border-t border-white/10 px-6 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <button
            onClick={goBack}
            disabled={currentStepIndex === 0}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              currentStepIndex === 0 ? "text-white/20 cursor-not-allowed" : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
          ><ArrowLeft className="w-4 h-4" /> Back</button>

          {isLastStep ? (
            <button
              onClick={handleComplete}
              disabled={saving || !canProceed()}
              className={(saving || !canProceed()) ? "btn-primary flex items-center gap-2 px-8 opacity-50 cursor-not-allowed" : "btn-primary flex items-center gap-2 px-8"}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Sparkles className="w-4 h-4" /> Start Matching!</>)}
            </button>
          ) : (
            <button
              onClick={goNext}
              disabled={!canProceed() && !["welcome"].includes(currentStep.id)}
              className={(!canProceed() && !["welcome"].includes(currentStep.id))
                ? "btn-primary flex items-center gap-2 px-8 opacity-50 cursor-not-allowed"
                : "btn-primary flex items-center gap-2 px-8"}
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══ Sub-Components ══════════════════════════════════════════════

function SelectionStep({
  title, subtitle, options, selected, onSelect, columns = 1,
}: {
  title: string; subtitle?: string;
  options: { value: string; label: string; description: string; icon: string; detail?: string }[];
  selected: string; onSelect: (value: string) => void; columns?: number;
}) {
  return (
    <div>
      <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
      {subtitle && <p className="text-sm text-white/60 mb-6">{subtitle}</p>}
      <div className={columns === 2 ? "grid gap-3 grid-cols-2" : "grid gap-3 grid-cols-1"}>
        {options.map((opt) => (
          <button key={opt.value} onClick={() => onSelect(opt.value)}
            className={selected === opt.value
              ? "p-4 rounded-xl border text-left transition-all border-primary bg-primary/10 shadow-lg shadow-primary/10"
              : "p-4 rounded-xl border text-left transition-all border-white/10 bg-white/[0.02] hover:border-white/25"}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0 mt-0.5">{opt.icon}</span>
              <div className="min-w-0">
                <span className="font-bold text-white block">{opt.label}</span>
                <span className="text-xs text-white/50 block mt-1 leading-relaxed">{opt.description}</span>
                {opt.detail && <span className="text-[11px] text-primary/60 mt-1.5 inline-block">{opt.detail}</span>}
              </div>
              {selected === opt.value && (<Check className="w-5 h-5 text-primary ml-auto flex-shrink-0 mt-0.5" />)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between"><span className="text-white/40">{label}</span><span className="text-white/80 font-medium capitalize">{value}</span></div>
  );
}
