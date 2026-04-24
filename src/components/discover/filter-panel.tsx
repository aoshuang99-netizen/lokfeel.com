"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, SlidersHorizontal, MapPin, Heart, Users, Target } from "lucide-react";
import { toast } from "sonner";

interface FilterOptions {
  genders: { value: string; label: string }[];
  ageRange: { min: number; max: number };
  distanceRange: { min: number; max: number };
  relationshipGoals: { value: string; label: string }[];
  attachmentStyles: { value: string; label: string }[];
  cities: string[];
}

interface FilterState {
  preferredGender: string;
  preferredAgeMin: number;
  preferredAgeMax: number;
  preferredDistance: number;
  relationshipGoal: string | null;
  attachmentStyle: string | null;
  city: string | null;
}

interface FilterPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (filters: FilterState) => void;
}

export function FilterPanel({ isOpen, onClose, onApply }: FilterPanelProps) {
  const [filters, setFilters] = useState<FilterState>({
    preferredGender: "EVERYONE",
    preferredAgeMin: 18,
    preferredAgeMax: 99,
    preferredDistance: 50,
    relationshipGoal: null,
    attachmentStyle: null,
    city: null,
  });
  
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadFilters();
    }
  }, [isOpen]);

  const loadFilters = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/discover/filters");
      if (!res.ok) throw new Error("Failed to load filters");
      const data = await res.json();
      
      setFilters(data.currentFilters);
      setOptions(data.availableOptions);
    } catch (error) {
      toast.error("Failed to load filters");
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = async () => {
    try {
      const res = await fetch("/api/discover/filters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });

      if (!res.ok) throw new Error("Failed to save filters");

      toast.success("Filters updated");
      onApply(filters);
      onClose();
    } catch (error) {
      toast.error("Failed to save filters");
    }
  };

  const handleReset = () => {
    setFilters({
      preferredGender: "EVERYONE",
      preferredAgeMin: 18,
      preferredAgeMax: 99,
      preferredDistance: 50,
      relationshipGoal: null,
      attachmentStyle: null,
      city: null,
    });
    setHasChanges(true);
  };

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  if (isLoading || !options) {
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          >
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md z-50 bg-background border-l border-card-border overflow-y-auto"
          >
            {/* Header */}
            <div className="sticky top-0 bg-background border-b border-card-border px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SlidersHorizontal className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Filters</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-background-tertiary text-foreground-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-8">
              {/* Gender */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-foreground-subtle" />
                  <label className="text-sm font-medium text-foreground">Interested In</label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {options.genders.map((gender) => (
                    <button
                      key={gender.value}
                      onClick={() => updateFilter("preferredGender", gender.value)}
                      className={`px-4 py-2 rounded-full text-sm transition-all ${
                        filters.preferredGender === gender.value
                          ? "bg-primary text-foreground"
                          : "bg-background-tertiary text-foreground-muted hover:bg-background-tertiary border border-card-border"
                      }`}
                    >
                      {gender.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Age Range */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Target className="w-4 h-4 text-foreground-subtle" />
                  <label className="text-sm font-medium text-foreground">Age Range</label>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    value={filters.preferredAgeMin}
                    onChange={(e) => updateFilter("preferredAgeMin", parseInt(e.target.value) || 18)}
                    min={18}
                    max={100}
                    className="w-20 px-3 py-2 rounded-lg bg-background-tertiary border border-card-border text-foreground text-center"
                  />
                  <span className="text-foreground-subtle">to</span>
                  <input
                    type="number"
                    value={filters.preferredAgeMax}
                    onChange={(e) => updateFilter("preferredAgeMax", parseInt(e.target.value) || 99)}
                    min={18}
                    max={100}
                    className="w-20 px-3 py-2 rounded-lg bg-background-tertiary border border-card-border text-foreground text-center"
                  />
                </div>
                <input
                  type="range"
                  min={18}
                  max={100}
                  value={filters.preferredAgeMax}
                  onChange={(e) => updateFilter("preferredAgeMax", parseInt(e.target.value))}
                  className="w-full mt-4 accent-primary"
                />
              </div>

              {/* Distance */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="w-4 h-4 text-foreground-subtle" />
                  <label className="text-sm font-medium text-foreground">Maximum Distance</label>
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <input
                    type="range"
                    min={5}
                    max={500}
                    step={5}
                    value={filters.preferredDistance}
                    onChange={(e) => updateFilter("preferredDistance", parseInt(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <span className="text-sm text-foreground-muted w-20 text-right">
                    {filters.preferredDistance} km
                  </span>
                </div>
              </div>

              {/* Relationship Goal */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Heart className="w-4 h-4 text-foreground-subtle" />
                  <label className="text-sm font-medium text-foreground">Relationship Goal</label>
                </div>
                <div className="space-y-2">
                  {options.relationshipGoals.map((goal) => (
                    <button
                      key={goal.value}
                      onClick={() => updateFilter(
                        "relationshipGoal",
                        filters.relationshipGoal === goal.value ? null : goal.value
                      )}
                      className={`w-full px-4 py-3 rounded-xl border text-left transition-all ${
                        filters.relationshipGoal === goal.value
                          ? "bg-primary/20 border-primary"
                          : "bg-background-tertiary border-card-border hover:bg-background-tertiary"
                      }`}
                    >
                      <span className="text-foreground">{goal.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Attachment Style */}
              <div>
                <label className="text-sm font-medium text-foreground mb-3 block">Attachment Style</label>
                <div className="flex flex-wrap gap-2">
                  {options.attachmentStyles.map((style) => (
                    <button
                      key={style.value}
                      onClick={() => updateFilter(
                        "attachmentStyle",
                        filters.attachmentStyle === style.value ? null : style.value
                      )}
                      className={`px-4 py-2 rounded-full text-sm transition-all ${
                        filters.attachmentStyle === style.value
                          ? "bg-primary text-foreground"
                          : "bg-background-tertiary text-foreground-muted hover:bg-background-tertiary border border-card-border"
                      }`}
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* City Filter (if available) */}
              {options.cities.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-foreground mb-3 block">City</label>
                  <select
                    value={filters.city || ""}
                    onChange={(e) => updateFilter("city", e.target.value || null)}
                    className="w-full px-4 py-3 rounded-xl bg-background-tertiary border border-card-border text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="">Any city</option>
                    {options.cities.map((city) => (
                      <option key={city} value={city}>{city}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-background border-t border-card-border p-6 space-y-3">
              <button
                onClick={handleApply}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-secondary text-foreground font-semibold hover:opacity-90 transition-opacity"
              >
                Apply Filters
              </button>
              <button
                onClick={handleReset}
                className="w-full py-3 text-foreground-muted hover:text-foreground transition-colors"
              >
                Reset to Default
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
