'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Sparkles,
  Send,
  Save,
  Gift,
  Wand2,
  RefreshCw,
  Check,
  AlertCircle,
  Smile,
  Heart,
  Zap,
  MessageCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// ============================================================================
// TYPES
// ============================================================================

type ToneOption = 'casual' | 'sincere' | 'playful' | 'direct'

interface TargetUser {
  name: string
  age: number
  bio?: string
  interests?: string[]
}

interface PitchEditorProps {
  matchId: string
  targetUser: TargetUser
  onSuccess?: () => void
  onCancel?: () => void
}

interface AISuggestion {
  id: string
  text: string
  tone: ToneOption
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_CHARS = 20
const MAX_CHARS = 500

const TONE_OPTIONS: { value: ToneOption; label: string; icon: React.ElementType }[] = [
  { value: 'casual', label: 'Casual', icon: Smile },
  { value: 'sincere', label: 'Sincere', icon: Heart },
  { value: 'playful', label: 'Playful', icon: Zap },
  { value: 'direct', label: 'Direct', icon: MessageCircle },
]

const PLACEHOLDER_SUGGESTIONS = [
  "I noticed we both love hiking and photography...",
  "Your profile caught my attention because...",
  "We seem to share a passion for...",
  "I was drawn to your interest in...",
]

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

const CharacterCounter = ({ current, min, max }: { current: number; min: number; max: number }) => {
  const percentage = Math.min((current / max) * 100, 100)
  const isValid = current >= min && current <= max
  const isNearLimit = current > max * 0.9

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 bg-background-tertiary rounded-full overflow-hidden">
        <motion.div
          className={cn(
            "h-full rounded-full transition-colors",
            isValid 
              ? isNearLimit 
                ? "bg-gradient-to-r from-[#4c1d95] to-[#8b5cf6]"
                : "bg-gradient-to-r from-amber-600 to-rose-500"
              : "bg-white/30"
          )}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      </div>
      <span
        className={cn(
          "text-xs font-medium tabular-nums transition-colors",
          isValid 
            ? isNearLimit 
              ? "text-[#8b5cf6]"
              : "text-foreground-muted"
            : current < min 
              ? "text-foreground-subtle" 
              : "text-[#ef4444]"
        )}
      >
        {current}/{max}
      </span>
    </div>
  )
}

const ToneButton = ({
  tone,
  selected,
  onClick,
}: {
  tone: { value: ToneOption; label: string; icon: React.ElementType }
  selected: boolean
  onClick: () => void
}) => {
  const Icon = tone.icon
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200",
        selected
          ? "bg-gradient-to-r from-amber-600 to-rose-500 text-foreground shadow-lg shadow-amber-600/25"
          : "bg-background-tertiary text-foreground-muted hover:bg-background-tertiary hover:text-foreground border border-card-border"
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {tone.label}
    </button>
  )
}

const AISuggestionCard = ({
  suggestion,
  onUse,
  index,
}: {
  suggestion: AISuggestion
  onUse: (text: string) => void
  index: number
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.3 }}
      className={cn(
        "group relative p-4 rounded-xl border transition-all duration-200 cursor-pointer",
        "bg-background-tertiary border-card-border hover:bg-background-tertiary hover:border-amber-500/30"
      )}
      onClick={() => onUse(suggestion.text)}
    >
      <p className="text-sm text-foreground leading-relaxed mb-3 line-clamp-3">
        {suggestion.text}
      </p>
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground-subtle capitalize">{suggestion.tone} tone</span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onUse(suggestion.text)
          }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
        >
          <Check className="w-3 h-3" />
          Use This
        </button>
      </div>
    </motion.div>
  )
}

const ShimmerLoader = () => (
  <div className="space-y-3">
    {[1, 2, 3].map((i) => (
      <div key={i} className="p-4 rounded-xl bg-background-tertiary border border-card-border">
        <div className="space-y-2">
          <div className="h-3 bg-background-tertiary rounded animate-shimmer w-full" />
          <div className="h-3 bg-background-tertiary rounded animate-shimmer w-4/5" />
          <div className="h-3 bg-background-tertiary rounded animate-shimmer w-2/3" />
        </div>
        <div className="mt-3 flex justify-between items-center">
          <div className="h-3 bg-background-tertiary rounded animate-shimmer w-16" />
          <div className="h-6 bg-background-tertiary rounded animate-shimmer w-20" />
        </div>
      </div>
    ))}
  </div>
)

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PitchEditor({ matchId, targetUser, onSuccess, onCancel }: PitchEditorProps) {
  // State
  const [message, setMessage] = useState('')
  const [selectedTone, setSelectedTone] = useState<ToneOption>('casual')
  const [showAISuggestions, setShowAISuggestions] = useState(false)
  const [isGeneratingAI, setIsGeneratingAI] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([])
  const [addGift, setAddGift] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [placeholder, setPlaceholder] = useState(PLACEHOLDER_SUGGESTIONS[0])

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [message])

  // Rotate placeholder
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholder((prev) => {
        const currentIndex = PLACEHOLDER_SUGGESTIONS.indexOf(prev)
        const nextIndex = (currentIndex + 1) % PLACEHOLDER_SUGGESTIONS.length
        return PLACEHOLDER_SUGGESTIONS[nextIndex]
      })
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Generate AI suggestions
  const generateSuggestions = useCallback(async () => {
    setIsGeneratingAI(true)
    setError(null)

    try {
      const response = await fetch(`/api/matches/${matchId}/pitch/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tone: selectedTone,
          targetUser: {
            name: targetUser.name,
            bio: targetUser.bio,
            interests: targetUser.interests,
          },
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to generate suggestions')
      }

      const data = await response.json()
      
      // Handle API response format - options array from generate endpoint
      if (data.options && data.options.length > 0) {
        setAiSuggestions(data.options.map((opt: { text: string; style?: string }, index: number) => ({
          id: String(index + 1),
          text: opt.text,
          tone: selectedTone,
        })))
      } else if (data.suggestions && data.suggestions.length > 0) {
        setAiSuggestions(data.suggestions)
      } else {
        // Mock suggestions for demo
        setAiSuggestions([
          {
            id: '1',
            text: `Hi ${targetUser.name}! I came across your profile and was really drawn to your passion for ${targetUser.interests?.[0] || 'adventure'}. I'd love to hear more about what excites you most about it!`,
            tone: selectedTone,
          },
          {
            id: '2',
            text: `Hey ${targetUser.name}! Your profile stood out to me—especially ${targetUser.bio ? `when you mentioned "${targetUser.bio.slice(0, 50)}..."` : 'your approach to life'}. Would love to connect and learn more about your perspective.`,
            tone: selectedTone,
          },
          {
            id: '3',
            text: `Hello ${targetUser.name}! I noticed we share some similar interests. I'm curious—what's something you're really passionate about right now that you'd love to share with someone new?`,
            tone: selectedTone,
          },
        ])
      }
    } catch (err) {
      setError('Failed to generate AI suggestions. Please try again.')
      // Fallback mock data
      setAiSuggestions([
        {
          id: '1',
          text: `Hi ${targetUser.name}! I came across your profile and was really drawn to your energy. I'd love to connect and learn more about what makes you tick.`,
          tone: selectedTone,
        },
        {
          id: '2',
          text: `Hey ${targetUser.name}! Your profile caught my eye. I think we might have some interesting conversations ahead. Want to find out?`,
          tone: selectedTone,
        },
        {
          id: '3',
          text: `Hello ${targetUser.name}! I'm intrigued by your profile and would love to hear your story. What's one thing you're excited about these days?`,
          tone: selectedTone,
        },
      ])
    } finally {
      setIsGeneratingAI(false)
    }
  }, [matchId, selectedTone, targetUser])

  // Toggle AI suggestions panel
  const toggleAISuggestions = useCallback(() => {
    if (!showAISuggestions) {
      setShowAISuggestions(true)
      if (aiSuggestions.length === 0) {
        generateSuggestions()
      }
    } else {
      setShowAISuggestions(false)
    }
  }, [showAISuggestions, aiSuggestions.length, generateSuggestions])

  // Use AI suggestion
  const useSuggestion = useCallback((text: string) => {
    setMessage(text)
    setShowAISuggestions(false)
    textareaRef.current?.focus()
  }, [])

  // Send pitch
  const handleSend = useCallback(async () => {
    if (message.length < MIN_CHARS || message.length > MAX_CHARS) {
      setError(`Message must be between ${MIN_CHARS} and ${MAX_CHARS} characters`)
      return
    }

    setIsSending(true)
    setError(null)

    try {
      const response = await fetch(`/api/matches/${matchId}/pitch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          tone: selectedTone,
          addGift,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to send pitch')
      }

      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send pitch')
    } finally {
      setIsSending(false)
    }
  }, [message, matchId, selectedTone, addGift, onSuccess])

  // Save draft
  const handleSaveDraft = useCallback(async () => {
    setIsSaving(true)
    setError(null)

    try {
      // Store draft in localStorage for now
      const draftKey = `pitch-draft-${matchId}`
      localStorage.setItem(draftKey, JSON.stringify({
        message,
        tone: selectedTone,
        addGift,
        savedAt: new Date().toISOString(),
      }))

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500))
      
      // Show success feedback
      setIsSaving(false)
    } catch (err) {
      setError('Failed to save draft')
      setIsSaving(false)
    }
  }, [matchId, message, selectedTone, addGift])

  // Load draft on mount
  useEffect(() => {
    const draftKey = `pitch-draft-${matchId}`
    const saved = localStorage.getItem(draftKey)
    if (saved) {
      try {
        const draft = JSON.parse(saved)
        setMessage(draft.message || '')
        setSelectedTone(draft.tone || 'casual')
        setAddGift(draft.addGift || false)
      } catch {
        // Ignore parse errors
      }
    }
  }, [matchId])

  const isValidLength = message.length >= MIN_CHARS && message.length <= MAX_CHARS
  const canSend = isValidLength && !isSending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={cn(
          "relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl",
          "bg-background-secondary/95 backdrop-blur-xl border border-card-border shadow-2xl"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-card-border">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Write to <span className="text-gradient">{targetUser.name}</span>
            </h2>
            <p className="text-sm text-foreground-muted">
              {targetUser.age} years old
              {targetUser.interests && targetUser.interests.length > 0 && (
                <span className="ml-2">• {targetUser.interests.slice(0, 3).join(', ')}</span>
              )}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-180px)]">
          {/* Error Message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tone Selector */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground-muted">Choose your tone</label>
            <div className="flex flex-wrap gap-2">
              {TONE_OPTIONS.map((tone) => (
                <ToneButton
                  key={tone.value}
                  tone={tone}
                  selected={selectedTone === tone.value}
                  onClick={() => setSelectedTone(tone.value)}
                />
              ))}
            </div>
          </div>

          {/* AI Assist Button */}
          <div className="flex items-center justify-between">
            <button
              onClick={toggleAISuggestions}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300",
                showAISuggestions
                  ? "bg-gradient-to-r from-amber-600 to-rose-500 text-foreground shadow-lg shadow-amber-600/25"
                  : "bg-gradient-to-r from-amber-600/20 to-rose-500/20 text-foreground hover:from-amber-600/30 hover:to-rose-500/30 border border-amber-500/30"
              )}
            >
              <Sparkles className={cn("w-4 h-4", showAISuggestions && "animate-pulse")} />
              {showAISuggestions ? 'Hide AI Suggestions' : 'Get AI Suggestions'}
            </button>

            {showAISuggestions && (
              <button
                onClick={generateSuggestions}
                disabled={isGeneratingAI}
                className="flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground-muted transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isGeneratingAI && "animate-spin")} />
                Regenerate
              </button>
            )}
          </div>

          {/* AI Suggestions Panel */}
          <AnimatePresence>
            {showAISuggestions && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="p-4 rounded-xl bg-gradient-to-br from-amber-600/5 to-rose-500/5 border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-4">
                    <Wand2 className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-medium text-foreground">AI-Generated Suggestions</span>
                  </div>

                  {isGeneratingAI ? (
                    <ShimmerLoader />
                  ) : (
                    <div className="space-y-3">
                      {aiSuggestions.map((suggestion, index) => (
                        <AISuggestionCard
                          key={suggestion.id}
                          suggestion={suggestion}
                          onUse={useSuggestion}
                          index={index}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Text Area */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground-muted">Your message</label>
              <span className="text-xs text-foreground-subtle">
                Min {MIN_CHARS} characters
              </span>
            </div>
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={placeholder}
                className={cn(
                  "w-full min-h-[120px] max-h-[200px] p-4 rounded-xl resize-none",
                  "bg-background-tertiary border border-card-border text-foreground placeholder:text-foreground-subtle",
                  "focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/25",
                  "transition-all duration-200"
                )}
              />
              <div className="absolute bottom-3 left-4 right-4">
                <CharacterCounter
                  current={message.length}
                  min={MIN_CHARS}
                  max={MAX_CHARS}
                />
              </div>
            </div>
          </div>

          {/* Gift Toggle */}
          <div
            onClick={() => setAddGift(!addGift)}
            className={cn(
              "flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200",
              addGift
                ? "bg-gradient-to-r from-amber-600/10 to-rose-500/10 border-amber-500/30"
                : "bg-background-tertiary border-card-border hover:bg-white/8"
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center w-10 h-10 rounded-lg transition-colors",
                addGift ? "bg-amber-500/20" : "bg-background-tertiary"
              )}
            >
              <Gift className={cn("w-5 h-5", addGift ? "text-amber-400" : "text-foreground-muted")} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">Add Sincerity Gift</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400">
                  +25 points
                </span>
              </div>
              <p className="text-sm text-foreground-muted">
                Show extra sincerity with a gift to stand out from other matches
              </p>
            </div>
            <div
              className={cn(
                "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                addGift
                  ? "bg-amber-600 border-amber-600"
                  : "border-card-border"
              )}
            >
              {addGift && <Check className="w-3.5 h-3.5 text-foreground" />}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-card-border bg-background-tertiary">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSaveDraft}
              disabled={isSaving || !message}
              className="gap-1.5"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save Draft'}
            </Button>

            <Button
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                "gap-1.5 px-6",
                !canSend && "opacity-50 cursor-not-allowed"
              )}
            >
              <Send className="w-4 h-4" />
              {isSending ? 'Sending...' : 'Send Pitch'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

export default PitchEditor
