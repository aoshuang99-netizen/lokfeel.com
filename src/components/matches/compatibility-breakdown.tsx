'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { 
  Heart, 
  MessageCircle, 
  Shield, 
  Sparkles, 
  MapPin, 
  Users,
  AlertTriangle,
  CheckCircle2,
  Info
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface CompatibilityBreakdownProps {
  scores: {
    overall: number
    breakdown: {
      attachment: number
      communication: number
      conflict: number
      values: number
      lifestyle: number
      relationshipType: number
      sexualOrientation: number
      powerBoard: number
    }
  }
  explanation: string
  warnings: string[]
  className?: string
}

interface ScoreBarProps {
  label: string
  score: number
  icon: React.ReactNode
  color: string
  description?: string
}

// ═══════════════════════════════════════════════════════════════
// SCORE BAR COMPONENT
// ═══════════════════════════════════════════════════════════════

const ScoreBar = ({ label, score, icon, color, description }: ScoreBarProps) => {
  const getScoreColor = (s: number) => {
    if (s >= 80) return 'text-green-400'
    if (s >= 60) return 'text-yellow-400'
    return 'text-red-400'
  }

  const getScoreBg = (s: number) => {
    if (s >= 80) return 'bg-green-400'
    if (s >= 60) return 'bg-yellow-400'
    return 'bg-red-400'
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn("p-1.5 rounded-lg", color)}>
            {icon}
          </div>
          <span className="text-sm font-medium text-white/80">{label}</span>
          {description && (
            <div className="group relative">
              <Info className="w-3.5 h-3.5 text-white/40 cursor-help" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-[#1a1a2e] border border-white/10 rounded-lg text-xs text-white/70 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                {description}
              </div>
            </div>
          )}
        </div>
        <span className={cn("text-sm font-bold", getScoreColor(score))}>
          {score}%
        </span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          className={cn("h-full rounded-full transition-all duration-500", getScoreBg(score))}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export function CompatibilityBreakdown({
  scores,
  explanation,
  warnings,
  className,
}: CompatibilityBreakdownProps) {
  const { overall, breakdown } = scores

  const getOverallColor = (s: number) => {
    if (s >= 85) return 'from-green-400 to-emerald-500'
    if (s >= 70) return 'from-blue-400 to-cyan-500'
    if (s >= 60) return 'from-yellow-400 to-orange-500'
    return 'from-red-400 to-pink-500'
  }

  const getOverallLabel = (s: number) => {
    if (s >= 85) return 'Exceptional Match'
    if (s >= 70) return 'Great Compatibility'
    if (s >= 60) return 'Good Potential'
    return 'Moderate Compatibility'
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Overall Score */}
      <div className="text-center space-y-3">
        <div className="relative inline-flex items-center justify-center">
          <svg className="w-32 h-32 transform -rotate-90">
            <circle
              cx="64"
              cy="64"
              r="56"
              fill="none"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="8"
            />
            <motion.circle
              cx="64"
              cy="64"
              r="56"
              fill="none"
              className={cn("stroke-url(#gradient)")}
              strokeWidth="8"
              strokeLinecap="round"
              initial={{ strokeDasharray: "0 351.86" }}
              animate={{ strokeDasharray: `${(overall / 100) * 351.86} 351.86` }}
              transition={{ duration: 1, ease: "easeOut" }}
            />
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" className={cn("text-green-400")} stopColor="currentColor" />
                <stop offset="100%" className={cn("text-emerald-500")} stopColor="currentColor" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("text-4xl font-bold bg-gradient-to-r bg-clip-text text-transparent", getOverallColor(overall))}>
              {overall}
            </span>
            <span className="text-xs text-white/50 mt-1">Match Score</span>
          </div>
        </div>
        <p className="text-lg font-medium text-white/90">{getOverallLabel(overall)}</p>
        <p className="text-sm text-white/60 max-w-md mx-auto">{explanation}</p>
      </div>

      {/* Detailed Breakdown */}
      <div className="space-y-4 p-4 rounded-xl bg-white/5 border border-white/10">
        <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">
          Compatibility Breakdown
        </h3>
        
        <div className="space-y-4">
          {/* Core Dimensions */}
          <ScoreBar
            label="Attachment Style"
            score={breakdown.attachment}
            icon={<Heart className="w-4 h-4 text-pink-400" />}
            color="bg-pink-400/20"
            description="How you form emotional bonds and handle intimacy"
          />
          <ScoreBar
            label="Communication"
            score={breakdown.communication}
            icon={<MessageCircle className="w-4 h-4 text-blue-400" />}
            color="bg-blue-400/20"
            description="How you express needs and listen to each other"
          />
          <ScoreBar
            label="Conflict Resolution"
            score={breakdown.conflict}
            icon={<Shield className="w-4 h-4 text-orange-400" />}
            color="bg-orange-400/20"
            description="How you handle disagreements and find solutions"
          />
          <ScoreBar
            label="Values & Priorities"
            score={breakdown.values}
            icon={<Sparkles className="w-4 h-4 text-yellow-400" />}
            color="bg-yellow-400/20"
            description="Shared life goals and what matters most to you"
          />
          <ScoreBar
            label="Lifestyle"
            score={breakdown.lifestyle}
            icon={<MapPin className="w-4 h-4 text-green-400" />}
            color="bg-green-400/20"
            description="Daily habits, location, and practical compatibility"
          />

          {/* New Dimensions */}
          <div className="pt-4 border-t border-white/10 space-y-4">
            <ScoreBar
              label="Relationship Type"
              score={breakdown.relationshipType}
              icon={<Users className="w-4 h-4 text-cyan-400" />}
              color="bg-cyan-400/20"
              description="Alignment in relationship structure preferences"
            />
            <ScoreBar
              label="Orientation Match"
              score={breakdown.sexualOrientation}
              icon={<Heart className="w-4 h-4 text-rose-400" />}
              color="bg-rose-400/20"
              description="Sexual and romantic orientation compatibility"
            />
            <ScoreBar
              label="Boundary Alignment"
              score={breakdown.powerBoard}
              icon={<Shield className="w-4 h-4 text-amber-400" />}
              color="bg-amber-400/20"
              description="Compatibility in communication boundaries and preferences"
            />
          </div>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            Things to Consider
          </h3>
          <div className="space-y-2">
            {warnings.map((warning, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex items-start gap-2 p-3 rounded-lg bg-yellow-400/10 border border-yellow-400/20"
              >
                <Info className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-white/70">{warning}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Positive Indicators */}
      {warnings.length === 0 && overall >= 70 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-2 p-4 rounded-xl bg-green-400/10 border border-green-400/20"
        >
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-sm font-medium text-green-400">Strong Compatibility</p>
            <p className="text-xs text-white/60">No significant concerns detected in your compatibility profile</p>
          </div>
        </motion.div>
      )}
    </div>
  )
}

export default CompatibilityBreakdown
