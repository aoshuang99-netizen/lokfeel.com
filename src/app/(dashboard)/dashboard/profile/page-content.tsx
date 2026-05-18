"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Camera, User, Heart, MessageCircle, Target, Save, Loader2, Sparkles, AlertCircle, ImageIcon, Star } from "lucide-react";
import { LoadingButton } from "@/components/shared/loading";
import { LocationPicker } from "@/components/ui/location-picker";
import { GENDER_OPTIONS, SEXUALITY_OPTIONS, DOM_SUB_ROLE_OPTIONS } from "@/constants";
import { toast } from "sonner";
import { ImageCropModal } from "@/components/ui/image-crop-modal";
import { AvatarLightbox } from "@/components/ui/avatar-lightbox";

/** Safe JSON.parse that returns fallback on any error (corrupt data, null, etc.) */
function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (!value || typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; }
  catch { return fallback; }
}

/**
 * Client-side image pre-compression: resize to max 2048px long side, output JPEG.
 * Reduces base64 size before passing to crop modal, preventing upload failures.
 */
function preCompressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX_SIDE = 2048;
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
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("Failed to read image"));
    img.src = URL.createObjectURL(file);
  });
}

const steps = [
  { id: 1, title: "Basic Info", icon: User },
  { id: 2, title: "Identity", icon: Sparkles },
  { id: 3, title: "Relationship Blueprint", icon: Heart },
  { id: 4, title: "Love & Boundaries", icon: MessageCircle },
  { id: 5, title: "Life Priorities", icon: Target },
  { id: 6, title: "Review", icon: Check },
];

export default function ProfilePage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [formData, setFormData] = useState({
    // Step 1: Basic Info
    displayName: "",
    age: 25,
    gender: "woman",
    sexuality: "bisexual",
    bio: "",
    location: "",
    avatar: null as string | null,
    
    // Step 2: Identity (NEW)
    relationshipType: "MONOGAMY",
    
    // Step 3: Relationship Blueprint
    relationshipGoal: "MONOGAMY",
    attachmentStyle: "Secure",
    communicationStyle: "Direct",
    conflictResolution: "Collaborative",
    
    // Step 4: Love & Boundaries
    loveLanguage: "words-of-affirmation",
    dealbreakers: ["", "", ""],
    boundaries: ["", "", ""],
    
    // Step 5: Life Priorities
    priorities: [] as string[],
    emotionalAvailability: "3",
    locationPreferences: [] as string[],
    
    // Photo Gallery
    galleryPhotos: [] as string[],
  });
  const [isUploading, setIsUploading] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [cropAction, setCropAction] = useState<"avatar" | "gallery">("avatar");
  const [stepErrors, setStepErrors] = useState<string[]>([]);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Load existing profile on mount
  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch("/api/profile");
        const data = await res.json();
        
        if (data.profile) {
          setFormData({
            displayName: data.profile.displayName || "",
            age: data.profile.age || 25,
            gender: data.profile.gender?.toLowerCase() || "woman",
            sexuality: data.profile.sexuality?.toLowerCase() || "bisexual",
            bio: data.profile.bio || "",
            location: data.profile.city || "",
            avatar: data.profile.avatar || null,
            // Identity fields
            relationshipType: data.profile.relationshipType || "MONOGAMY",
            relationshipGoal: data.profile.relationshipGoal || "MONOGAMY",
            attachmentStyle: data.profile.attachmentStyle?.toLowerCase() || "secure",
            communicationStyle: data.profile.communicationStyle?.toLowerCase() || "direct",
            conflictResolution: data.profile.conflictResolution?.toLowerCase().replace(/_/g, "-") || "talk-it-out",
            loveLanguage: data.profile.loveLanguage?.toLowerCase().replace(/ /g, "-") || "words-of-affirmation",
            dealbreakers: safeJsonParse(data.profile.dealbreakers, ["", "", ""]),
            boundaries: safeJsonParse(data.profile.boundaries, ["", "", ""]),
            priorities: safeJsonParse(data.profile.lifePriorities, []),
            emotionalAvailability: data.profile.emotionalAvailability || "3",
            locationPreferences: data.profile.preferredLocation ? data.profile.preferredLocation.split(", ") : [],
            galleryPhotos: data.profile.galleryPhotos || [],
          });
          
          // Resume from last completed step
          if (data.profile.onboardingStep && data.profile.onboardingStep > 0) {
            setCurrentStep(Math.min(data.profile.onboardingStep + 1, 5));
          }
        }
      } catch (error) {
        console.error("Failed to load profile:", error);
        toast.error("Failed to load profile data");
      } finally {
        setIsLoading(false);
      }
    }
    
    loadProfile();
  }, []);

  const handleChange = (field: string, value: string | string[] | null) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must be less than 10MB");
      return;
    }

    // Pre-compress large images before crop modal
    setIsUploading(true);
    try {
      const compressed = await preCompressImage(file);
      setCropImage(compressed);
      setCropAction("avatar");
    } catch {
      toast.error("Failed to process image");
    }
    setIsUploading(false);
  };

  // Handle crop complete: upload cropped image
  const handleCropComplete = async (croppedImage: string) => {
    setCropImage(null);
    // Immediately set avatar preview from local crop (no server round-trip delay)
    handleChange("avatar", croppedImage);
    setIsUploading(true);
    try {
      // Convert base64 to blob for multipart upload
      const res = await fetch(croppedImage);
      const blob = await res.blob();
      const formDataUpload = new FormData();
      formDataUpload.append("file", blob, "avatar.jpg");
      formDataUpload.append("type", "avatar");

      const uploadRes = await fetch("/api/upload", {
        method: "PUT",
        body: formDataUpload,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const data = await uploadRes.json();
      // Update with server-processed URL
      handleChange("avatar", data.url);
      toast.success("Avatar uploaded successfully");
    } catch (error) {
      console.error("Upload error:", error);
      // Avatar preview still visible from local crop
      toast.error("Saved locally, but server sync failed. It may not persist after refresh.", {
        duration: 5000,
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Handle gallery photo upload — route through crop modal first
  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must be less than 10MB");
      return;
    }

    // Pre-compress large images before crop modal
    try {
      const compressed = await preCompressImage(file);
      setCropImage(compressed);
      setCropAction("gallery");
    } catch {
      toast.error("Failed to process image");
    }
    // Reset input so same file can be selected again
    e.target.value = "";
  };

  // Save cropped image to gallery (called from ImageCropModal)
  const handleSaveToGallery = async (croppedImage: string) => {
    setCropImage(null);
    setIsUploading(true);
    try {
      const res = await fetch(croppedImage);
      const blob = await res.blob();
      const formDataUpload = new FormData();
      formDataUpload.append("file", blob, "gallery.jpg");
      formDataUpload.append("type", "gallery");

      const uploadRes = await fetch("/api/upload", {
        method: "PUT",
        body: formDataUpload,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const data = await uploadRes.json();
      
      setFormData(prev => ({
        ...prev,
        galleryPhotos: [...prev.galleryPhotos, data.url],
      }));
      toast.success("Photo added to gallery!");
    } catch (error) {
      console.error("Gallery upload error:", error);
      toast.error("Failed to upload photo");
    } finally {
      setIsUploading(false);
    }
  };

  // Set gallery photo as avatar
  const handleSetAsAvatar = async (photoUrl: string) => {
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: photoUrl }),
      });
      if (!res.ok) throw new Error("Failed to update avatar");
      
      handleChange("avatar", photoUrl);
      toast.success("Avatar updated!");
    } catch (error) {
      console.error("Set avatar error:", error);
      toast.error("Failed to set as avatar");
    }
  };

  const handleSaveDraft = async () => {
    setIsSaving(true);
    try {
      const profileData = {
        displayName: formData.displayName,
        age: parseInt(formData.age.toString()),
        gender: formData.gender.toUpperCase(),
        sexuality: formData.sexuality.charAt(0).toUpperCase() + formData.sexuality.slice(1),
        bio: formData.bio,
        city: formData.location,
        avatar: formData.avatar,
        // Blueprint fields (must match Prisma Profile schema exactly)
        relationshipGoal: formData.relationshipGoal,
        attachmentStyle: formData.attachmentStyle.charAt(0).toUpperCase() + formData.attachmentStyle.slice(1),
        communicationStyle: formData.communicationStyle.charAt(0).toUpperCase() + formData.communicationStyle.slice(1),
        conflictResolution: formData.conflictResolution.replace(/-/g, "_").toUpperCase(),
        loveLanguage: formData.loveLanguage.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        dealbreakers: JSON.stringify(formData.dealbreakers.filter(d => d.trim())),
        boundaries: JSON.stringify(formData.boundaries.filter(b => b.trim())),
        lifePriorities: JSON.stringify(formData.priorities),
        emotionalAvailability: formData.emotionalAvailability,
        onboardingStep: currentStep,
      };

      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileData),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.message || errData.error || `Server error ${res.status}`;
        console.error("[Profile SaveDraft] API error:", res.status, errMsg);
        throw new Error(errMsg);
      }
      
      toast.success("Draft saved successfully");
    } catch (error) {
      console.error("[Profile SaveDraft] Error:", error);
      toast.error(`Failed to save draft: ${error instanceof Error ? error.message : "Unknown error"}`, { duration: 5000 });
    } finally {
      setIsSaving(false);
    }
  };

  // Step 1必填验证
  const validateStep1 = (): string[] => {
    const errors: string[] = [];
    if (!formData.avatar) errors.push("Photo is required");
    if (!formData.displayName.trim()) errors.push("Name is required");
    if (!formData.age || formData.age < 18 || formData.age > 120) errors.push("Please enter a valid age (18-120)");
    if (!formData.gender) errors.push("Gender is required");
    if (!formData.location.trim()) errors.push("Location is required");
    return errors;
  };

  // 下一步按钮处理
  const handleNextStep = () => {
    if (currentStep === 1) {
      const errors = validateStep1();
      if (errors.length > 0) {
        setStepErrors(errors);
        toast.error("Please fill in all required fields");
        return;
      }
    }
    setStepErrors([]);
    setCurrentStep((prev) => prev + 1);
  };

  const handleSubmit = async () => {
    // 最终提交前再次验证Step 1必填项
    const errors = validateStep1();
    if (errors.length > 0) {
      setStepErrors(errors);
      toast.error("Please fill in all required fields before submitting");
      setCurrentStep(1); // 回到Step 1
      return;
    }

    setIsSubmitting(true);
    try {
      // First save the profile data
      const profileData = {
        displayName: formData.displayName,
        age: parseInt(formData.age.toString()),
        gender: formData.gender.toUpperCase(),
        sexuality: formData.sexuality.charAt(0).toUpperCase() + formData.sexuality.slice(1),
        bio: formData.bio,
        city: formData.location,
        avatar: formData.avatar,
        // Blueprint fields (must match Prisma Profile schema exactly)
        relationshipGoal: formData.relationshipGoal,
        attachmentStyle: formData.attachmentStyle.charAt(0).toUpperCase() + formData.attachmentStyle.slice(1),
        communicationStyle: formData.communicationStyle.charAt(0).toUpperCase() + formData.communicationStyle.slice(1),
        conflictResolution: formData.conflictResolution.replace(/-/g, "_").toUpperCase(),
        loveLanguage: formData.loveLanguage.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        dealbreakers: JSON.stringify(formData.dealbreakers.filter(d => d.trim())),
        boundaries: JSON.stringify(formData.boundaries.filter(b => b.trim())),
        lifePriorities: JSON.stringify(formData.priorities),
        emotionalAvailability: formData.emotionalAvailability,
        onboardingStep: 9,
        profileStatus: "APPROVED",
      };

      // Profile save with 20s timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const saveRes = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileData),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!saveRes.ok) {
        const errData = await saveRes.json().catch(() => ({}));
        const errMsg = errData.message || errData.error || `Server error ${saveRes.status}`;
        console.error("[Profile Submit] API error:", saveRes.status, errMsg, errData);
        throw new Error(errMsg);
      }

      toast.success("Profile saved successfully! Redirecting...");

      // Use window.location for hard redirect — more reliable than router.push
      // which can be interrupted by React re-renders from setIsSubmitting(false)
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 800);
    } catch (error) {
      console.error("[Profile Submit] Error:", error);
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      const errorMsg = isTimeout
        ? "Save timed out. Please try again."
        : `Failed to save: ${error instanceof Error ? error.message : "Unknown error"}`;
      toast.error(errorMsg, { duration: 8000 });
      setIsSubmitting(false); // Only re-enable on error, so user can retry
    }
    // NOTE: no finally setIsSubmitting(false) — we don't want to re-render
    // the component after a successful save, as it can cancel the redirect.
    // The hard redirect (window.location.href) will unmount the component anyway.
  };

  const progress = ((currentStep - 1) / (steps.length - 1)) * 100;

  // Identity options
  // Use shared constants — same source as Onboarding for data consistency
  const relationshipTypes = [
    { value: "MONOGAMY", label: "Monogamy", description: "Committed to one person exclusively" },
    { value: "ETHICAL_NON_MONOGAMY", label: "Ethical Non-Monogamy", description: "Open relationships with clear boundaries" },
    { value: "POLYAMORY", label: "Polyamory", description: "Multiple loving relationships with consent" },
    { value: "KINK_BDSM", label: "Kink / BDSM", description: "Power dynamics and alternative practices" },
    { value: "CASUAL_DATING", label: "Casual Dating", description: "No labels, see where it goes" },
    { value: "FRIENDSHIP_FIRST", label: "Friendship First", description: "Build connection before romance" },
    { value: "LONG_TERM", label: "Long-term Relationship", description: "Looking for something lasting" },
    { value: "DATING", label: "Dating", description: "Open to dating and seeing what happens" },
    { value: "NOT_SURE", label: "Not Sure Yet", description: "Still figuring it out" },
  ];

  // Use shared SEXUALITY_OPTIONS from constants (24 options, same as Onboarding)
  const sexualOrientations = SEXUALITY_OPTIONS.map(opt => ({
    value: opt.value,
    label: opt.label,
  }));

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-2">Complete Your Profile</h1>
        <p className="text-foreground-muted">Build your relationship blueprint to get better matches</p>
      </div>

      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          {steps.map((step, idx) => (
            <div key={step.id} className="flex items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  currentStep > step.id
                    ? "bg-success text-foreground"
                    : currentStep === step.id
                    ? "bg-gradient-to-br from-primary to-secondary text-foreground"
                    : "bg-background-tertiary text-foreground-subtle"
                }`}
              >
                {currentStep > step.id ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <step.icon className="w-5 h-5" />
                )}
              </div>
              {idx < steps.length - 1 && (
                <div className={`w-12 sm:w-20 h-0.5 mx-2 ${
                  currentStep > step.id ? "bg-success" : "bg-background-tertiary"
                }`} />
              )}
            </div>
          ))}
        </div>
        <div className="h-2 bg-background-tertiary rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-sm text-foreground-muted mt-2 text-center">
          Step {currentStep} of {steps.length}: {steps[currentStep - 1].title}
        </p>
      </div>

      {/* Form Content */}
      <div className="glass-card p-6 mb-6">
        {/* Step 1: Basic Info */}
        {currentStep === 1 && (
          <div className="space-y-6">
            {/* Validation Errors */}
            {stepErrors.length > 0 && (
              <div className="p-4 rounded-xl bg-error/10 border border-error/30">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-error" />
                  <span className="text-sm font-medium text-error">Please fill in required fields</span>
                </div>
                <ul className="list-disc list-inside space-y-0.5">
                  {stepErrors.map((err, i) => (
                    <li key={i} className="text-xs text-error/80">{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Avatar Upload */}
            <div className="flex flex-col items-center">
              <label className="block text-sm font-medium text-foreground mb-3">
                Profile Photo <span className="text-error">*</span>
              </label>
              <div className="relative">
                {formData.avatar ? (
                  <AvatarLightbox src={formData.avatar} alt="Avatar">
                    <div className="w-28 h-28 rounded-full overflow-hidden border-2 border-card-border hover:ring-2 hover:ring-primary/30 transition-all">
                      <img
                        src={formData.avatar}
                        alt="Avatar"
                        className="w-full h-full object-cover object-center"
                        loading="eager"
                        decoding="async"
                      />
                    </div>
                  </AvatarLightbox>
                ) : (
                  <div className="w-28 h-28 rounded-full overflow-hidden bg-background-tertiary border-2 border-card-border">
                    <div className="w-full h-full flex items-center justify-center">
                      <User className="w-10 h-10 text-foreground-subtle" />
                    </div>
                  </div>
                )}
                <label
                  htmlFor="avatar-upload"
                  className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-primary flex items-center justify-center cursor-pointer hover:bg-primary/80 transition-colors shadow-lg"
                >
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 text-foreground animate-spin" />
                  ) : (
                    <Camera className="w-4 h-4 text-foreground" />
                  )}
                </label>
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  disabled={isUploading}
                  className="hidden"
                />

                {/* Image Crop Modal */}
                <ImageCropModal
                  isOpen={!!cropImage}
                  imageSrc={cropImage}
                  onClose={() => setCropImage(null)}
                  onCropComplete={handleCropComplete}
                  showSaveToGallery={true}
                  onSaveToGallery={handleSaveToGallery}
                  defaultAction={cropAction}
                />
              </div>
              <p className="text-xs text-foreground-subtle mt-2">Click camera to upload photo</p>
            </div>

            {/* Photo Gallery */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-medium text-foreground">
                  Photo Gallery
                </label>
                <button
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  Add Photo
                </button>
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleGalleryUpload}
                  className="hidden"
                />
              </div>

              {formData.galleryPhotos.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {formData.galleryPhotos.map((photo, idx) => (
                    <div
                      key={idx}
                      className="relative aspect-square rounded-xl overflow-hidden group cursor-pointer border border-card-border"
                      onClick={() => handleSetAsAvatar(photo)}
                    >
                      <img
                        src={photo}
                        alt={`Gallery ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Star className="w-5 h-5 text-white" />
                      </div>
                      {/* Current avatar indicator */}
                      {formData.avatar === photo && (
                        <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed border-card-border cursor-pointer hover:border-primary/30 transition-colors"
                  onClick={() => galleryInputRef.current?.click()}
                >
                  <ImageIcon className="w-8 h-8 text-foreground-subtle" />
                  <p className="text-xs text-foreground-subtle">No photos yet. Tap to add.</p>
                </div>
              )}
              <p className="text-xs text-foreground-subtle mt-2">
                Tap any photo to set it as your avatar
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Display Name <span className="text-error">*</span></label>
              <input
                type="text"
                value={formData.displayName}
                onChange={(e) => handleChange("displayName", e.target.value)}
                className="input-feeld"
                placeholder="Your name"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Age <span className="text-error">*</span></label>
                <input
                  type="number"
                  value={formData.age}
                  onChange={(e) => handleChange("age", e.target.value)}
                  className="input-feeld"
                  min={18}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Gender <span className="text-error">*</span></label>
                <select
                  value={formData.gender}
                  onChange={(e) => handleChange("gender", e.target.value)}
                  className="input-feeld"
                >
                  {GENDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value.toLowerCase()}>
                      {opt.emoji} {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Sexual Orientation</label>
              <select
                value={formData.sexuality}
                onChange={(e) => handleChange("sexuality", e.target.value)}
                className="input-feeld"
              >
                {SEXUALITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value.toLowerCase()}>
                    {opt.emoji} {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Bio</label>
              <textarea
                value={formData.bio}
                onChange={(e) => handleChange("bio", e.target.value)}
                className="input-feeld min-h-[120px] resize-none"
                placeholder="Tell potential matches about yourself..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Location <span className="text-error">*</span></label>
              <LocationPicker
                value={formData.location}
                onChange={(v) => handleChange("location", v)}
              />
            </div>
          </div>
        )}

        {/* Step 2: Identity */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Relationship Type</label>
              <select
                value={formData.relationshipType}
                onChange={(e) => handleChange("relationshipType", e.target.value)}
                className="input-feeld"
              >
                {relationshipTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label} — {type.description}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Sexual Orientation</label>
              <select
                value={formData.sexuality}
                onChange={(e) => handleChange("sexuality", e.target.value)}
                className="input-feeld"
              >
                {sexualOrientations.map((orientation) => (
                  <option key={orientation.value} value={orientation.value}>
                    {orientation.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Step 3: Relationship Blueprint */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Relationship Goal</label>
              <select
                value={formData.relationshipGoal}
                onChange={(e) => handleChange("relationshipGoal", e.target.value)}
                className="input-feeld"
              >
                <option value="long-term">Long-term partnership</option>
                <option value="marriage">Marriage</option>
                <option value="casual">Casual dating</option>
                <option value="exploring">Not sure yet</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Attachment Style</label>
              <select
                value={formData.attachmentStyle}
                onChange={(e) => handleChange("attachmentStyle", e.target.value)}
                className="input-feeld"
              >
                <option value="secure">Secure (comfortable with intimacy)</option>
                <option value="anxious">Anxious (seek more connection)</option>
                <option value="avoidant">Avoidant (value independence)</option>
                <option value="uncertain">Still figuring it out</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Communication Style</label>
              <select
                value={formData.communicationStyle}
                onChange={(e) => handleChange("communicationStyle", e.target.value)}
                className="input-feeld"
              >
                <option value="direct">Direct (say what I mean)</option>
                <option value="thoughtful">Thoughtful (choose words carefully)</option>
                <option value="warm">Warm (prioritize emotional connection)</option>
                <option value="blunt">Blunt (value honesty over feelings)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Conflict Resolution</label>
              <select
                value={formData.conflictResolution}
                onChange={(e) => handleChange("conflictResolution", e.target.value)}
                className="input-feeld"
              >
                <option value="talk-it-out">Talk it out immediately</option>
                <option value="need-space">Need space first, then talk</option>
                <option value="write-it-out">Process through writing</option>
                <option value="avoid-conflict">Try to avoid conflict</option>
              </select>
            </div>
          </div>
        )}

        {/* Step 4: Love & Boundaries */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Love Language</label>
              <select
                value={formData.loveLanguage}
                onChange={(e) => handleChange("loveLanguage", e.target.value)}
                className="input-feeld"
              >
                <option value="words-of-affirmation">Words of Affirmation</option>
                <option value="acts-of-service">Acts of Service</option>
                <option value="receiving-gifts">Receiving Gifts</option>
                <option value="quality-time">Quality Time</option>
                <option value="physical-touch">Physical Touch</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Top 3 Dealbreakers</label>
              <div className="space-y-2">
                {formData.dealbreakers.map((deal, idx) => (
                  <input
                    key={idx}
                    type="text"
                    value={deal}
                    onChange={(e) => {
                      const updated = [...formData.dealbreakers];
                      updated[idx] = e.target.value;
                      handleChange("dealbreakers", updated);
                    }}
                    className="input-feeld"
                    placeholder={`Dealbreaker ${idx + 1}`}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Key Boundaries</label>
              <div className="space-y-2">
                {formData.boundaries.map((boundary, idx) => (
                  <input
                    key={idx}
                    type="text"
                    value={boundary}
                    onChange={(e) => {
                      const updated = [...formData.boundaries];
                      updated[idx] = e.target.value;
                      handleChange("boundaries", updated);
                    }}
                    className="input-feeld"
                    placeholder={`Boundary ${idx + 1}`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Life Priorities */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Life Priorities (select all that apply)</label>
              <div className="grid grid-cols-2 gap-3">
                {["Career growth", "Family", "Personal development", "Health", "Travel", "Financial stability", "Friendships", "Creativity"].map((priority) => (
                  <label key={priority} className="flex items-center gap-3 p-3 rounded-xl bg-background-tertiary hover:bg-background-tertiary cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={formData.priorities.includes(priority)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          handleChange("priorities", [...formData.priorities, priority]);
                        } else {
                          handleChange("priorities", formData.priorities.filter((p) => p !== priority));
                        }
                      }}
                      className="w-4 h-4 rounded border-card-border bg-background-tertiary text-primary"
                    />
                    <span className="text-sm text-foreground">{priority}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Emotional Availability: {formData.emotionalAvailability}/5
              </label>
              <input
                type="range"
                min={1}
                max={5}
                value={formData.emotionalAvailability}
                onChange={(e) => handleChange("emotionalAvailability", e.target.value)}
                className="w-full h-2 bg-background-tertiary rounded-full appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-foreground-subtle mt-1">
                <span>Less available</span>
                <span>Very available</span>
              </div>
            </div>

          </div>
        )}

        {/* Step 6: Review */}
        {currentStep === 6 && (
          <div className="space-y-6">
            <div className="text-center py-4">
              {formData.avatar ? (
                <div className="w-20 h-20 rounded-full overflow-hidden mx-auto mb-4 border-2 border-primary">
                  <AvatarLightbox src={formData.avatar} alt="Profile">
                    <img src={formData.avatar} alt="Profile" className="w-full h-full object-cover object-center" decoding="async" />
                  </AvatarLightbox>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-4">
                  <Check className="w-10 h-10 text-foreground" />
                </div>
              )}
              <h3 className="text-xl font-semibold text-foreground mb-2">Ready to Submit!</h3>
              <p className="text-foreground-muted">Review your profile and submit for matching</p>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-background-tertiary">
                <h4 className="text-sm font-medium text-foreground-muted mb-2">Basic Info</h4>
                <p className="text-foreground">{formData.displayName}, {formData.age}</p>
                <p className="text-sm text-foreground-muted">{formData.gender} · {formData.sexuality}</p>
              </div>

              <div className="p-4 rounded-xl bg-background-tertiary">
                <h4 className="text-sm font-medium text-foreground-muted mb-2">Relationship Blueprint</h4>
                <p className="text-foreground">Goal: {formData.relationshipGoal}</p>
                <p className="text-foreground">Attachment: {formData.attachmentStyle}</p>
              </div>

              <div className="p-4 rounded-xl bg-background-tertiary">
                <h4 className="text-sm font-medium text-foreground-muted mb-2">Priorities</h4>
                <div className="flex flex-wrap gap-2">
                  {formData.priorities.map((p) => (
                    <span key={p} className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">{p}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-4">
        {currentStep > 1 && (
          <button
            onClick={() => setCurrentStep((prev) => prev - 1)}
            className="btn-secondary flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        )}

        <button
          onClick={handleSaveDraft}
          disabled={isSaving}
          className="btn-ghost flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          {isSaving ? "Saving..." : "Save Draft"}
        </button>

        <div className="flex-1" />

        {currentStep < steps.length ? (
          <button
            onClick={handleNextStep}
            className="btn-primary flex items-center gap-2"
          >
            Next
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <LoadingButton
            onClick={handleSubmit}
            isLoading={isSubmitting}
            className="btn-primary"
          >
            Save Profile
          </LoadingButton>
        )}
      </div>
    </div>
  );
}
