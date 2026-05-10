"use client";

import { useEffect, useState, useRef, useCallback } from "react";
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
import { GENDER_OPTIONS, SEXUALITY_OPTIONS, DOM_SUB_ROLE_OPTIONS as ALL_DOM_SUB_ROLES } from "@/constants";
import { ImageCropModal } from "@/components/ui/image-crop-modal";
import { AvatarLightbox } from "@/components/ui/avatar-lightbox";
import { ErrorBoundary } from "@/components/shared/error-boundary";

// Use shared constants — Onboarding and Profile must reference the SAME source
// Gender: 18 options from constants (same as Profile)
const GENDER_IDENTITY_OPTIONS = GENDER_OPTIONS;
// Sexuality: 24 options from constants (same as Profile)
const SEXUAL_ORIENTATION_TAGS = SEXUALITY_OPTIONS;
// Dom/Sub: 16 options from constants (no truncation)
const DOM_SUB_ROLE_OPTIONS = ALL_DOM_SUB_ROLES;

const KINK_EXPERIENCE_OPTIONS = [
  { value: "BEGINNER", label: "Beginner", emoji: "🌱", desc: "New to kink" },
  { value: "INTERMEDIATE", label: "Intermediate", emoji: "🌿", desc: "Expanding skills" },
  { value: "EXPERIENCED", label: "Experienced", emoji: "🌳", desc: "Well-versed" },
  { value: "EXPERT", label: "Expert", emoji: "🏆", desc: "Deep mastery" },
  { value: "PREFER_NOT_TO_SAY", label: "Prefer not to say", emoji: "🤐", desc: "" },
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

const US_CITIES = [
  "New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia",
  "San Antonio", "San Diego", "Dallas", "San Jose", "Austin", "Jacksonville",
  "Fort Worth", "Columbus", "Charlotte", "San Francisco", "Indianapolis",
  "Seattle", "Denver", "Washington DC", "Boston", "El Paso", "Nashville",
  "Portland", "Las Vegas", "Memphis", "Louisville", "Baltimore", "Milwaukee", "Albuquerque",
];

const STEPS = [
  { id: "basics", title: "Welcome", subtitle: "Let's get to know you" },
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
      {/* Background pentagons — 加深对比度 */}
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
            fill={i % 2 === 0 ? "rgba(139, 92, 246, 0.1)" : "none"}
            stroke="rgba(139, 92, 246, 0.2)"
            strokeWidth={1}
          />
        );
      })}

      {/* Axis lines from center — 加深 */}
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
            stroke="rgba(139, 92, 246, 0.15)"
            strokeWidth={1}
          />
        );
      })}

      {/* Data filled area */}
      <path
        d={pathData}
        fill="rgba(76, 29, 149, 0.18)"
        stroke="#4c1d95"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />

      {/* Data points with glow */}
      {data.map((d, i) => {
        const { x, y } = getCoordinates(d.value, i);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={7} fill="rgba(76, 29, 149, 0.15)" />
            <circle cx={x} cy={y} r={4.5} fill="#4c1d95" />
            <circle cx={x} cy={y} r={2} fill="#a3e635" />
          </g>
        );
      })}

      {/* Labels — 深色粗体，清晰可读 */}
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
            fill="rgba(139, 92, 246, 0.3)"
            fontSize={12}
            fontWeight={700}
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
  // Relationship desire insights with encouraging observations
  const desireInsights: Record<string, { trait: string; data: string; dynamic: string }> = {
    MONOGAMY: {
      trait: "Committed Connection",
      data: "Exclusive relationships tend to foster deep emotional security and shared growth",
      dynamic: "Your preference for depth over breadth suggests you value emotional security and shared growth"
    },
    ETHICAL_NON_MONOGAMY: {
      trait: "Transparent Intimacy",
      data: "Open communication about boundaries is a hallmark of healthy ENM dynamics",
      dynamic: "Your approach prioritizes honesty and consent, creating space for multiple meaningful connections"
    },
    POLYAMORY: {
      trait: "Expansive Capacity",
      data: "Nurturing multiple bonds reflects high emotional intelligence and intentionality",
      dynamic: "Your ability to nurture multiple bonds reflects high emotional intelligence and time management"
    },
    CASUAL_DATING: {
      trait: "Present-Focused",
      data: "Keeping things light can reduce pressure and let connections develop naturally",
      dynamic: "Your flexibility allows organic connection without premature pressure or expectations"
    },
    FRIENDSHIP_FIRST: {
      trait: "Foundation Builder",
      data: "Relationships built on friendship often have the strongest foundations",
      dynamic: "Your patience in building trust first indicates maturity and long-term thinking"
    },
    KINK_BDSM: {
      trait: "Negotiated Intimacy",
      data: "Kink communities are known for strong emphasis on consent and boundary communication",
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

// Wrap the inner component with ErrorBoundary to prevent white-screen crashes
function OnboardingV3Page() {
  const router = useRouter();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [data, setData] = useState({
    // Step 0: Basics
    displayName: "" as string,
    birthDate: "" as string,
    location: "" as string,
    age: 0 as number,
    // Step 1: Desire
    relationshipDesire: "" as string,
    // Step 2: Identity
    gender: "" as string,
    sexualOrientation: "" as string,
    // Step 2b: Power Dynamics (conditional on KINK_BDSM)
    domSubRole: "" as string,
    kinkExperienceLevel: "" as string,
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
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);

  // ══════════════════════════════════════
  // PROGRESS SAVE: Persist each step to API
  // ══════════════════════════════════════
  const saveProgress = useCallback(async (stepIndex: number) => {
    try {
      const stepPayload: Record<string, any> = { onboardingStep: stepIndex + 1 };

      // Step 0: Basics — save displayName, age (computed), city
      if (data.displayName) stepPayload.displayName = data.displayName.trim();
      if (data.age > 0) stepPayload.age = data.age;
      if (data.location) stepPayload.city = data.location;

      // Step 1: Desire
      if (stepIndex >= 1 && data.relationshipDesire) {
        stepPayload.relationshipGoal = data.relationshipDesire;
      }
      // Step 2: Identity + Power Dynamics
      if (stepIndex >= 2) {
        if (data.gender) stepPayload.gender = data.gender;
        if (data.sexualOrientation) stepPayload.sexuality = data.sexualOrientation;
      }
      if (stepIndex >= 2) {
        if (data.domSubRole) stepPayload.domSubRole = data.domSubRole;
        if (data.kinkExperienceLevel) stepPayload.kinkExperienceLevel = data.kinkExperienceLevel;
      }
      // Step 3: Traits
      if (stepIndex >= 3) {
        if (data.attachmentStyle) stepPayload.attachmentStyle = data.attachmentStyle;
        if (data.communicationStyle) stepPayload.communicationStyle = data.communicationStyle;
        if (data.loveLanguage) stepPayload.loveLanguage = data.loveLanguage;
      }
      // Step 4: Photo
      if (stepIndex >= 4 && data.avatarUrl) {
        stepPayload.avatar = data.avatarType === "cartoon" && data.selectedCartoonId
          ? `emoji:${CARTOON_AVATARS.find(c => c.id === data.selectedCartoonId)?.emoji}:${CARTOON_AVATARS.find(c => c.id === data.selectedCartoonId)?.color}`
          : data.avatarUrl;
        if (data.avatarType) stepPayload.avatarType = data.avatarType;
      }

      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stepPayload),
      });

      if (res.ok) {
        const fields = Object.keys(stepPayload).filter(k => k !== 'onboardingStep');
        console.log(`[Onboarding] Progress saved: step ${stepIndex + 1}, fields: ${fields.join(',')}`);
      } else {
        console.warn(`[Onboarding] Progress save failed: HTTP ${res.status}`);
      }
    } catch (e) {
      console.warn("[Onboarding] Progress save failed:", e);
    }
  }, [data]);

  const currentStep = STEPS[currentStepIndex];
  const progress = ((currentStepIndex) / (STEPS.length - 1)) * 100;
  const isLastStep = currentStepIndex === STEPS.length - 1;

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
          window.location.href = "/dashboard/explore";
          return;
        }

        // Pre-fill data if profile exists
        if (profileData.profile) {
          const p = profileData.profile;
          setData(prev => ({
            ...prev,
            displayName: p.displayName || "",
            birthDate: "",
            location: p.city || "",
            age: p.age || 0,
            relationshipDesire: p.relationshipGoal || p.relationshipType || "",
            gender: p.gender || "",
            sexualOrientation: p.sexuality || p.sexualOrientation || "",
            domSubRole: p.domSubRole || "",
            kinkExperienceLevel: p.kinkExperienceLevel || "",
            attachmentStyle: p.attachmentStyle || "",
            communicationStyle: p.communicationStyle || "",
            loveLanguage: p.loveLanguage || "",
            avatarUrl: p.avatar || "",
            avatarType: p.avatarType || (p.avatar ? "photo" : ""),
          }));

          // Restore step position from saved onboardingStep
          // onboardingStep 1-5 maps to stepIndex 0-4; step 6+ means at result page
          let restoredIndex = 0;
          if (p.onboardingStep && p.onboardingStep > 0 && p.onboardingStep < 9) {
            restoredIndex = Math.min(p.onboardingStep - 1, STEPS.length - 1);
          }

          // Smart skip: If profile was pre-filled from modal signup,
          // skip steps that are already complete
          const hasBasics = !!p.displayName && (p.age || 0) > 0;
          const hasIdentity = !!p.gender && !!p.sexuality;
          const hasAvatar = !!p.avatar;

          if (hasBasics && restoredIndex === 0) {
            restoredIndex = 1; // Skip basics → go to desire
            // Persist the skip so returning user stays ahead
            fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onboardingStep: 2 }) }).catch(() => {});
          }
          if (hasIdentity && restoredIndex <= 2) {
            restoredIndex = Math.max(restoredIndex, 3); // Skip identity → go to traits
            fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onboardingStep: 4 }) }).catch(() => {});
          }
          if (hasAvatar && restoredIndex <= 4) {
            restoredIndex = Math.max(restoredIndex, 5); // Skip photo → go to result
            fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onboardingStep: 6 }) }).catch(() => {});
          }

          setCurrentStepIndex(restoredIndex);
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
    // Save progress of current step before advancing
    saveProgress(currentStepIndex);
    setCurrentStepIndex((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const canProceed = (): boolean => {
    switch (currentStep.id) {
      case "basics":
        return !!data.displayName && data.displayName.trim().length >= 2;
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

    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be under 10MB");
      return;
    }

    setIsUploading(true);

    try {
      // ─── Client-side pre-compress before crop ───
      // Onboarding uses smaller max size (1024px) to keep data URLs manageable
      // The full-res upload happens on the profile page, not here
      const preCompress = (rawFile: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const MAX_SIDE = 1024;
            let w = img.naturalWidth;
            let h = img.naturalHeight;
            if (w > MAX_SIDE || h > MAX_SIDE) {
              if (w >= h) {
                h = Math.round(MAX_SIDE * (h / w));
                w = MAX_SIDE;
              } else {
                w = Math.round(MAX_SIDE * (w / h));
                h = MAX_SIDE;
              }
            }
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) { reject(new Error("Canvas error")); return; }
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.80));
          };
          img.onerror = () => reject(new Error("Failed to read image"));
          img.src = URL.createObjectURL(rawFile);
        });
      };

      const compressedDataUrl = await preCompress(file);

      // ─── Pixel count check (relaxed: 0.3MP = 640x480 minimum) ───
      const pixelCheck = await new Promise<{ width: number; height: number; megapixels: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const megapixels = (img.naturalWidth * img.naturalHeight) / 1000000;
          resolve({ width: img.naturalWidth, height: img.naturalHeight, megapixels });
        };
        img.onerror = () => reject(new Error("Failed to read image"));
        img.src = compressedDataUrl;
      });

      // Relaxed: 0.3MP (640×480 equivalent) — crop will further resize
      if (pixelCheck.megapixels < 0.3) {
        toast.error(`Photo too blurry (${pixelCheck.width}x${pixelCheck.height})`, {
          description: "Please upload a clearer photo — at least 640x480 pixels.",
          duration: 5000,
        });
        setIsUploading(false);
        return;
      }

      setCropImage(compressedDataUrl);
      setIsUploading(false);
    } catch {
      toast.error("Failed to process image");
      setIsUploading(false);
    }
  };

  const handleCropComplete = async (croppedImage: string) => {
    // Guard: prevent re-entry (crop modal timeout can fire after initial load)
    if (isUploading) {
      console.log("[Upload] Skipping duplicate call (already uploading)");
      return;
    }
    
    if (!croppedImage || croppedImage.length < 100) {
      console.warn("[Upload] Invalid cropped image, skipping");
      return;
    }
    
    setIsUploading(true);
    setCropImage(null); // Close crop modal immediately to show loading state
    
    // During onboarding, skip server upload entirely.
    // The local cropped image is stored in React state and will be
    // persisted to DB in handleComplete (one single API call).
    // This eliminates the #1 crash point: upload timeout/failure.
    try {
      setData((prev) => ({
        ...prev,
        avatarUrl: croppedImage,
        avatarType: "photo",
        selectedCartoonId: "",
      }));
      
      toast.success("Photo selected!", {
        description: "Looking great! Tap Continue to proceed.",
        duration: 3000,
      });
    } catch (error) {
      console.error("[Onboarding] Failed to set avatar:", error);
      toast.error("Failed to set photo. Please try again.");
    } finally {
      setIsUploading(false);
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
      const payload: Record<string, any> = {
        // Step 0: Basics
        ...(data.displayName ? { displayName: data.displayName.trim() } : {}),
        ...(data.age > 0 ? { age: data.age } : {}),
        ...(data.location ? { city: data.location } : {}),
        // Step 1: Map relationship desire to relationshipGoal
        relationshipGoal: data.relationshipDesire,
        // Step 2: Phase B — Gender identity
        gender: data.gender || undefined,
        // Map sexual orientation to sexuality
        sexuality: data.sexualOrientation,
        // Phase B: Power dynamics (only if KINK_BDSM or role selected)
        ...(data.domSubRole ? { domSubRole: data.domSubRole } : {}),
        ...(data.kinkExperienceLevel ? { kinkExperienceLevel: data.kinkExperienceLevel } : {}),
        // Step 3: Traits
        attachmentStyle: data.attachmentStyle,
        communicationStyle: data.communicationStyle,
        loveLanguage: data.loveLanguage,
        // Step 4: Photo
        avatar: finalAvatarUrl,
        avatarType: data.avatarType,
        // Mark onboarding complete
        onboardingStep: 9,
        profileStatus: "APPROVED",
      };

      console.log("[Onboarding] Sending profile update, avatar length:", finalAvatarUrl?.length || 0);

      // Profile save with 20s timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      const responseData = await res.json().catch(() => ({}));
      console.log("[Onboarding] Profile update response:", res.status, responseData);

      if (!res.ok) {
        throw new Error(responseData.message || responseData.error || `Server error ${res.status}`);
      }

      toast.success("🎉 Onboarding complete! Let's find your matches.", {
        description: "Redirecting to Discover...",
        duration: 3000,
      });

      setTimeout(() => {
        console.log("[Onboarding] Navigating to /dashboard/explore...");
        window.location.href = "/dashboard/explore";
      }, 1200);
    } catch (error) {
      console.error("[Onboarding] Save error:", error);
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      const message = isTimeout 
        ? "Save timed out. Please check your connection and try again."
        : (error instanceof Error ? error.message : "Failed to save. Please try again.");
      toast.error(message, { duration: 5000 });
      setSaving(false); // Allow retry
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col relative overflow-hidden">
      {/* Gradient Background — subtle warm glow */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-primary/10 to-secondary/10 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-secondary/8 to-primary/6 blur-[100px]" />
      </div>

      {/* Progress Bar */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-background-tertiary z-50">
        <motion.div
          className="h-full bg-gradient-primary"
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
            {/* ═══ STEP 0: BASICS ═══ */}
            {currentStep.id === "basics" && (
              <div className="py-4">
                <div className="text-center mb-8">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
                    className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mx-auto mb-4"
                  >
                    <Sparkles className="w-8 h-8 text-foreground" />
                  </motion.div>
                  <h1 className="text-2xl font-bold mb-2">
                    Welcome to <span className="text-primary">LokFeel</span>
                  </h1>
                  <p className="text-sm text-foreground-muted">
                    A few basics to get you started
                  </p>
                </div>

                <div className="space-y-5">
                  {/* Display Name */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    <label className="block text-xs font-medium text-foreground-muted mb-1.5">
                      Name or Nickname <span className="text-pink-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={data.displayName}
                      onChange={(e) => setData(prev => ({ ...prev, displayName: e.target.value }))}
                      placeholder="Your name or nickname"
                      maxLength={30}
                      className="w-full px-4 py-3 rounded-xl border-2 bg-background-tertiary text-foreground placeholder:text-foreground-tertiary focus:border-primary focus:outline-none transition-colors text-sm"
                    />
                    <p className="text-[10px] text-foreground-tertiary mt-1">2-30 characters. This is what others will see.</p>
                  </motion.div>

                  {/* Birth Date */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                  >
                    <label className="block text-xs font-medium text-foreground-muted mb-1.5">
                      Date of Birth
                    </label>
                    <input
                      type="date"
                      value={data.birthDate}
                      onChange={(e) => {
                        const bd = e.target.value;
                        const age = bd ? new Date().getFullYear() - new Date(bd).getFullYear() : 0;
                        setData(prev => ({ ...prev, birthDate: bd, age }));
                      }}
                      max={new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}
                      min={new Date(Date.now() - 100 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}
                      className="w-full px-4 py-3 rounded-xl border-2 bg-background-tertiary text-foreground focus:border-primary focus:outline-none transition-colors text-sm"
                    />
                    {data.age > 0 && (
                      <p className="text-[10px] text-foreground-tertiary mt-1">You are {data.age} years old</p>
                    )}
                  </motion.div>

                  {/* Location */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                  >
                    <label className="block text-xs font-medium text-foreground-muted mb-1.5">
                      Your City
                    </label>
                    <input
                      type="text"
                      value={data.location}
                      onChange={(e) => setData(prev => ({ ...prev, location: e.target.value }))}
                      placeholder="Your city"
                      list="city-suggestions"
                      className="w-full px-4 py-3 rounded-xl border-2 bg-background-tertiary text-foreground placeholder:text-foreground-tertiary focus:border-primary focus:outline-none transition-colors text-sm"
                    />
                    <datalist id="city-suggestions">
                      {US_CITIES.map(city => (
                        <option key={city} value={city} />
                      ))}
                    </datalist>
                    <p className="text-[10px] text-foreground-tertiary mt-1">Used for finding matches near you</p>
                  </motion.div>
                </div>

                {/* Continue Button */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="mt-8"
                >
                  <button
                    onClick={goNext}
                    disabled={!canProceed()}
                    className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-primary to-secondary text-foreground font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
                  >
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </motion.div>
              </div>
            )}

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
                    What are you <span className="text-primary">looking for</span>?
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
                        setTimeout(() => goNext(), 150);
                      }}
                      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
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

                {/* Phase B: Kink Power Dynamics (conditional on KINK_BDSM) */}
                <AnimatePresence>
                  {data.relationshipDesire === "KINK_BDSM" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.4 }}
                      className="mt-6 space-y-5"
                    >
                      <div className="border-t border-card-border pt-5">
                        <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
                          <span>⛓️</span> Your Power Dynamic
                        </h3>
                        <p className="text-xs text-foreground-muted mb-3">Optional — skip if you prefer to explore later</p>

                        <div className="grid grid-cols-2 gap-2">
                          {DOM_SUB_ROLE_OPTIONS.map((role) => (
                            <button
                              key={role.value}
                              onClick={() => setData(prev => ({ ...prev, domSubRole: role.value }))}
                              className={`p-2.5 rounded-xl border text-left transition-all ${
                                data.domSubRole === role.value
                                  ? "border-purple-500 bg-purple-500/10"
                                  : "border-card-border bg-background-tertiary hover:border-card-border"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-base">{role.emoji}</span>
                                <div>
                                  <span className="font-medium text-foreground text-xs block">{role.label}</span>
                                  <span className="text-[10px] text-foreground-muted">{role.description}</span>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>

                        <div className="mt-4">
                          <h4 className="text-xs font-medium text-foreground-muted mb-2">Experience Level</h4>
                          <div className="flex flex-wrap gap-2">
                            {KINK_EXPERIENCE_OPTIONS.map((exp) => (
                              <button
                                key={exp.value}
                                onClick={() => setData(prev => ({ ...prev, kinkExperienceLevel: exp.value }))}
                                className={`px-3 py-1.5 rounded-full border text-xs transition-all flex items-center gap-1.5 ${
                                  data.kinkExperienceLevel === exp.value
                                    ? "border-purple-500 bg-purple-500/10 text-foreground"
                                    : "border-card-border bg-background-tertiary text-foreground-muted"
                                }`}
                              >
                                <span>{exp.emoji}</span>
                                <span>{exp.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        <p className="text-[10px] text-foreground-subtle mt-3 text-center">
                          All interactions are consent-first. You can update preferences in Settings anytime.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
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
                    Your gender and who you're attracted to
                  </p>
                </div>

                {/* Phase B: Gender Identity Selection */}
                <div className="mb-5">
                  <h3 className="text-xs font-medium text-foreground-muted mb-2 text-center">Your Gender</h3>
                  <div className="flex flex-wrap gap-1.5 justify-center">
                    {GENDER_IDENTITY_OPTIONS.map((opt) => (
                      <motion.button
                        key={opt.value}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.05 }}
                        onClick={() => setData(prev => ({ ...prev, gender: opt.value }))}
                        className={`px-2.5 py-1.5 rounded-full border text-[11px] transition-all flex items-center gap-1 ${
                          data.gender === opt.value
                            ? "border-orange-400 bg-orange-400/15 text-foreground"
                            : "border-card-border/50 bg-transparent text-foreground-muted hover:border-card-border"
                        }`}
                      >
                        <span className="text-xs">{opt.emoji}</span>
                        <span>{opt.label}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Sexuality Selection (expanded Phase B) */}
                <div className="border-t border-card-border/30 pt-4">
                  <h3 className="text-xs font-medium text-foreground-muted mb-2 text-center">Your Sexuality</h3>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {SEXUAL_ORIENTATION_TAGS.map((tag, index) => (
                      <motion.button
                        key={tag.value}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.1 + index * 0.03 }}
                        onClick={() => {
                          setData((prev) => ({ ...prev, sexualOrientation: tag.value }));
                          setTimeout(() => goNext(), 150);
                        }}
                        className={`px-3 py-2 rounded-full border-2 transition-all flex items-center gap-1.5 ${
                          data.sexualOrientation === tag.value
                            ? "border-accent-lime bg-accent-lime/20 text-accent-lime"
                            : "border-card-border bg-background-tertiary text-foreground hover:border-card-border/40"
                        }`}
                      >
                        <span className="text-sm">{tag.emoji}</span>
                        <span className="font-medium text-xs">{tag.label}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>

                <p className="text-center text-xs text-foreground-subtle mt-5">
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
                    <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs">1</span>
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
                            setTimeout(() => goNext(), 150);
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
                            setTimeout(() => goNext(), 150);
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
                            setTimeout(() => goNext(), 150);
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
                        selected ? "bg-primary" : "bg-foreground/15"
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
                    className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center mx-auto mb-4"
                  >
                    <Camera className="w-8 h-8 text-white" />
                  </motion.div>
                  <h1 className="text-2xl font-bold text-foreground mb-2">
                    Show your <span className="text-primary">authentic self</span>
                  </h1>
                  <p className="text-sm text-foreground-muted leading-relaxed">
                    A real photo builds trust. Your face is your best matchmaker.
                  </p>
                </div>

                {/* Avatar Preview — clickable to open gallery */}
                <div className="flex justify-center mb-6">
                  <div className="relative">
                    {data.avatarUrl ? (
                      <AvatarLightbox src={data.avatarUrl} alt="Your photo">
                        <div
                          className="w-36 h-36 rounded-full overflow-hidden border-4"
                          style={{ borderColor: "#10B981" }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={data.avatarUrl}
                            alt="Your photo"
                            className="w-full h-full object-cover object-center"
                            ref={(el) => {
                              if (el) {
                                el.onload = () => console.log("[Avatar] Image loaded, size:", el.naturalWidth, "x", el.naturalHeight);
                                el.onerror = () => console.warn("[Avatar] Image failed to render, length:", data.avatarUrl?.length);
                              }
                            }}
                          />
                        </div>
                      </AvatarLightbox>
                    ) : (
                      <button
                        type="button"
                        onClick={() => !isUploading && fileInputRef.current?.click()}
                        className="w-36 h-36 rounded-full overflow-hidden flex items-center justify-center border-4 transition-all cursor-pointer hover:scale-105 active:scale-95"
                        style={{
                          borderColor: "rgba(76, 29, 149, 0.25)",
                          background: "rgba(76, 29, 149, 0.06)",
                        }}
                      >
                        <div className="flex flex-col items-center gap-2">
                          <Camera className="w-10 h-10 text-foreground-muted" />
                          <span className="text-xs text-foreground-muted font-medium">Tap to upload</span>
                        </div>
                      </button>
                    )}
                    {/* Uploading overlay spinner */}
                    {isUploading && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                        <Loader2 className="w-8 h-8 animate-spin text-white" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Uploading status text */}
                {isUploading && (
                  <p className="text-center text-sm text-foreground-muted mb-4 animate-pulse">
                    Uploading your photo...
                  </p>
                )}

                {/* Upload Options */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {/* Camera / Take Selfie Button — triggers separate camera input */}
                  <button
                    type="button"
                    onClick={() => !isUploading && cameraInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex flex-col items-center justify-center gap-2.5 p-5 rounded-2xl border-2 border-dashed transition-all hover:border-primary/30 active:scale-[0.97]"
                    style={{
                      borderColor: "rgba(76, 29, 149, 0.2)",
                      background: "rgba(76, 29, 149, 0.04)",
                    }}
                  >
                    {isUploading ? (
                      <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
                    ) : (
                      <Camera className="w-6 h-6 text-foreground-muted" />
                    )}
                    <span className="text-sm font-medium text-foreground-muted">
                      Take Selfie
                    </span>
                  </button>

                  {/* Gallery Upload Button */}
                  <button
                    type="button"
                    onClick={() => !isUploading && fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex flex-col items-center justify-center gap-2.5 p-5 rounded-2xl border-2 border-dashed transition-all hover:border-emerald-500/30 active:scale-[0.97]"
                    style={{
                      borderColor: data.avatarUrl ? "rgba(16,185,129,0.5)" : "rgba(76, 29, 149, 0.3)",
                      background: data.avatarUrl ? "rgba(16,185,129,0.08)" : "rgba(76, 29, 149, 0.06)",
                    }}
                  >
                    {isUploading ? (
                      <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
                    ) : (
                      <Upload className="w-6 h-6" style={{ color: data.avatarUrl ? "#10B981" : "#888888" }} />
                    )}
                    <span className="text-sm font-medium" style={{ color: data.avatarUrl ? "#10B981" : "#888888" }}>
                      {data.avatarUrl ? "Change Photo" : "From Gallery"}
                    </span>
                  </button>
                </div>

                {/* Requirement notice */}
                {!data.avatarUrl && (
                  <p className="text-center text-xs px-4 py-2.5 rounded-lg text-foreground-muted bg-background-tertiary border border-card-border">
                    A real headshot is required to continue
                  </p>
                )}

                {data.avatarUrl && (
                  <p className="text-center text-xs mt-2 text-foreground-muted">
                    Looking great! Tap above to change.
                  </p>
                )}

                {/* Gallery input — NO capture attribute, for "From Gallery" and "Tap to upload" */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                {/* Camera input — WITH capture attribute, for "Take Selfie" only */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                {/* Crop Modal — opens after file selected, simplified for onboarding (no gallery tab) */}
                <ImageCropModal
                  isOpen={!!cropImage}
                  imageSrc={cropImage}
                  onClose={() => setCropImage(null)}
                  onCropComplete={handleCropComplete}
                  showCamera={false}
                  maxOutputSize={512}
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
                  Your <span className="text-primary">Relationship Radar</span>
                </h2>
                <p className="text-sm text-foreground-muted mb-6 text-center">
                  Based on your answers, here&apos;s your unique relationship profile
                </p>

                {/* Radar Chart + Analysis — stacked on mobile, side-by-side on desktop */}
                <div className="flex flex-col gap-5 mb-6">
                  {/* Radar Chart — full width, centered */}
                  <div className="rounded-2xl p-6 border border-card-border bg-card flex flex-col items-center justify-center"
                  >
                    <RadarChart data={getRadarData()} />
                  </div>
                  
                  {/* AI Analysis — full width card */}
                  <div className="rounded-2xl p-6 border border-primary/20"
                    style={{
                      background: "linear-gradient(135deg, rgba(76, 29, 149, 0.08) 0%, rgba(139, 92, 246, 0.06) 100%)",
                    }}
                  >
                    <div className="flex items-center gap-2 mb-3.5">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold text-primary">AI Analysis</span>
                    </div>
                    <p className="text-sm leading-relaxed text-foreground" style={{ lineHeight: 1.75 }}>
                      {getRelationshipAnalysis(data)}
                    </p>
                    <div className="mt-4 pt-4 border-t border-primary/10">
                      <div className="flex items-center gap-2 text-xs text-foreground-muted">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        <span>Analysis based on your relationship blueprint</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Profile Summary */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="rounded-xl p-4 border border-card-border bg-card">
                    <p className="text-xs mb-1 text-foreground-muted">Relationship Style</p>
                    <p className="font-semibold text-sm text-foreground">
                      {RELATIONSHIP_DESIRES.find(d => d.value === data.relationshipDesire)?.title || "-"}
                    </p>
                  </div>
                  <div className="rounded-xl p-4 border border-card-border bg-card">
                    <p className="text-xs mb-1 text-foreground-muted">Identity</p>
                    <p className="font-semibold text-sm text-foreground">
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
                  className="flex items-center justify-center gap-2 w-full px-6 py-4 rounded-xl font-semibold bg-gradient-primary text-white hover:opacity-90 transition-opacity"
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
        <div className="fixed bottom-0 left-0 right-0 z-50 px-6 py-4 bg-background/80 backdrop-blur-xl border-t border-card-border">
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
              className="flex items-center gap-2 px-8 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-[#4c1d95] to-[#8b5cf6] text-white disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
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

// Wrap with ErrorBoundary to prevent white-screen crashes on React errors
function OnboardingWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <OnboardingV3Page />
    </ErrorBoundary>
  );
}

export default OnboardingWithErrorBoundary;
