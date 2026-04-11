"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Camera, User, Heart, MessageCircle, Target, Save, Loader2 } from "lucide-react";
import { LoadingButton } from "@/components/shared/loading";
import { toast } from "sonner";

const steps = [
  { id: 1, title: "Basic Info", icon: User },
  { id: 2, title: "Relationship Blueprint", icon: Heart },
  { id: 3, title: "Love & Boundaries", icon: MessageCircle },
  { id: 4, title: "Life Priorities", icon: Target },
  { id: 5, title: "Review", icon: Check },
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
    
    // Step 2: Relationship Blueprint
    relationshipGoal: "LONG_TERM",
    attachmentStyle: "secure",
    communicationStyle: "direct",
    conflictResolution: "talk-it-out",
    
    // Step 3: Love & Boundaries
    loveLanguage: "words-of-affirmation",
    dealbreakers: ["", "", ""],
    boundaries: ["", "", ""],
    
    // Step 4: Life Priorities
    priorities: [] as string[],
    emotionalAvailability: "3",
    locationPreferences: [] as string[],
  });
  const [isUploading, setIsUploading] = useState(false);

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
            relationshipGoal: data.profile.relationshipGoal || "LONG_TERM",
            attachmentStyle: data.profile.attachmentStyle?.toLowerCase() || "secure",
            communicationStyle: data.profile.communicationStyle?.toLowerCase() || "direct",
            conflictResolution: data.profile.conflictResolution?.toLowerCase().replace(/_/g, "-") || "talk-it-out",
            loveLanguage: data.profile.loveLanguage?.toLowerCase().replace(/ /g, "-") || "words-of-affirmation",
            dealbreakers: data.profile.dealbreakers ? JSON.parse(data.profile.dealbreakers) : ["", "", ""],
            boundaries: data.profile.boundaries ? JSON.parse(data.profile.boundaries) : ["", "", ""],
            priorities: data.profile.lifePriorities ? JSON.parse(data.profile.lifePriorities) : [],
            emotionalAvailability: data.profile.emotionalAvailability || "3",
            locationPreferences: data.profile.preferredLocation ? data.profile.preferredLocation.split(", ") : [],
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

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File size must be less than 5MB");
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "avatar");

      const res = await fetch("/api/upload", {
        method: "PUT",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");

      const data = await res.json();
      handleChange("avatar", data.url);
      toast.success("Avatar uploaded successfully");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload avatar");
    } finally {
      setIsUploading(false);
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
        relationshipGoal: formData.relationshipGoal,
        attachmentStyle: formData.attachmentStyle.charAt(0).toUpperCase() + formData.attachmentStyle.slice(1),
        communicationStyle: formData.communicationStyle.charAt(0).toUpperCase() + formData.communicationStyle.slice(1),
        conflictResolution: formData.conflictResolution.replace(/-/g, "_").toUpperCase(),
        loveLanguage: formData.loveLanguage.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        dealbreakers: JSON.stringify(formData.dealbreakers.filter(d => d.trim())),
        boundaries: JSON.stringify(formData.boundaries.filter(b => b.trim())),
        lifePriorities: JSON.stringify(formData.priorities),
        emotionalAvailability: formData.emotionalAvailability,
        preferredLocation: formData.locationPreferences.join(", "),
        onboardingStep: currentStep,
      };

      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileData),
      });

      if (!res.ok) throw new Error("Failed to save");
      
      toast.success("Draft saved successfully");
    } catch (error) {
      console.error("Save error:", error);
      toast.error("Failed to save draft");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async () => {
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
        relationshipGoal: formData.relationshipGoal,
        attachmentStyle: formData.attachmentStyle.charAt(0).toUpperCase() + formData.attachmentStyle.slice(1),
        communicationStyle: formData.communicationStyle.charAt(0).toUpperCase() + formData.communicationStyle.slice(1),
        conflictResolution: formData.conflictResolution.replace(/-/g, "_").toUpperCase(),
        loveLanguage: formData.loveLanguage.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        dealbreakers: JSON.stringify(formData.dealbreakers.filter(d => d.trim())),
        boundaries: JSON.stringify(formData.boundaries.filter(b => b.trim())),
        lifePriorities: JSON.stringify(formData.priorities),
        emotionalAvailability: formData.emotionalAvailability,
        preferredLocation: formData.locationPreferences.join(", "),
        onboardingStep: 5,
      };

      const saveRes = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileData),
      });

      if (!saveRes.ok) throw new Error("Failed to save profile");

      // Then submit for review
      const submitRes = await fetch("/api/profile/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!submitRes.ok) throw new Error("Failed to submit");

      toast.success("Profile submitted successfully!");
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      console.error("Submit error:", error);
      toast.error("Failed to submit profile");
    } finally {
      setIsSubmitting(false);
    }
  };

  const progress = ((currentStep - 1) / (steps.length - 1)) * 100;

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
        <h1 className="text-2xl font-bold text-white mb-2">Complete Your Profile</h1>
        <p className="text-white/60">Build your relationship blueprint to get better matches</p>
      </div>

      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          {steps.map((step, idx) => (
            <div key={step.id} className="flex items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  currentStep > step.id
                    ? "bg-success text-white"
                    : currentStep === step.id
                    ? "bg-gradient-to-br from-primary to-secondary text-white"
                    : "bg-white/10 text-white/40"
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
                  currentStep > step.id ? "bg-success" : "bg-white/10"
                }`} />
              )}
            </div>
          ))}
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-sm text-white/60 mt-2 text-center">
          Step {currentStep} of {steps.length}: {steps[currentStep - 1].title}
        </p>
      </div>

      {/* Form Content */}
      <div className="glass-card p-6 mb-6">
        {/* Step 1: Basic Info */}
        {currentStep === 1 && (
          <div className="space-y-6">
            {/* Avatar Upload */}
            <div className="flex flex-col items-center">
              <label className="block text-sm font-medium text-white/80 mb-3">Profile Photo</label>
              <div className="relative">
                <div className="w-24 h-24 rounded-full overflow-hidden bg-white/10 border-2 border-white/20">
                  {formData.avatar ? (
                    <img
                      src={formData.avatar}
                      alt="Avatar"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <User className="w-10 h-10 text-white/40" />
                    </div>
                  )}
                </div>
                <label
                  htmlFor="avatar-upload"
                  className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-primary flex items-center justify-center cursor-pointer hover:bg-primary/80 transition-colors shadow-lg"
                >
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 text-white animate-spin" />
                  ) : (
                    <Camera className="w-4 h-4 text-white" />
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
              </div>
              <p className="text-xs text-white/40 mt-2">Click camera to upload photo</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Display Name</label>
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
                <label className="block text-sm font-medium text-white/80 mb-2">Age</label>
                <input
                  type="number"
                  value={formData.age}
                  onChange={(e) => handleChange("age", e.target.value)}
                  className="input-feeld"
                  min={18}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Gender</label>
                <select
                  value={formData.gender}
                  onChange={(e) => handleChange("gender", e.target.value)}
                  className="input-feeld"
                >
                  <option value="woman">Woman</option>
                  <option value="man">Man</option>
                  <option value="non-binary">Non-binary</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Sexual Orientation</label>
              <select
                value={formData.sexuality}
                onChange={(e) => handleChange("sexuality", e.target.value)}
                className="input-feeld"
              >
                <option value="straight">Straight</option>
                <option value="gay">Gay</option>
                <option value="bisexual">Bisexual</option>
                <option value="pansexual">Pansexual</option>
                <option value="queer">Queer</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Bio</label>
              <textarea
                value={formData.bio}
                onChange={(e) => handleChange("bio", e.target.value)}
                className="input-feeld min-h-[120px] resize-none"
                placeholder="Tell potential matches about yourself..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Location</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => handleChange("location", e.target.value)}
                className="input-feeld"
              />
            </div>
          </div>
        )}

        {/* Step 2: Relationship Blueprint */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Relationship Goal</label>
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
              <label className="block text-sm font-medium text-white/80 mb-2">Attachment Style</label>
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
              <label className="block text-sm font-medium text-white/80 mb-2">Communication Style</label>
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
              <label className="block text-sm font-medium text-white/80 mb-2">Conflict Resolution</label>
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

        {/* Step 3: Love & Boundaries */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Love Language</label>
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
              <label className="block text-sm font-medium text-white/80 mb-2">Top 3 Dealbreakers</label>
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
              <label className="block text-sm font-medium text-white/80 mb-2">Key Boundaries</label>
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

        {/* Step 4: Life Priorities */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Life Priorities (select all that apply)</label>
              <div className="grid grid-cols-2 gap-3">
                {["Career growth", "Family", "Personal development", "Health", "Travel", "Financial stability", "Friendships", "Creativity"].map((priority) => (
                  <label key={priority} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
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
                      className="w-4 h-4 rounded border-white/20 bg-white/5 text-primary"
                    />
                    <span className="text-sm text-white/80">{priority}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Emotional Availability: {formData.emotionalAvailability}/5
              </label>
              <input
                type="range"
                min={1}
                max={5}
                value={formData.emotionalAvailability}
                onChange={(e) => handleChange("emotionalAvailability", e.target.value)}
                className="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-white/40 mt-1">
                <span>Less available</span>
                <span>Very available</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Location Preferences</label>
              <input
                type="text"
                value={formData.locationPreferences.join(", ")}
                onChange={(e) => handleChange("locationPreferences", e.target.value.split(", "))}
                className="input-feeld"
                placeholder="San Francisco, Los Angeles, Seattle..."
              />
              <p className="text-xs text-white/40 mt-1">Comma-separated cities</p>
            </div>
          </div>
        )}

        {/* Step 5: Review */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <div className="text-center py-4">
              {formData.avatar ? (
                <div className="w-20 h-20 rounded-full overflow-hidden mx-auto mb-4 border-2 border-primary">
                  <img src={formData.avatar} alt="Profile" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-4">
                  <Check className="w-10 h-10 text-white" />
                </div>
              )}
              <h3 className="text-xl font-semibold text-white mb-2">Ready to Submit!</h3>
              <p className="text-white/60">Review your profile and submit for matching</p>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-white/5">
                <h4 className="text-sm font-medium text-white/60 mb-2">Basic Info</h4>
                <p className="text-white">{formData.displayName}, {formData.age}</p>
                <p className="text-sm text-white/60">{formData.gender} · {formData.sexuality}</p>
              </div>

              <div className="p-4 rounded-xl bg-white/5">
                <h4 className="text-sm font-medium text-white/60 mb-2">Relationship Blueprint</h4>
                <p className="text-white">Goal: {formData.relationshipGoal}</p>
                <p className="text-white">Attachment: {formData.attachmentStyle}</p>
              </div>

              <div className="p-4 rounded-xl bg-white/5">
                <h4 className="text-sm font-medium text-white/60 mb-2">Priorities</h4>
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
            onClick={() => setCurrentStep((prev) => prev + 1)}
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
            Submit Profile
          </LoadingButton>
        )}
      </div>
    </div>
  );
}
