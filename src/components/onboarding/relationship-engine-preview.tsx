"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Heart, 
  Sparkles, 
  Shield, 
  MessageCircle, 
  Target, 
  Brain,
  Zap,
  TrendingUp,
  Users,
  ChevronRight,
  RefreshCw
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface UserPreferences {
  attachmentStyle?: string;
  communicationStyle?: string;
  conflictResolution?: string;
  loveLanguage?: string;
  lifePriorities?: string[];
  emotionalAvailability?: string;
  relationshipGoal?: string;
  relationshipType?: string;
  sexualOrientation?: string;
  preferredGender?: string;
  preferredAgeMin?: number;
  preferredAgeMax?: number;
}

interface MatchDimension {
  id: string;
  name: string;
  icon: React.ElementType;
  score: number;
  maxScore: number;
  description: string;
  color: string;
}

interface SimulatedMatch {
  id: string;
  name: string;
  age: number;
  avatar: string;
  location: string;
  overallScore: number;
  dimensions: MatchDimension[];
  matchReason: string;
  compatibility: "high" | "medium" | "low";
}

// ═══════════════════════════════════════════════════════════════
// DIMENSION DEFINITIONS
// ═══════════════════════════════════════════════════════════════

const DIMENSIONS = [
  { id: "attachment", name: "Attachment", icon: Shield, maxScore: 20, color: "#4c1d95", description: "Emotional bonding style" },
  { id: "communication", name: "Communication", icon: MessageCircle, maxScore: 15, color: "#8b5cf6", description: "How you express & listen" },
  { id: "conflict", name: "Conflict", icon: Brain, maxScore: 15, color: "#f59e0b", description: "Disagreement handling" },
  { id: "values", name: "Values", icon: Target, maxScore: 15, color: "#a3e635", description: "Life priorities & love language" },
  { id: "lifestyle", name: "Lifestyle", icon: Users, maxScore: 10, color: "#f472b6", description: "Daily habits & goals" },
  { id: "relationship", name: "Relationship", icon: Heart, maxScore: 15, color: "#8b5cf6", description: "Relationship type match" },
  { id: "orientation", name: "Orientation", icon: Sparkles, maxScore: 10, color: "#06b6d4", description: "Sexual orientation align" },
];

// ═══════════════════════════════════════════════════════════════
// SIMULATED USERS DATABASE
// ═══════════════════════════════════════════════════════════════

const SIMULATED_USERS = [
  { id: "1", name: "Sarah", age: 28, location: "San Francisco", avatar: "https://randomuser.me/api/portraits/women/1.jpg" },
  { id: "2", name: "Emma", age: 26, location: "New York", avatar: "https://randomuser.me/api/portraits/women/2.jpg" },
  { id: "3", name: "Jessica", age: 30, location: "Los Angeles", avatar: "https://randomuser.me/api/portraits/women/3.jpg" },
  { id: "4", name: "Michael", age: 32, location: "Chicago", avatar: "https://randomuser.me/api/portraits/men/1.jpg" },
  { id: "5", name: "David", age: 29, location: "Seattle", avatar: "https://randomuser.me/api/portraits/men/2.jpg" },
  { id: "6", name: "Alex", age: 27, location: "Austin", avatar: "https://randomuser.me/api/portraits/women/4.jpg" },
];

// ═══════════════════════════════════════════════════════════════
// COMPATIBILITY MATRICES
// ═══════════════════════════════════════════════════════════════

const ATTACHMENT_COMPAT: Record<string, Record<string, number>> = {
  "Secure": { "Secure": 95, "Anxious-Preoccupied": 80, "Dismissive-Avoidant": 75, "Fearful-Avoidant": 70 },
  "Anxious-Preoccupied": { "Secure": 80, "Anxious-Preoccupied": 60, "Dismissive-Avoidant": 40, "Fearful-Avoidant": 50 },
  "Dismissive-Avoidant": { "Secure": 75, "Anxious-Preoccupied": 40, "Dismissive-Avoidant": 55, "Fearful-Avoidant": 45 },
  "Fearful-Avoidant": { "Secure": 70, "Anxious-Preoccupied": 50, "Dismissive-Avoidant": 45, "Fearful-Avoidant": 50 },
};

const COMMUNICATION_COMPAT: Record<string, Record<string, number>> = {
  "Direct": { "Direct": 90, "Reflective": 75, "Expressive": 70, "Analytical": 65, "Supportive": 80 },
  "Reflective": { "Direct": 75, "Reflective": 85, "Expressive": 65, "Analytical": 80, "Supportive": 85 },
  "Expressive": { "Direct": 70, "Reflective": 65, "Expressive": 90, "Analytical": 55, "Supportive": 85 },
  "Analytical": { "Direct": 65, "Reflective": 80, "Expressive": 55, "Analytical": 90, "Supportive": 70 },
  "Supportive": { "Direct": 80, "Reflective": 85, "Expressive": 85, "Analytical": 70, "Supportive": 90 },
};

const CONFLICT_COMPAT: Record<string, Record<string, number>> = {
  "Collaborative": { "Collaborative": 95, "Compromising": 85, "Accommodating": 70, "Competing": 50, "Avoiding": 55, "Negotiating": 90 },
  "Compromising": { "Collaborative": 85, "Compromising": 80, "Accommodating": 75, "Competing": 60, "Avoiding": 65, "Negotiating": 85 },
  "Accommodating": { "Collaborative": 70, "Compromising": 75, "Accommodating": 65, "Competing": 40, "Avoiding": 70, "Negotiating": 75 },
  "Competing": { "Collaborative": 50, "Compromising": 60, "Accommodating": 40, "Competing": 55, "Avoiding": 35, "Negotiating": 60 },
  "Avoiding": { "Collaborative": 55, "Compromising": 65, "Accommodating": 70, "Competing": 35, "Avoiding": 50, "Negotiating": 60 },
  "Negotiating": { "Collaborative": 90, "Compromising": 85, "Accommodating": 75, "Competing": 60, "Avoiding": 60, "Negotiating": 90 },
};

const RELATIONSHIP_TYPE_COMPAT: Record<string, Record<string, number>> = {
  "MONOGAMY": { "MONOGAMY": 95, "ETHICAL_NON_MONOGAMY": 30, "POLYAMORY": 20, "KINK_BDSM": 60, "CASUAL_DATING": 40, "FRIENDSHIP_FIRST": 70 },
  "ETHICAL_NON_MONOGAMY": { "MONOGAMY": 30, "ETHICAL_NON_MONOGAMY": 90, "POLYAMORY": 85, "KINK_BDSM": 75, "CASUAL_DATING": 70, "FRIENDSHIP_FIRST": 65 },
  "POLYAMORY": { "MONOGAMY": 20, "ETHICAL_NON_MONOGAMY": 85, "POLYAMORY": 95, "KINK_BDSM": 70, "CASUAL_DATING": 65, "FRIENDSHIP_FIRST": 60 },
  "KINK_BDSM": { "MONOGAMY": 60, "ETHICAL_NON_MONOGAMY": 75, "POLYAMORY": 70, "KINK_BDSM": 95, "CASUAL_DATING": 65, "FRIENDSHIP_FIRST": 50 },
  "CASUAL_DATING": { "MONOGAMY": 40, "ETHICAL_NON_MONOGAMY": 70, "POLYAMORY": 65, "KINK_BDSM": 65, "CASUAL_DATING": 90, "FRIENDSHIP_FIRST": 75 },
  "FRIENDSHIP_FIRST": { "MONOGAMY": 70, "ETHICAL_NON_MONOGAMY": 65, "POLYAMORY": 60, "KINK_BDSM": 50, "CASUAL_DATING": 75, "FRIENDSHIP_FIRST": 85 },
};

// ═══════════════════════════════════════════════════════════════
// SCORING FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function calculateDimensionScore(
  userValue: string | undefined,
  matchValue: string,
  matrix: Record<string, Record<string, number>>,
  defaultScore: number = 50
): number {
  if (!userValue) return defaultScore;
  return matrix[userValue]?.[matchValue] || matrix[matchValue]?.[userValue] || defaultScore;
}

function calculateValuesScore(
  userPriorities: string[] | undefined,
  matchPriorities: string[]
): number {
  if (!userPriorities || userPriorities.length === 0) return 60;
  const common = userPriorities.filter(p => matchPriorities.includes(p));
  const totalUnique = new Set([...userPriorities, ...matchPriorities]).size;
  return Math.round(50 + (common.length / Math.max(1, totalUnique)) * 50);
}

function calculateLifestyleScore(
  userGoal: string | undefined,
  matchGoal: string,
  userAvailability: string | undefined,
  matchAvailability: string
): number {
  let score = 60;
  
  // Relationship goal alignment
  if (userGoal === matchGoal) score += 20;
  else if (userGoal && matchGoal) {
    const compatibleGoals: Record<string, string[]> = {
      "MONOGAMY": ["CASUAL_DATING", "FRIENDSHIP_FIRST"],
      "CASUAL_DATING": ["MONOGAMY", "FRIENDSHIP_FIRST", "ETHICAL_NON_MONOGAMY"],
      "FRIENDSHIP_FIRST": ["MONOGAMY", "CASUAL_DATING"],
      "ETHICAL_NON_MONOGAMY": ["POLYAMORY", "CASUAL_DATING", "KINK_BDSM"],
      "POLYAMORY": ["ETHICAL_NON_MONOGAMY", "CASUAL_DATING"],
      "KINK_BDSM": ["ETHICAL_NON_MONOGAMY", "POLYAMORY"],
    };
    if (compatibleGoals[userGoal]?.includes(matchGoal)) score += 10;
  }
  
  // Emotional availability alignment
  if (userAvailability === matchAvailability) score += 15;
  else if (userAvailability === "Fully Available" && matchAvailability === "Building Trust") score += 10;
  
  return Math.min(100, score);
}

function generateMatchReason(scores: Record<string, number>, userPrefs: UserPreferences): string {
  const reasons: string[] = [];
  
  if (scores.attachment >= 80) reasons.push("Your attachment styles create emotional safety");
  if (scores.communication >= 80) reasons.push("You communicate in compatible ways");
  if (scores.conflict >= 80) reasons.push("Your conflict resolution approaches align");
  if (scores.values >= 75) reasons.push("Shared values point to aligned goals");
  if (scores.relationship >= 85) reasons.push("You seek similar relationship structures");
  
  if (reasons.length === 0) {
    if (scores.overall >= 75) reasons.push("Strong overall compatibility worth exploring");
    else if (scores.overall >= 60) reasons.push("Moderate compatibility with growth potential");
    else reasons.push("Interesting differences that could complement each other");
  }
  
  return reasons.slice(0, 2).join(". ") + ".";
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

interface RelationshipEnginePreviewProps {
  userPreferences: UserPreferences;
  isActive?: boolean;
}

export function RelationshipEnginePreview({ 
  userPreferences, 
  isActive = true 
}: RelationshipEnginePreviewProps) {
  const [isCalculating, setIsCalculating] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);

  // Generate simulated matches based on user preferences
  const simulatedMatches = useMemo<SimulatedMatch[]>(() => {
    if (!isActive) return [];
    
    return SIMULATED_USERS.map((user, index) => {
      // Generate pseudo-random but consistent values for this simulated user
      const seed = index + 1;
      
      const matchAttachment = ["Secure", "Anxious-Preoccupied", "Dismissive-Avoidant", "Fearful-Avoidant"][seed % 4];
      const matchCommunication = ["Direct", "Reflective", "Expressive", "Analytical", "Supportive"][seed % 5];
      const matchConflict = ["Collaborative", "Compromising", "Accommodating", "Competing", "Avoiding", "Negotiating"][seed % 6];
      const matchRelationshipType = ["MONOGAMY", "ETHICAL_NON_MONOGAMY", "POLYAMORY", "KINK_BDSM", "CASUAL_DATING", "FRIENDSHIP_FIRST"][seed % 6];
      const matchGoal = ["MONOGAMY", "CASUAL_DATING", "FRIENDSHIP_FIRST", "ETHICAL_NON_MONOGAMY", "POLYAMORY", "KINK_BDSM"][seed % 6];
      const matchAvailability = ["Fully Available", "Building Trust", "Processing Past", "Needs Space", "Curious & Open"][seed % 5];
      
      // Calculate dimension scores
      const attachmentScore = calculateDimensionScore(
        userPreferences.attachmentStyle, 
        matchAttachment, 
        ATTACHMENT_COMPAT
      );
      
      const communicationScore = calculateDimensionScore(
        userPreferences.communicationStyle,
        matchCommunication,
        COMMUNICATION_COMPAT
      );
      
      const conflictScore = calculateDimensionScore(
        userPreferences.conflictResolution,
        matchConflict,
        CONFLICT_COMPAT
      );
      
      const relationshipScore = calculateDimensionScore(
        userPreferences.relationshipType,
        matchRelationshipType,
        RELATIONSHIP_TYPE_COMPAT,
        60
      );
      
      const valuesScore = calculateValuesScore(
        userPreferences.lifePriorities,
        ["Career & Ambition", "Family & Children", "Adventure & Travel"].slice(0, (seed % 3) + 1)
      );
      
      const lifestyleScore = calculateLifestyleScore(
        userPreferences.relationshipGoal,
        matchGoal,
        userPreferences.emotionalAvailability,
        matchAvailability
      );
      
      // Orientation score (simplified)
      const orientationScore = 70 + (seed % 25);
      
      // Calculate weighted overall score
      const overallScore = Math.round(
        attachmentScore * 0.20 +
        communicationScore * 0.15 +
        conflictScore * 0.15 +
        valuesScore * 0.15 +
        lifestyleScore * 0.10 +
        relationshipScore * 0.15 +
        orientationScore * 0.10
      );
      
      const dimensions: MatchDimension[] = [
        { id: "attachment", name: "Attachment", icon: Shield, score: Math.round(attachmentScore * 0.20), maxScore: 20, description: "Emotional bonding", color: "#4c1d95" },
        { id: "communication", name: "Communication", icon: MessageCircle, score: Math.round(communicationScore * 0.15), maxScore: 15, description: "Expression style", color: "#8b5cf6" },
        { id: "conflict", name: "Conflict", icon: Brain, score: Math.round(conflictScore * 0.15), maxScore: 15, description: "Disagreement handling", color: "#f59e0b" },
        { id: "values", name: "Values", icon: Target, score: Math.round(valuesScore * 0.15), maxScore: 15, description: "Life priorities", color: "#a3e635" },
        { id: "lifestyle", name: "Lifestyle", icon: Users, score: Math.round(lifestyleScore * 0.10), maxScore: 10, description: "Daily habits", color: "#f472b6" },
        { id: "relationship", name: "Relationship", icon: Heart, score: Math.round(relationshipScore * 0.15), maxScore: 15, description: "Relationship type", color: "#8b5cf6" },
        { id: "orientation", name: "Orientation", icon: Sparkles, score: Math.round(orientationScore * 0.10), maxScore: 10, description: "Orientation align", color: "#06b6d4" },
      ];
      
      const dimensionScores: Record<string, number> = {
        attachment: attachmentScore,
        communication: communicationScore,
        conflict: conflictScore,
        values: valuesScore,
        lifestyle: lifestyleScore,
        relationship: relationshipScore,
        orientation: orientationScore,
        overall: overallScore,
      };
      
      return {
        id: user.id,
        name: user.name,
        age: user.age,
        avatar: user.avatar,
        location: user.location,
        overallScore,
        dimensions,
        matchReason: generateMatchReason(dimensionScores, userPreferences),
        compatibility: (overallScore >= 80 ? "high" : overallScore >= 60 ? "medium" : "low") as "high" | "medium" | "low",
      };
    }).sort((a, b) => b.overallScore - a.overallScore);
  }, [userPreferences, isActive]);

  // Auto-rotate through matches
  useEffect(() => {
    if (!isActive || simulatedMatches.length === 0) return;
    
    const interval = setInterval(() => {
      setCurrentMatchIndex((prev) => (prev + 1) % Math.min(3, simulatedMatches.length));
    }, 5000);
    
    return () => clearInterval(interval);
  }, [isActive, simulatedMatches.length]);

  // Trigger calculation animation when preferences change
  useEffect(() => {
    setIsCalculating(true);
    const timer = setTimeout(() => setIsCalculating(false), 600);
    return () => clearTimeout(timer);
  }, [userPreferences]);

  const currentMatch = simulatedMatches[currentMatchIndex];
  const topMatches = simulatedMatches.slice(0, 3);

  if (!isActive || simulatedMatches.length === 0) {
    return (
      <div className="rounded-2xl p-6 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-50" style={{ color: "#fff" }} />
        <p className="text-sm opacity-60">Complete more steps to see your compatibility preview</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4" style={{ color: "#fbbf24" }} />
          <span className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.9)" }}>
            Live Compatibility Preview
          </span>
        </div>
        {isCalculating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-1 text-xs"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            <RefreshCw className="w-3 h-3 animate-spin" />
            Calculating...
          </motion.div>
        )}
      </div>

      {/* Main Match Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentMatch.id + isCalculating}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {/* Match Header */}
          <div className="p-4 flex items-center gap-4">
            <div className="relative">
              <img
                src={currentMatch.avatar}
                alt={currentMatch.name}
                className="w-14 h-14 rounded-full object-cover"
                style={{ border: "2px solid rgba(255,255,255,0.2)" }}
              />
              <div 
                className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ 
                  background: currentMatch.compatibility === "high" ? "#a3e635" : currentMatch.compatibility === "medium" ? "#f59e0b" : "#ef4444",
                  color: "#000",
                }}
              >
                {currentMatch.overallScore}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-foreground truncate">
                {currentMatch.name}, {currentMatch.age}
              </h4>
              <p className="text-xs opacity-60 truncate">{currentMatch.location}</p>
              <p className="text-xs mt-1 opacity-80 line-clamp-1">{currentMatch.matchReason}</p>
            </div>
          </div>

          {/* Dimension Breakdown */}
          <div className="px-4 pb-4">
            <div className="grid grid-cols-7 gap-1">
              {currentMatch.dimensions.map((dim) => (
                <div key={dim.id} className="text-center">
                  <div 
                    className="w-full aspect-square rounded-lg flex items-center justify-center mb-1 relative overflow-hidden"
                    style={{ background: "rgba(255,255,255,0.05)" }}
                  >
                    <motion.div
                      initial={{ height: "0%" }}
                      animate={{ height: `${(dim.score / dim.maxScore) * 100}%` }}
                      transition={{ duration: 0.5, delay: 0.1 }}
                      className="absolute bottom-0 left-0 right-0"
                      style={{ background: dim.color, opacity: 0.3 }}
                    />
                    <dim.icon className="w-3.5 h-3.5 relative z-10" style={{ color: dim.color }} />
                  </div>
                  <span className="text-[10px] opacity-50">{dim.score}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] opacity-40 mt-2 px-1">
              <span>0</span>
              <span>Dimension Scores (max 100)</span>
              <span>100</span>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Top Matches List */}
      <div className="space-y-2">
        <p className="text-xs opacity-50 mb-2">Your top compatible matches:</p>
        {topMatches.map((match, index) => (
          <motion.button
            key={match.id}
            onClick={() => setCurrentMatchIndex(index)}
            className="w-full flex items-center gap-3 p-2 rounded-xl transition-all"
            style={{ 
              background: currentMatchIndex === index ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${currentMatchIndex === index ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)"}`,
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <img
              src={match.avatar}
              alt={match.name}
              className="w-8 h-8 rounded-full object-cover"
            />
            <div className="flex-1 text-left">
              <span className="text-sm font-medium text-foreground">{match.name}</span>
              <span className="text-xs opacity-50 ml-2">{match.age}</span>
            </div>
            <div 
              className="px-2 py-0.5 rounded-full text-xs font-bold"
              style={{ 
                background: match.compatibility === "high" ? "rgba(163, 230, 53, 0.2)" : match.compatibility === "medium" ? "rgba(245,158,11,0.2)" : "rgba(239,68,68,0.2)",
                color: match.compatibility === "high" ? "#a3e635" : match.compatibility === "medium" ? "#f59e0b" : "#ef4444",
              }}
            >
              {match.overallScore}%
            </div>
          </motion.button>
        ))}
      </div>

      {/* Engine Stats */}
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-card-border">
        <div className="text-center">
          <p className="text-lg font-bold text-foreground">7</p>
          <p className="text-[10px] opacity-50">Dimensions</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-foreground">{Math.round(topMatches.reduce((a, m) => a + m.overallScore, 0) / topMatches.length)}%</p>
          <p className="text-[10px] opacity-50">Avg Match</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-foreground">{topMatches.filter(m => m.overallScore >= 75).length}</p>
          <p className="text-[10px] opacity-50">High Match</p>
        </div>
      </div>

      {/* Info Note */}
      <p className="text-[10px] opacity-40 text-center">
        This is a preview based on your current selections. Real matches will use live user data.
      </p>
    </div>
  );
}

export default RelationshipEnginePreview;
