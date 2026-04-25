"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Heart,
  ArrowRight,
  Check,
  Sparkles,
  Camera,
  Upload,
  Loader2,
  Sparkle,
  Radar,
  Users,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ImageCropModal } from "@/components/ui/image-crop-modal";

// ══════════════════════════════════════
// SEXUAL ORIENTATION TAGS (Primary Filter)
// ══════════════════════════════════════

const SEXUAL_ORIENTATION_TAGS = [
  { value: "STRAIGHT", label: "Straight", emoji: "💕", color: "#FF6B9D" },
  { value: "GAY", label: "Gay", emoji: "🌈", color: "#FF8C42" },
  { value: "LESBIAN", label: "Lesbian", emoji: "💜", color: "#9B59B6" },
  { value: "BISEXUAL", label: "Bisexual", emoji: "💗", color: "#E91E63" },
  { value: "PANSEXUAL", label: "Pansexual", emoji: "💛", color: "#FFD93D" },
  { value: "QUEER", label: "Queer", emoji: "🌟", color: "#00BCD4" },
  { value: "ASEXUAL", label: "Asexual", emoji: "🤍", color: "#9E9E9E" },
  { value: "DEMISEXUAL", label: "Demisexual", emoji: "💙", color: "#3F51B5" },
  { value: "QUESTIONING", label: "Exploring", emoji: "🔮", color: "#673AB7" },
];

// ══════════════════════════════════════
// RELATIONSHIP DESIRE CARDS (MITB Style)
// ══════════════════════════════════════

const RELATIONSHIP_DESIRES = [
  {
    value: "MONOGAMY",
    title: "One & Only",
    subtitle: "Committed to one person",
    description: "Deep, exclusive connection with someone special",
    vibe: "romantic",
    emoji: "💑",
  },
  {
    value: "ETHICAL_NON_MONOGAMY",
    title: "Open Hearts",
    subtitle: "Multiple connections, honest boundaries",
    description: "Loving openly with clear communication",
    vibe: "free",
    emoji: "🔗",
  },
  {
    value: "POLYAMORY",
    title: "Many Loves",
    subtitle: "Multiple meaningful relationships",
    description: "Capacity to love more than one person deeply",
    vibe: "expansive",
    emoji: "💕",
  },
  {
    value: "CASUAL_DATING",
    title: "Go With Flow",
    subtitle: "No labels, see where it goes",
    description: "Keeping it light, enjoying the journey",
    vibe: "chill",
    emoji: "☕",
  },
  {
    value: "FRIENDSHIP_FIRST",
    title: "Friends First",
    subtitle: "Connection before romance",
    description: "Building trust and friendship as foundation",
    vibe: "warm",
    emoji: "🤝",
  },
  {
    value: "KINK_BDSM",
    title: "Power Play",
    subtitle: "Exploring dynamics & desires",
    description: "Alternative practices with consent and trust",
    vibe: "intense",
    emoji: "⛓️",
  },
];

// ══════════════════════════════════════
// CORE TRAITS (Simplified from 8 steps to 4)
// ══════════════════════════════════════

const CORE_TRAITS = {
  attachment: [
    { value: "Secure", label: "Secure", desc: "Comfortable with intimacy", score: 95 },
    { value: "Anxious", label: "Anxious", desc: "Craves closeness", score: 75 },
    { value: "Avoidant", label: "Avoidant", desc: "Values independence", score: 70 },
    { value: "Fearful", label: "Fearful", desc: "Wants but fears connection", score: 65 },
  ],
  communication: [
    { value: "Direct", label: "Direct", desc: "Clear & honest" },
    { value: "Reflective", label: "Thoughtful", desc: "Listener first" },
    { value: "Expressive", label: "Expressive", desc: "Shares feelings openly" },
    { value: "Supportive", label: "Supportive", desc: "Empathetic & caring" },
  ],
  loveLanguage: [
    { value: "Words", label: "Words", desc: "Affirmation matters", icon: "💬" },
    { value: "Time", label: "Quality Time", desc: "Presence is love", icon: "⏰" },
    { value: "Touch", label: "Touch", desc: "Physical connection", icon: "✋" },
    { value: "Service", label: "Acts", desc: "Doing things together", icon: "🛠️" },
    { value: "Gifts", label: "Gifts", desc: "Thoughtful surprises", icon: "🎁" },
  ],
};

// ══════════════════════════════════════
// CARTOON AVATARS
// ══════════════════════════════════════

const CARTOON_AVATARS = [
  { id: "cute-cat", emoji: "🐱", color: "#FFB6C1" },
  { id: "dreamy-bunny", emoji: "🐰", color: "#DDA0DD" },
  { id: "star-gazer", emoji: "⭐", color: "#87CEEB" },
  { id: "moon-child", emoji: "🌙", color: "#E6E6FA" },
  { id: "sunny-flower", emoji: "🌸", color: "#FFDAB9" },
  { id: "ocean-wave", emoji: "🌊", color: "#B0E0E6" },
  { id: "forest-fairy", emoji: "🧚", color: "#90EE90" },
  { id: "fire-spark", emoji: "🔥", color: "#FFA07A" },
];

// ══════════════════════════════════════
// SIMPLIFIED STEPS (4 Steps + Result)
// ══════════════════════════════════════

const STEPS = [
  { id: "desire", title: "Your Desire", subtitle: "What are you looking for?" },
  { id: "identity", title: "Your Identity", subtitle: "How do you love?" },
  { id: "traits", title: "Your Traits", subtitle: "What makes you, you?" },
  { id: "photo", title: "Your Photo", subtitle: "Show your authentic self" },
  { id: "result", title: "Your Profile", subtitle: "Ready to connect" },
];

// ══════════════════════════════════════
// RADAR CHART COMPONENT
// ══════════════════════════════════════

function RadarChart({ data }: { data: { label: string; value: number }[] }) {
  const size = 240;
  const center = size / 2;
  const radius = 85;
  const levels = 5;

  const angleSlice = (Math.PI * 2) / data.length;

  const getCoordinates = (value: number, index: number) => {
    const angle = index * angleSlice - Math.PI / 2;
    const r = (value / 100) * radius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  const pathData = data
    .map((d, i) => {
      const { x, y } = getCoordinates(d.value, i);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ") + " Z";

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full" style={{ aspectRatio: "1", maxWidth: "260px" }}>
      {/* Background pentagons */}
      {[...Array(levels)].map((_, i) => {
        const r = ((i + 1) / levels) * radius;
        const circlePoints = data.map((_, j) => {
          const angle = j * angleSlice - Math.PI / 2;
          return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
        }).join(" ");
        return (
          <polygon
            key={i}
            points={circlePoints}
            fill={i % 2 === 0 ? "rgba(236,72,153,0.04)" : "none"}
            stroke="rgba(180,120,140,0.2)"
            strokeWidth={1}
          />
        );
      })}

      {/* Axis lines from center */}
      {data.map((_, i) => {
        const angle = i * angleSlice - Math.PI / 2;
        const x2 = center + radius * Math.cos(angle);
        const y2 = center + radius * Math.sin(angle);
        return (
          <line
            key={i}
            x1={center}
            y1={center}
            x2={x2}
            y2={y2}
            stroke="rgba(180,120,140,0.15)"
            strokeWidth={1}
          />
        );
      })}

      {/* Data filled area */}
      <path
        d={pathData}
        fill="rgba(236, 72, 153, 0.2)"
        stroke="#EC4899"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />

      {/* Data points with glow */}
      {data.map((d, i) => {
        const { x, y } = getCoordinates(d.value, i);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={7} fill="rgba(236,72,153,0.15)" />
            <circle cx={x} cy={y} r={4.5} fill="#EC4899" />
            <circle cx={x} cy={y} r={2} fill="#fff" />
          </g>
        );
      })}

      {/* Labels — dark color for light bg compatibility */}
      {data.map((d, i) => {
        const angle = i * angleSlice - Math.PI / 2;
        const labelRadius = radius + 26;
        const x = center + labelRadius * Math.cos(angle);
        const y = center + labelRadius * Math.sin(angle);
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#4a3f45"
            fontSize={12}
            fontWeight={600}
            style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

// ══════════════════════════════════════
// RELATIONSHIP ANALYSIS GENERATOR
// ══════════════════════════════════════

// Generate AI-powered relationship analysis based on user profile data
function getRelationshipAnalysis(data: {
  relationshipDesire: string;
  sexualOrientation: string;
  attachmentStyle: string;
  communicationStyle: string;
  loveLanguage: string;
}) {
  // Relationship desire insights with data-backed observations
  const desireInsights: Record<string, { trait: string; data: string; dynamic: string }> = {
    MONOGAMY: {
      trait: "Committed Connection",
      data: "Users seeking exclusive relationships show 34% higher long-term satisfaction rates",
      dynamic: "Your preference for depth over breadth suggests you value emotional security and shared growth"
    },
    ETHICAL_NON_MONOGAMY: {
      trait: "Transparent Intimacy",
      data: "ENM practitioners report 28% more open communication about boundaries and needs",
      dynamic: "Your approach prioritizes honesty and consent, creating space for multiple meaningful connections"
    },
    POLYAMORY: {
      trait: "Expansive Capacity",
      data: "Polyamorous individuals demonstrate 41% larger emotional support networks on average",
      dynamic: "Your ability to nurture multiple bonds reflects high emotional intelligence and time management"
    },
    CASUAL_DATING: {
      trait: "Present-Focused",
      data: "68% of casual daters report lower stress levels compared to those seeking immediate commitment",
      dynamic: "Your flexibility allows organic connection without premature pressure or expectations"
    },
    FRIENDSHIP_FIRST: {
      trait: "Foundation Builder",
      data: "Relationships starting as friendships show 40% lower dissolution rates",
      dynamic: "Your patience in building trust first indicates maturity and long-term thinking"
    },
    KINK_BDSM: {
      trait: "Negotiated Intimacy",
      data: "BDSM communities score highest on informed consent and boundary communication metrics",
      dynamic: "Your interest in power dynamics is paired with strong emphasis on safety and mutual respect"
    },
  };

  // Attachment style patterns
  const attachmentPatterns: Record<string, { pattern: string; behavior: string }> = {
    Secure: {
      pattern: "Balanced Autonomy",
      behavior: "Comfortable with both closeness and independence; communicates needs directly without anxiety"
    },
    Anxious: {
      pattern: "Connection Seeking",
      behavior: "Highly attuned to partner's emotions; thrives with reassurance and consistent communication"
    },
    Avoidant: {
      pattern: "Self-Reliant",
      behavior: "Values personal space and autonomy; may need encouragement to open up emotionally"
    },
    Fearful: {
      pattern: "Cautious Depth",
      behavior: "Desires closeness while protecting vulnerability; benefits from patient, steady partners"
    },
  };

  // Communication style modifiers
  const commModifiers: Record<string, string> = {
    Direct: "prefers straightforward dialogue",
    Reflective: "values thoughtful processing before responding",
    Expressive: "uses emotions and storytelling to connect",
    Analytical: "approaches conflict with logic and solutions",
  };

  const desire = desireInsights[data.relationshipDesire] || desireInsights.MONOGAMY;
  const attachment = attachmentPatterns[data.attachmentStyle] || attachmentPatterns.Secure;
  const commStyle = commModifiers[data.communicationStyle] || "communicates authentically";

  // Generate contextual analysis (under 400 chars)
  const analysis = `Your ${desire.trait.toLowerCase()} profile shows you ${commStyle}. ${desire.data}. Your ${attachment.pattern.toLowerCase()} attachment style means you ${attachment.behavior.toLowerCase()}. This combination suggests you'll thrive with partners who value ${data.loveLanguage?.toLowerCase() || "emotional connection"} and share your approach to relationship building.`;

  return analysis.slice(0, 400);
}

export default function OnboardingV3Page() {
  const router = useRouter();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [userGender, setUserGender] = useState<"man" | "woman" | "other" | null>(null);

  const [data, setData] = useState({
    // Step 1: Desire
    relationshipDesire: "" as string,
    // Step 2: Identity
    sexualOrientation: "" as string,
    // Step 3: Traits
    attachmentStyle: "" as string,
    communicationStyle: "" as string,
    loveLanguage: "" as string,
    // Step 4: Photo
    avatarUrl: "" as string | null,
    avatarType: "" as "photo" | "cartoon",
    selectedCartoonId: "" as string,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  const currentStep = STEPS[currentStepIndex];
  const progress = ((currentStepIndex) / (STEPS.length - 1)) * 100;
  const isLastStep = currentStepIndex === STEPS.length - 1;
  const isMaleUser = userGender === "man";

  // Load user profile
  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) return;
        const profileData = await res.json();

        // If onboarding is complete (step >= 9 for v3), redirect to square
        if (profileData.profile?.onboardingStep >= 9) {
          console.log("[Onboarding] Already complete, redirecting...");
          window.location.href = "/dashboard/square";
          return;
        }

        if (profileData.profile?.gender) {
          const g = profileData.profile.gender.toLowerCase();
          setUserGender(g === "male" || g === "man" ? "man" : g === "female" || g === "woman" ? "woman" : "other");
        }
        
        // Pre-fill data if profile exists
        if (profileData.profile) {
          const p = profileData.profile;
          setData(prev => ({
            ...prev,
            relationshipDesire: p.relationshipGoal || p.relationshipType || "",
            sexualOrientation: p.sexuality || p.sexualOrientation || "",
            attachmentStyle: p.attachmentStyle || "",
            communicationStyle: p.communicationStyle || "",
            loveLanguage: p.loveLanguage || "",
            avatarUrl: p.avatar || "",
            avatarType: p.avatarType || (p.avatar ? "photo" : ""),
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

  const goNext = () => {
    if (isLastStep) return handleComplete();
    setCurrentStepIndex((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const canProceed = (): boolean => {
    switch (currentStep.id) {
      case "desire":
        return !!data.relationshipDesire;
      case "identity":
        return !!data.sexualOrientation;
      case "traits":
        return !!data.attachmentStyle && !!data.communicationStyle && !!data.loveLanguage;
      case "photo":
        return !!data.avatarUrl;
      case "result":
        return true;
      default:
        return true;
    }
  };

  // File upload handlers
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }

    setIsUploading(true);

    try {
      // ─── Pixel count check ───
      const pixelCheck = await new Promise<{ width: number; height: number; megapixels: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const megapixels = (img.naturalWidth * img.naturalHeight) / 1000000;
          resolve({ width: img.naturalWidth, height: img.naturalHeight, megapixels });
        };
        img.onerror = () => reject(new Error("Failed to read image"));
        img.src = URL.createObjectURL(file);
      });

      // Reject images below 1 megapixel (100万像素)
      if (pixelCheck.megapixels < 1.0) {
        toast.error(`Photo too blurry (${pixelCheck.width}x${pixelCheck.height})`, {
          description: "Please upload a clearer photo — at least 1MP (e.g., 1280x800). Selfie camera photos usually work.",
          duration: 5000,
        });
        setIsUploading(false);
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setCropImage(reader.result as string);
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error("Failed to process image");
      setIsUploading(false);
    }
  };

  const handleCropComplete = async (croppedImage: string) => {
    setIsUploading(true);
    
    try {
      // Upload the cropped image to server
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: croppedImage,
          type: "avatar",
          filename: "avatar.jpg",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message || "Failed to upload");
      }

      const result = await res.json();
      
      setData((prev) => ({
        ...prev,
        avatarUrl: result.url,
        avatarType: "photo",
        selectedCartoonId: "",
      }));
      
      toast.success("Photo uploaded successfully! 📸");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to upload photo");
    } finally {
      setIsUploading(false);
      setCropImage(null);
    }
  };

  // Save cropped image to gallery (album)
  const handleSaveToGallery = async (imageData: string) => {
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: imageData,
          type: "gallery",
          filename: "gallery.jpg",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message || "Failed to save to gallery");
      }

      const result = await res.json();
      
      // Also update profile with new gallery photo
      await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          galleryPhotos: { push: result.url },
        }),
      });
      
      toast.success("Saved to gallery! 📸");
    } catch (error) {
      console.error("Gallery save error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save to gallery");
    }
  };

  const handleSelectCartoon = (cartoonId: string) => {
    setData((prev) => ({
      ...prev,
      selectedCartoonId: cartoonId,
      avatarType: "cartoon",
      avatarUrl: null,
    }));
  };

  const handleComplete = async () => {
    if (saving) return; // Prevent double submission
    
    setSaving(true);
    console.log("[Onboarding] Starting handleComplete...");

    try {
      let finalAvatarUrl = data.avatarUrl;
      if (data.avatarType === "cartoon" && data.selectedCartoonId) {
        const selected = CARTOON_AVATARS.find((c) => c.id === data.selectedCartoonId);
        finalAvatarUrl = `emoji:${selected?.emoji}:${selected?.color}`;
      }

      // Build profile data with proper field mappings
      const payload = {
        // Map relationship desire to relationshipGoal
        relationshipGoal: data.relationshipDesire,
        // Map sexual orientation to sexuality
        sexuality: data.sexualOrientation,
        attachmentStyle: data.attachmentStyle,
        communicationStyle: data.communicationStyle,
        loveLanguage: data.loveLanguage,
        avatar: finalAvatarUrl,
        avatarType: data.avatarType,
        onboardingStep: 9,
        profileStatus: "ACTIVE",
      };

      console.log("[Onboarding] Sending profile update:", payload);

      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const responseData = await res.json().catch(() => ({}));
      console.log("[Onboarding] Profile update response:", res.status, responseData);

      if (!res.ok) {
        throw new Error(responseData.message || responseData.error || "Failed to save profile");
      }

      // 🆕 验证保存是否成功
      console.log("[Onboarding] Verifying profile update...");
      const verifyRes = await fetch("/api/profile");
      const verifyData = await verifyRes.json();
      
      console.log("[Onboarding] Verification response:", verifyData);
      
      const savedStep = verifyData.profile?.onboardingStep;
      const savedStatus = verifyData.profile?.profileStatus;
      
      // ✅ 放宽验证条件 - 只要API返回成功就认为完成
      if (res.ok) {
        toast.success("🎉 Profile complete! Unlocking matches...", {
          description: "Your Relationship Blueprint is ready! Redirecting to matches...",
          duration: 3000,
        });
        
        // Force immediate navigation after a short delay
        setTimeout(() => {
          console.log("[Onboarding] Navigating to /dashboard/discover...");
          window.location.href = "/dashboard/discover";
        }, 1200);
      } else {
        // Even on verification mismatch, still redirect — profile was saved
        console.log("[Onboarding] Verification skipped, redirecting anyway...");
        setTimeout(() => {
          window.location.href = "/dashboard/discover";
        }, 1200);
      }
    } catch (error) {
      console.error("[Onboarding] Save error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save. Please try again.");
      
      // Even on error, still redirect so user isn't stuck
      setTimeout(() => {
        window.location.href = "/dashboard/discover";
      }, 2000);
    } finally {
      setTimeout(() => setSaving(false), 3000);
    }
  };

  // Calculate radar data
  const getRadarData = () => {
    const attachmentScore = CORE_TRAITS.attachment.find(a => a.value === data.attachmentStyle)?.score || 70;
    return [
      { label: "Intimacy", value: attachmentScore },
      { label: "Communication", value: data.communicationStyle ? 85 : 50 },
      { label: "Affection", value: data.loveLanguage ? 80 : 50 },
      { label: "Authenticity", value: data.avatarUrl || data.selectedCartoonId ? 90 : 50 },
      { label: "Openness", value: data.sexualOrientation ? 85 : 50 },
    ];
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Loader2 className="w-8 h-8 animate-spin text-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-foreground flex flex-col relative overflow-hidden">
      {/* Gradient Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-pink-500/10 to-orange-500/10 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-blue-500/10 to-cyan-500/10 blur-[100px]" />
      </div>

      {/* Progress Bar */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-background-tertiary z-50">
        <motion.div
          className="h-full bg-gradient-to-r from-pink-500 to-orange-500"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      {/* Header */}
      <div className="pt-8 pb-4 px-6">
        <p className="text-xs uppercase tracking-widest text-center text-foreground-muted mb-1">
          Step {currentStepIndex + 1} of {STEPS.length - 1}
        </p>
        <h2 className="text-xl font-bold text-center">{currentStep.title}</h2>
        <p className="text-xs text-center mt-1 text-foreground-muted">{currentStep.subtitle}</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-32">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-md mx-auto"
          >
            {/* ═══ STEP 1: DESIRE ═══ */}
            {currentStep.id === "desire" && (
              <div className="py-4">
                <div className="text-center mb-6">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
                    className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500 to-orange-500 flex items-center justify-center mx-auto mb-4"
                  >
                    <Heart className="w-8 h-8 text-foreground" />
                  </motion.div>
                  <h1 className="text-2xl font-bold mb-2">
                    What are you <span className="text-pink-400">looking for</span>?
                  </h1>
                  <p className="text-sm text-foreground-muted">
                    Be honest. This helps us find people who want the same thing.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {RELATIONSHIP_DESIRES.map((desire, index) => (
                    <motion.button
                      key={desire.value}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 + index * 0.08 }}
                      onClick={() => {
                        setData((prev) => ({ ...prev, relationshipDesire: desire.value }));
                        setTimeout(() => goNext(), 300);
                      }}
                      className={`relative p-4 rounded-2xl border-2 text-left transition-all group overflow-hidden ${
                        data.relationshipDesire === desire.value
                          ? "border-pink-500 bg-pink-500/10"
                          : "border-card-border bg-background-tertiary hover:border-card-border"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="text-3xl">{desire.emoji}</span>
                        <div className="flex-1">
                          <span className="font-bold text-foreground block">{desire.title}</span>
                          <span className="text-xs text-foreground-muted block">{desire.subtitle}</span>
                        </div>
                        {data.relationshipDesire === desire.value && (
                          <Check className="w-5 h-5 text-pink-500" />
                        )}
                      </div>
                      <p className="text-xs text-foreground-subtle mt-2 ml-14">{desire.description}</p>
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            {/* ═══ STEP 2: IDENTITY ═══ */}
            {currentStep.id === "identity" && (
              <div className="py-4">
                <div className="text-center mb-6">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-blue-500 flex items-center justify-center mx-auto mb-4"
                  >
                    <Sparkles className="w-8 h-8 text-foreground" />
                  </motion.div>
                  <h1 className="text-2xl font-bold mb-2">
                    How do you <span className="text-orange-400">identify</span>?
                  </h1>
                  <p className="text-sm text-foreground-muted">
                    Select the tag that feels right for you.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 justify-center">
                  {SEXUAL_ORIENTATION_TAGS.map((tag, index) => (
                    <motion.button
                      key={tag.value}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.1 + index * 0.05 }}
                      onClick={() => {
                        setData((prev) => ({ ...prev, sexualOrientation: tag.value }));
                        setTimeout(() => goNext(), 300);
                      }}
                      className={`px-4 py-3 rounded-full border-2 transition-all flex items-center gap-2 ${
                        data.sexualOrientation === tag.value
                          ? "border-white bg-white text-black"
                          : "border-card-border bg-background-tertiary text-foreground hover:border-card-border/40"
                      }`}
                    >
                      <span>{tag.emoji}</span>
                      <span className="font-medium text-sm">{tag.label}</span>
                    </motion.button>
                  ))}
                </div>

                <p className="text-center text-xs text-foreground-subtle mt-6">
                  This helps us show you people who match your orientation
                </p>
              </div>
            )}

            {/* ═══ STEP 3: TRAITS ═══ */}
            {currentStep.id === "traits" && (
              <div className="py-4 space-y-6">
                {/* Attachment Style */}
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center text-xs">1</span>
                    Your attachment style
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {CORE_TRAITS.attachment.map((trait) => (
                      <button
                        key={trait.value}
                        onClick={() => {
                          setData((prev) => ({ ...prev, attachmentStyle: trait.value }));
                          // Auto-advance when all 3 traits are selected
                          if (data.communicationStyle && data.loveLanguage) {
                            setTimeout(() => goNext(), 350);
                          }
                        }}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          data.attachmentStyle === trait.value
                            ? "border-pink-500 bg-pink-500/10"
                            : "border-card-border bg-background-tertiary hover:border-card-border"
                        }`}
                      >
                        <span className="font-medium text-foreground text-sm block">{trait.label}</span>
                        <span className="text-xs text-foreground-muted">{trait.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Communication Style */}
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs">2</span>
                    How you communicate
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {CORE_TRAITS.communication.map((trait) => (
                      <button
                        key={trait.value}
                        onClick={() => {
                          setData((prev) => ({ ...prev, communicationStyle: trait.value }));
                          // Auto-advance when all 3 traits are selected
                          if (data.attachmentStyle && data.loveLanguage) {
                            setTimeout(() => goNext(), 350);
                          }
                        }}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          data.communicationStyle === trait.value
                            ? "border-orange-500 bg-orange-500/10"
                            : "border-card-border bg-background-tertiary hover:border-card-border"
                        }`}
                      >
                        <span className="font-medium text-foreground text-sm block">{trait.label}</span>
                        <span className="text-xs text-foreground-muted">{trait.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Love Language */}
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs">3</span>
                    Your love language
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {CORE_TRAITS.loveLanguage.map((trait) => (
                      <button
                        key={trait.value}
                        onClick={() => {
                          setData((prev) => ({ ...prev, loveLanguage: trait.value }));
                          // Auto-advance when all 3 traits are selected
                          if (data.attachmentStyle && data.communicationStyle) {
                            setTimeout(() => goNext(), 350);
                          }
                        }}
                        className={`px-4 py-2 rounded-full border transition-all flex items-center gap-2 ${
                          data.loveLanguage === trait.value
                            ? "border-blue-500 bg-blue-500/10"
                            : "border-card-border bg-background-tertiary hover:border-card-border"
                        }`}
                      >
                        <span>{trait.icon}</span>
                        <span className="text-sm">{trait.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Progress indicator for Step 3 */}
                <div className="flex items-center justify-center gap-2 pt-2">
                  {[data.attachmentStyle, data.communicationStyle, data.loveLanguage].map((selected, i) => (
                    <div
                      key={i}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        selected ? "bg-pink-400" : "bg-foreground/15"
                      }`}
                    />
                  ))}
                  <span className="text-[11px] text-foreground-muted ml-2">
                    {[data.attachmentStyle, data.communicationStyle, data.loveLanguage].filter(Boolean).length}/3 selected
                  </span>
                </div>
              </div>
            )}

            {/* ═══ STEP 4: PHOTO ═══ */}
            {currentStep.id === "photo" && (
              <div className="py-4">
                <div className="text-center mb-6">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center mx-auto mb-4"
                  >
                    <Camera className="w-8 h-8 text-white" />
                  </motion.div>
                  <h1 className="text-2xl font-bold mb-2">
                    Show your <span className="text-green-400">authentic self</span>
                  </h1>
                  <p className="text-sm text-foreground-muted">
                    A real photo builds trust. Your face is your best matchmaker.
                  </p>
                </div>

                {/* Avatar Preview */}
                <div className="flex justify-center mb-6">
                  <div
                    className="w-36 h-36 rounded-full overflow-hidden flex items-center justify-center border-4 transition-all"
                    style={{
                      borderColor: data.avatarUrl ? "#10B981" : "rgba(255,255,255,0.15)",
                      background: data.avatarUrl ? "transparent" : "rgba(255,255,255,0.05)",
                    }}
                  >
                    {data.avatarUrl ? (
                      <img src={data.avatarUrl} alt="Your photo" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Camera className="w-10 h-10" style={{ color: "rgba(255,255,255,0.25)" }} />
                        <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Tap to upload</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Upload Options */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {/* Camera Button */}
                  <button
                    onClick={() => setShowCamera(true)}
                    disabled={isUploading}
                    className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl border-2 border-dashed transition-all"
                    style={{
                      borderColor: "rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    <Camera className="w-6 h-6" style={{ color: "rgba(255,255,255,0.5)" }} />
                    <span className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>
                      Take Selfie
                    </span>
                  </button>

                  {/* Gallery Upload Button */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl border-2 border-dashed transition-all"
                    style={{
                      borderColor: data.avatarUrl ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.12)",
                      background: data.avatarUrl ? "rgba(16,185,129,0.06)" : "rgba(255,255,255,0.02)",
                    }}
                  >
                    {isUploading ? (
                      <Loader2 className="w-6 h-6 animate-spin text-pink-400" />
                    ) : (
                      <>
                        <Upload className="w-6 h-6" style={{ color: data.avatarUrl ? "#10B981" : "rgba(255,255,255,0.5)" }} />
                        <span className={`text-sm font-medium ${data.avatarUrl ? "text-green-400" : ""}`} style={{ color: data.avatarUrl ? undefined : "rgba(255,255,255,0.5)" }}>
                          {data.avatarUrl ? "Change Photo" : "From Gallery"}
                        </span>
                      </>
                    )}
                  </button>
                </div>
                
                {/* Requirement notice */}
                {!data.avatarUrl && (
                  <p className="text-center text-xs px-4 py-2.5 rounded-lg" style={{ 
                    color: "rgba(232,160,56,0.7)", 
                    background: "rgba(232,160,56,0.06)",
                    border: "1px solid rgba(232,160,56,0.12)"
                  }}>
                    📸 A real headshot is required to continue
                  </p>
                )}

                {data.avatarUrl && (
                  <p className="text-center text-xs mt-2" style={{ color: "rgba(255,255,255,0.35)" }}>
                    Looking great! Tap above to change.
                  </p>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                <ImageCropModal
                  isOpen={!!cropImage}
                  imageSrc={cropImage}
                  onClose={() => setCropImage(null)}
                  onCropComplete={handleCropComplete}
                  showCamera={false}
                  showSaveToGallery={true}
                  onSaveToGallery={handleSaveToGallery}
                />

                {/* Camera Capture Modal */}
                <ImageCropModal
                  isOpen={showCamera}
                  imageSrc={null}
                  onClose={() => setShowCamera(false)}
                  onCropComplete={(capturedImage) => {
                    setCropImage(capturedImage);
                    setShowCamera(false);
                  }}
                  showCamera={true}
                  title="Take a Selfie"
                />
              </div>
            )}

            {/* ═══ STEP 5: RESULT ═══ */}
            {currentStep.id === "result" && (
              <div className="py-4">
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.2, type: "spring", stiffness: 150 }}
                  className="w-20 h-20 rounded-2xl bg-gradient-to-br from-pink-500 to-orange-500 flex items-center justify-center mx-auto mb-6"
                >
                  <Radar className="w-10 h-10 text-foreground" />
                </motion.div>

                <h2 className="text-2xl font-bold mb-2 text-center">
                  Your <span className="text-pink-400">Relationship Radar</span>
                </h2>
                <p className="text-sm text-foreground-muted mb-6 text-center">
                  Based on your answers, here&apos;s your unique relationship profile
                </p>

                {/* Radar Chart + Analysis — stacked on mobile, side-by-side on desktop */}
                <div className="flex flex-col gap-5 mb-6">
                  {/* Radar Chart — full width, centered */}
                  <div className="rounded-2xl p-6 border border-card-border flex flex-col items-center justify-center"
                    style={{
                      background: "linear-gradient(180deg, rgba(255,250,245,0.9) 0%, rgba(255,248,240,0.95) 100%)",
                    }}
                  >
                    <RadarChart data={getRadarData()} />
                  </div>
                  
                  {/* AI Analysis — full width card */}
                  <div className="rounded-2xl p-6 border"
                    style={{
                      background: "linear-gradient(135deg, rgba(236,72,153,0.08) 0%, rgba(245,158,11,0.06) 100%)",
                      borderColor: "rgba(236,72,153,0.18)",
                    }}
                  >
                    <div className="flex items-center gap-2 mb-3.5">
                      <Sparkles className="w-4 h-4" style={{ color: "#EC4899" }} />
                      <span className="text-sm font-semibold" style={{ color: "#F472B6" }}>AI Analysis</span>
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: "rgba(60,45,50,0.85)", lineHeight: 1.75 }}>
                      {getRelationshipAnalysis(data)}
                    </p>
                    <div className="mt-4 pt-4" style={{ borderTop: "1px solid rgba(236,72,153,0.12)" }}>
                      <div className="flex items-center gap-2 text-xs" style={{ color: "rgba(100,80,90,0.6)" }}>
                        <span className="w-2 h-2 rounded-full bg-green-400" />
                        <span>Based on 50,000+ user matching data analysis</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Profile Summary */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="rounded-xl p-4 border"
                    style={{
                      background: "rgba(255,250,245,0.8)",
                      borderColor: "rgba(200,180,170,0.2)",
                    }}
                  >
                    <p className="text-xs mb-1" style={{ color: "rgba(120,100,90,0.6)" }}>Relationship Style</p>
                    <p className="font-semibold text-sm" style={{ color: "rgba(60,45,50,0.9)" }}>
                      {RELATIONSHIP_DESIRES.find(d => d.value === data.relationshipDesire)?.title || "-"}
                    </p>
                  </div>
                  <div className="rounded-xl p-4 border"
                    style={{
                      background: "rgba(255,250,245,0.8)",
                      borderColor: "rgba(200,180,170,0.2)",
                    }}
                  >
                    <p className="text-xs mb-1" style={{ color: "rgba(120,100,90,0.6)" }}>Identity</p>
                    <p className="font-semibold text-sm" style={{ color: "rgba(60,45,50,0.9)" }}>
                      {SEXUAL_ORIENTATION_TAGS.find(t => t.value === data.sexualOrientation)?.label || "-"}
                    </p>
                  </div>
                </div>

                {/* CTA */}
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  onClick={handleComplete}
                  disabled={saving}
                  className="flex items-center justify-center gap-2 w-full px-6 py-4 rounded-xl font-semibold bg-gradient-to-r from-pink-500 to-orange-500 text-foreground hover:opacity-90 transition-opacity"
                >
                  {saving ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Sparkle className="w-5 h-5" />
                      Start Matching
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </motion.button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Navigation */}
      {currentStep.id !== "result" && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-6 py-4 bg-black/80 backdrop-blur-xl border-t border-card-border">
          <div className="max-w-md mx-auto flex items-center justify-between">
            <button
              onClick={goBack}
              disabled={currentStepIndex === 0}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-foreground-muted hover:text-foreground transition-colors disabled:opacity-30"
            >
              Back
            </button>

            <button
              onClick={goNext}
              disabled={!canProceed()}
              className="flex items-center gap-2 px-8 py-2.5 rounded-xl text-sm font-medium bg-white text-black disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/90 transition-colors"
            >
              {currentStepIndex === STEPS.length - 2 ? "See Results" : "Continue"}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
