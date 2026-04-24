"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lightbulb, RefreshCw, Send, Sparkles, MessageCircle } from "lucide-react";
import { toast } from "sonner";

interface IcebreakerSuggestionsProps {
  roomId: string;
  otherUserName: string;
  matchScore: number;
  onSelect: (message: string) => void;
}

interface Icebreaker {
  id: string;
  category: string;
  message: string;
  icon: string;
}

const ICEBREAKER_TEMPLATES: Omit<Icebreaker, "id">[] = [
  // General
  { category: "General", message: "What's something you're looking forward to this week?", icon: "✨" },
  { category: "General", message: "If you could have dinner with anyone, living or dead, who would it be?", icon: "🍽️" },
  { category: "General", message: "What's your favorite way to spend a weekend?", icon: "🌟" },
  
  // Relationship-focused
  { category: "Connection", message: "What does a meaningful connection look like to you?", icon: "💫" },
  { category: "Connection", message: "What's something you've learned about yourself recently?", icon: "🌱" },
  { category: "Connection", message: "What quality do you value most in a partner?", icon: "💎" },
  
  // Fun & Light
  { category: "Fun", message: "What's your go-to comfort food?", icon: "🍕" },
  { category: "Fun", message: "If you could instantly master any skill, what would it be?", icon: "🎯" },
  { category: "Fun", message: "What's the last book, movie, or show that really got you thinking?", icon: "📚" },
  { category: "Fun", message: "Do you have any hidden talents or hobbies?", icon: "🎨" },
  
  // Values
  { category: "Values", message: "What cause or issue are you passionate about?", icon: "🔥" },
  { category: "Values", message: "What's a dealbreaker for you in relationships?", icon: "⚡" },
  { category: "Values", message: "How do you usually recharge after a long week?", icon: "🔋" },
  
  // Adventure
  { category: "Adventure", message: "What's the most spontaneous thing you've ever done?", icon: "🎲" },
  { category: "Adventure", message: "If you could travel anywhere right now, where would you go?", icon: "✈️" },
  { category: "Adventure", message: "What's on your bucket list this year?", icon: "📝" },
];

export function IcebreakerSuggestions({
  roomId,
  otherUserName,
  matchScore,
  onSelect,
}: IcebreakerSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<Icebreaker[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = [...new Set(ICEBREAKER_TEMPLATES.map((i) => i.category))];

  useEffect(() => {
    generateSuggestions();
  }, [roomId]);

  const generateSuggestions = () => {
    // Shuffle and pick 3 random suggestions
    const shuffled = [...ICEBREAKER_TEMPLATES].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 3).map((item, idx) => ({
      ...item,
      id: `${roomId}-${idx}`,
    }));
    setSuggestions(selected);
  };

  const getFilteredSuggestions = () => {
    if (!selectedCategory) return ICEBREAKER_TEMPLATES;
    return ICEBREAKER_TEMPLATES.filter((i) => i.category === selectedCategory);
  };

  const handleSelect = (message: string) => {
    onSelect(message);
    setIsExpanded(false);
    toast.success("Icebreaker added!");
  };

  return (
    <div className="mb-4">
      {/* Collapsed View - Quick Suggestions */}
      {!isExpanded && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-3"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Lightbulb className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h4 className="text-sm font-medium text-foreground">Icebreakers</h4>
                <p className="text-xs text-foreground-muted">Break the silence</p>
              </div>
            </div>
            <button
              onClick={() => setIsExpanded(true)}
              className="text-xs text-primary hover:text-primary/80 transition-colors"
            >
              See all
            </button>
          </div>

          <div className="space-y-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                onClick={() => handleSelect(suggestion.message)}
                className="w-full p-3 rounded-xl bg-background-tertiary hover:bg-background-tertiary border border-card-border hover:border-card-border transition-all text-left group"
              >
                <div className="flex items-start gap-3">
                  <span className="text-lg">{suggestion.icon}</span>
                  <p className="text-sm text-foreground group-hover:text-foreground flex-1">
                    {suggestion.message}
                  </p>
                  <Send className="w-4 h-4 text-foreground-subtle group-hover:text-primary transition-colors" />
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={generateSuggestions}
            className="w-full mt-3 py-2 flex items-center justify-center gap-2 text-xs text-foreground-subtle hover:text-foreground-muted transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh suggestions
          </button>
        </motion.div>
      )}

      {/* Expanded View - All Categories */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="glass-card p-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <h4 className="font-medium text-foreground">Conversation Starters</h4>
              </div>
              <button
                onClick={() => setIsExpanded(false)}
                className="text-xs text-foreground-muted hover:text-foreground"
              >
                Close
              </button>
            </div>

            {/* Category Filter */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-3 py-1.5 rounded-full text-xs transition-all ${
                  selectedCategory === null
                    ? "bg-primary text-foreground"
                    : "bg-background-tertiary text-foreground-muted hover:bg-background-tertiary"
                }`}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs transition-all ${
                    selectedCategory === cat
                      ? "bg-primary text-foreground"
                      : "bg-background-tertiary text-foreground-muted hover:bg-background-tertiary"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Suggestions Grid */}
            <div className="grid gap-2 max-h-[300px] overflow-y-auto">
              {getFilteredSuggestions().map((suggestion, idx) => (
                <button
                  key={`${suggestion.category}-${idx}`}
                  onClick={() => handleSelect(suggestion.message)}
                  className="p-3 rounded-xl bg-background-tertiary hover:bg-background-tertiary border border-card-border hover:border-card-border transition-all text-left group"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-lg">{suggestion.icon}</span>
                    <div className="flex-1">
                      <span className="text-[10px] text-primary uppercase tracking-wider">
                        {suggestion.category}
                      </span>
                      <p className="text-sm text-foreground group-hover:text-foreground">
                        {suggestion.message}
                      </p>
                    </div>
                    <Send className="w-4 h-4 text-foreground-subtle group-hover:text-primary transition-colors" />
                  </div>
                </button>
              ))}
            </div>

            {/* Custom Message Input */}
            <div className="mt-4 pt-4 border-t border-card-border">
              <p className="text-xs text-foreground-subtle mb-2">Or start with your own message</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={`Say hi to ${otherUserName}...`}
                  className="flex-1 px-4 py-2 rounded-xl bg-background-tertiary border border-card-border text-foreground text-sm placeholder:text-foreground-subtle focus:border-primary focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.currentTarget.value.trim()) {
                      handleSelect(e.currentTarget.value.trim());
                      e.currentTarget.value = "";
                    }
                  }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Empty State Icebreaker for new matches
export function EmptyStateIcebreaker({
  otherUserName,
  onSelect,
}: {
  otherUserName: string;
  onSelect: (message: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    const quickStarters = [
      "Hey! I noticed we matched. What caught your attention?",
      "Hi! I see we have a good compatibility score. Want to get to know each other?",
      "Hello! What's something you're passionate about?",
    ];
    setSuggestions(quickStarters);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center py-8"
    >
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
        <MessageCircle className="w-8 h-8 text-primary" />
      </div>
      <p className="text-foreground-muted mb-2">No messages yet</p>
      <p className="text-sm text-foreground-subtle mb-6">Start the conversation with {otherUserName}</p>

      <div className="space-y-2 max-w-sm mx-auto">
        {suggestions.map((msg, idx) => (
          <button
            key={idx}
            onClick={() => onSelect(msg)}
            className="w-full p-3 rounded-xl bg-background-tertiary hover:bg-background-tertiary border border-card-border text-left text-sm text-foreground-muted hover:text-foreground transition-all"
          >
            {msg}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
