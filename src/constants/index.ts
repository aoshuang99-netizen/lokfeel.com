// ============================================================================
// App Configuration
// ============================================================================

export const APP_CONFIG = {
  name: 'LokFeel',
  company: 'LokFeel Inc.',
  tagline: 'Relationship Structure Matching',
  description: 'Find meaningful connections based on relationship compatibility',
  url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  supportEmail: 'support@lokfeel.com',
  contactEmail: 'hello@lokfeel.com',
  privacyEmail: 'privacy@lokfeel.com',
  legalEmail: 'legal@lokfeel.com',
  social: {
    twitter: '@lokfeel',
    instagram: '@lokfeel',
  },
  features: {
    enableRealTimeChat: true,
    enablePushNotifications: true,
    enableEmailNotifications: true,
    enableVerification: true,
    enableReporting: true,
  },
} as const

// ============================================================================
// Matching Configuration
// ============================================================================

export const MATCH_CONFIG = {
  // Weekly match limits by plan
  weeklyMatches: {
    FREE: 3,
    LADY_FREE: 5,
    PREMIUM_MONTHLY: 5,
    PREMIUM_YEARLY: 5,
  },
  // Match expiry in days
  matchExpiryDays: 7,
  // Minimum compatibility score to show a match (0-100)
  minCompatibilityScore: 60,
  // Maximum number of matches to generate per user per week
  maxWeeklyMatches: 5,
  // Cooldown between match generations (in hours)
  matchGenerationCooldown: 168, // 1 week
  // Maximum distance for matches (in miles)
  maxDistance: 100,
  // Age range for matching
  ageRange: {
    min: 18,
    max: 80,
  },
  // Scoring weights (must sum to 1)
  scoringWeights: {
    attachment: 0.25,
    communication: 0.20,
    conflict: 0.20,
    values: 0.20,
    lifestyle: 0.15,
  },
} as const

// ============================================================================
// Subscription Plans
// ============================================================================

export const SUBSCRIPTION_PLANS = {
  FREE: {
    id: 'FREE',
    name: 'Free',
    description: 'Get started with basic matching',
    price: {
      monthly: 0,
      yearly: 0,
    },
    features: {
      weeklyMatches: 3,
      messagesPerMatch: 2,
      canSeeWhoLikedMe: false,
      canRematch: false,
      advancedFilters: false,
      prioritySupport: false,
      incognitoMode: false,
      readReceipts: false,
      vaultControl: 'readonly',
      matchExplanation: 'basic',
      priorityMatching: false,
      travelMode: false,
      premiumBadge: false,
    },
  },
  LADY_FREE: {
    id: 'LADY_FREE',
    name: 'Lady Free',
    description: 'Because you deserve the best — always free for women',
    price: {
      monthly: 0,
      yearly: 0,
    },
    features: {
      weeklyMatches: 5,
      messagesPerMatch: -1, // unlimited
      canSeeWhoLikedMe: true,
      canRematch: false,
      advancedFilters: true,
      prioritySupport: false,
      incognitoMode: true,
      readReceipts: true,
      vaultControl: 'full',
      matchExplanation: 'full',
      priorityMatching: false,
      travelMode: false,
      premiumBadge: false,
    },
  },
  PREMIUM_MONTHLY: {
    id: 'PREMIUM_MONTHLY',
    name: 'Premium Monthly',
    description: 'Unlock full matching potential',
    price: {
      monthly: 19.99,
      yearly: 0,
    },
    features: {
      weeklyMatches: 5,
      messagesPerMatch: -1, // unlimited
      canSeeWhoLikedMe: true,
      canRematch: true,
      advancedFilters: true,
      prioritySupport: true,
      incognitoMode: true,
      readReceipts: true,
      vaultControl: 'readonly',
      matchExplanation: 'full',
      priorityMatching: true,
      travelMode: true,
      premiumBadge: true,
    },
  },
  PREMIUM_YEARLY: {
    id: 'PREMIUM_YEARLY',
    name: 'Premium Yearly',
    description: 'Best value for serious seekers',
    price: {
      monthly: 0,
      yearly: 149.99, // ~$12.50/month, 37% savings
    },
    features: {
      weeklyMatches: 5,
      messagesPerMatch: -1, // unlimited
      canSeeWhoLikedMe: true,
      canRematch: true,
      advancedFilters: true,
      prioritySupport: true,
      incognitoMode: true,
      readReceipts: true,
      vaultControl: 'readonly',
      matchExplanation: 'full',
      priorityMatching: true,
      travelMode: true,
      premiumBadge: true,
    },
  },
} as const

// ============================================================================
// Notification Types
// ============================================================================

export const NOTIFICATION_TYPES = {
  MATCH_CREATED: {
    id: 'MATCH_CREATED',
    title: 'New Match!',
    priority: 'high',
    push: true,
    email: true,
  },
  MATCH_EXPIRING: {
    id: 'MATCH_EXPIRING',
    title: 'Match Expiring Soon',
    priority: 'medium',
    push: true,
    email: true,
  },
  MESSAGE_RECEIVED: {
    id: 'MESSAGE_RECEIVED',
    title: 'New Message',
    priority: 'high',
    push: true,
    email: false,
  },
  PROFILE_VIEWED: {
    id: 'PROFILE_VIEWED',
    title: 'Someone viewed your profile',
    priority: 'low',
    push: false,
    email: false,
  },
  VERIFICATION_APPROVED: {
    id: 'VERIFICATION_APPROVED',
    title: 'Profile Verified',
    priority: 'medium',
    push: true,
    email: true,
  },
  VERIFICATION_REJECTED: {
    id: 'VERIFICATION_REJECTED',
    title: 'Verification Update',
    priority: 'medium',
    push: true,
    email: true,
  },
  SUBSCRIPTION_EXPIRING: {
    id: 'SUBSCRIPTION_EXPIRING',
    title: 'Subscription Expiring',
    priority: 'medium',
    push: true,
    email: true,
  },
  WEEKLY_DIGEST: {
    id: 'WEEKLY_DIGEST',
    title: 'Your Weekly Matches',
    priority: 'low',
    push: false,
    email: true,
  },
  SYSTEM: {
    id: 'SYSTEM',
    title: 'LokFeel Update',
    priority: 'low',
    push: false,
    email: false,
  },
} as const

// ============================================================================
// Onboarding Steps
// ============================================================================

export const ONBOARDING_STEPS = [
  {
    id: 'basics',
    title: 'Basic Info',
    description: 'Tell us a bit about yourself',
    fields: ['displayName', 'birthDate', 'gender', 'sexuality', 'location'],
    isRequired: true,
  },
  {
    id: 'photos',
    title: 'Photos',
    description: 'Add some photos to your profile',
    fields: ['photos'],
    isRequired: true,
  },
  {
    id: 'about',
    title: 'About You',
    description: 'Share your story',
    fields: ['bio', 'occupation', 'education', 'interests'],
    isRequired: false,
  },
  {
    id: 'relationship',
    title: 'Relationship Goals',
    description: 'What are you looking for?',
    fields: ['relationshipGoal'],
    isRequired: true,
  },
  {
    id: 'attachment',
    title: 'Attachment Style',
    description: 'Understanding your attachment patterns',
    fields: ['attachmentStyle'],
    isRequired: true,
  },
  {
    id: 'communication',
    title: 'Communication Style',
    description: 'How do you communicate?',
    fields: ['communicationStyle', 'conflictResolution'],
    isRequired: true,
  },
  {
    id: 'values',
    title: 'Values & Priorities',
    description: 'What matters most to you?',
    fields: ['priorities', 'dealbreakers'],
    isRequired: false,
  },
  {
    id: 'love',
    title: 'Love Languages',
    description: 'How do you give and receive love?',
    fields: ['loveLanguages'],
    isRequired: false,
  },
] as const

// ============================================================================
// Relationship Options
// ============================================================================

export const RELATIONSHIP_OPTIONS = [
  {
    value: 'MONOGAMY',
    label: 'Long-term relationship',
    description: 'Looking for a committed, lasting partnership',
    icon: 'Heart',
  },
  {
    value: 'CASUAL_DATING',
    label: 'Casual dating',
    description: 'Open to dating without immediate commitment',
    icon: 'Sparkles',
  },
  {
    value: 'ETHICAL_NON_MONOGAMY',
    label: 'Open relationship',
    description: 'Multiple connections with honest boundaries',
    icon: 'GitBranch',
  },
  {
    value: 'POLYAMORY',
    label: 'Polyamory',
    description: 'Multiple meaningful relationships',
    icon: 'Users',
  },
  {
    value: 'FRIENDSHIP_FIRST',
    label: 'Friends first',
    description: 'Building trust and friendship as foundation',
    icon: 'Coffee',
  },
  {
    value: 'KINK_BDSM',
    label: 'Alternative dynamics',
    description: 'Exploring relationship dynamics and desires',
    icon: 'HelpCircle',
  },
] as const

// ============================================================================
// Attachment Styles
// ============================================================================

export const ATTACHMENT_STYLES = [
  {
    value: 'secure',
    label: 'Secure',
    description: 'Comfortable with intimacy and independence',
    characteristics: [
      'Comfortable expressing needs',
      'Trusting in relationships',
      'Good at setting boundaries',
      'Handles conflict constructively',
    ],
    compatibleWith: ['secure', 'anxious', 'avoidant'],
    challengingWith: ['disorganized'],
  },
  {
    value: 'anxious',
    label: 'Anxious',
    description: 'Seeks closeness, worries about relationships',
    characteristics: [
      'Deeply caring and attentive',
      'Values emotional connection',
      'Sensitive to partner\'s needs',
      'Seeks reassurance',
    ],
    compatibleWith: ['secure', 'anxious'],
    challengingWith: ['avoidant', 'disorganized'],
  },
  {
    value: 'avoidant',
    label: 'Avoidant',
    description: 'Values independence, finds intimacy challenging',
    characteristics: [
      'Self-reliant and independent',
      'Respects personal space',
      'Low drama',
      'Values autonomy',
    ],
    compatibleWith: ['secure', 'avoidant'],
    challengingWith: ['anxious', 'disorganized'],
  },
  {
    value: 'disorganized',
    label: 'Disorganized/Fearful-Avoidant',
    description: 'Desires closeness but fears it',
    characteristics: [
      'Deep capacity for connection',
      'Self-aware about patterns',
      'Values authenticity',
      'Working on growth',
    ],
    compatibleWith: ['secure'],
    challengingWith: ['anxious', 'avoidant', 'disorganized'],
  },
] as const

// ============================================================================
// Communication Styles
// ============================================================================

export const COMMUNICATION_STYLES = [
  {
    value: 'direct',
    label: 'Direct',
    description: 'Say what you mean, mean what you say',
    characteristics: [
      'Clear and straightforward',
      'Values honesty above all',
      'Gets to the point quickly',
      'Appreciates frankness',
    ],
  },
  {
    value: 'indirect',
    label: 'Indirect/Considerate',
    description: 'Read between the lines, preserve harmony',
    characteristics: [
      'Thoughtful with words',
      'Considers others\'s feelings',
      'Uses subtle cues',
      'Values harmony',
    ],
  },
  {
    value: 'analytical',
    label: 'Analytical',
    description: 'Think first, discuss logically',
    characteristics: [
      'Logical and systematic',
      'Needs time to process',
      'Focuses on facts',
      'Problem-solving oriented',
    ],
  },
  {
    value: 'emotional',
    label: 'Emotional/Expressive',
    description: 'Share feelings openly and passionately',
    characteristics: [
      'Openly expressive',
      'Wears heart on sleeve',
      'Values emotional connection',
      'Passionate communicator',
    ],
  },
] as const

// ============================================================================
// Conflict Resolution Styles
// ============================================================================

export const CONFLICT_RESOLUTION_STYLES = [
  {
    value: 'collaborative',
    label: 'Collaborative',
    description: 'Let\'s find a solution that works for both of us',
    approach: 'Works together to find win-win solutions',
  },
  {
    value: 'compromising',
    label: 'Compromising',
    description: 'We both give a little to meet in the middle',
    approach: 'Willing to give and take for mutual satisfaction',
  },
  {
    value: 'accommodating',
    label: 'Accommodating',
    description: 'Your happiness matters more than being right',
    approach: 'Prioritizes relationship harmony over winning',
  },
  {
    value: 'competing',
    label: 'Competing',
    description: 'I stand firm on what I believe is right',
    approach: 'Assertive about needs, may push for own solution',
  },
] as const

// ============================================================================
// Love Languages
// ============================================================================

export const LOVE_LANGUAGES = [
  {
    value: 'words_of_affirmation',
    label: 'Words of Affirmation',
    description: 'Verbal expressions of love and appreciation',
    examples: [
      'Compliments and praise',
      'Saying "I love you"',
      'Encouraging words',
      'Written notes or messages',
    ],
  },
  {
    value: 'acts_of_service',
    label: 'Acts of Service',
    description: 'Actions that show you care',
    examples: [
      'Helping with tasks',
      'Making their life easier',
      'Thoughtful gestures',
      'Taking care of things',
    ],
  },
  {
    value: 'receiving_gifts',
    label: 'Receiving Gifts',
    description: 'Thoughtful tokens of affection',
    examples: [
      'Surprise presents',
      'Remembering special items',
      'Handmade gifts',
      'Small meaningful tokens',
    ],
  },
  {
    value: 'quality_time',
    label: 'Quality Time',
    description: 'Undivided attention and shared experiences',
    examples: [
      'One-on-one conversations',
      'Shared activities',
      'Being fully present',
      'Creating memories together',
    ],
  },
  {
    value: 'physical_touch',
    label: 'Physical Touch',
    description: 'Physical expressions of love and connection',
    examples: [
      'Holding hands',
      'Hugs and cuddles',
      'Affectionate touches',
      'Physical closeness',
    ],
  },
] as const

// ============================================================================
// Gender Options
// ============================================================================

export const GENDER_OPTIONS = [
  { value: 'WOMAN', label: 'Woman', emoji: '👩', group: 'Core' },
  { value: 'MAN', label: 'Man', emoji: '👨', group: 'Core' },
  { value: 'NON_BINARY', label: 'Non-binary', emoji: '🏳️‍🌈', group: 'Core' },
  { value: 'TRANSGENDER_MAN', label: 'Trans Man', emoji: '🧑', group: 'Trans' },
  { value: 'TRANSGENDER_WOMAN', label: 'Trans Woman', emoji: '👩', group: 'Trans' },
  { value: 'GENDERQUEER', label: 'Genderqueer', emoji: '🌈', group: 'Non-binary Spectrum' },
  { value: 'GENDERFLUID', label: 'Genderfluid', emoji: '🌊', group: 'Non-binary Spectrum' },
  { value: 'AGENDER', label: 'Agender', emoji: '⚪', group: 'Non-binary Spectrum' },
  { value: 'BIGENDER', label: 'Bigender', emoji: '✨', group: 'Non-binary Spectrum' },
  { value: 'PANGENDER', label: 'Pangender', emoji: '🌟', group: 'Non-binary Spectrum' },
  { value: 'ANDROGYNE', label: 'Androgyne', emoji: '💫', group: 'Non-binary Spectrum' },
  { value: 'DEMIGENDER', label: 'Demigender', emoji: '⚫', group: 'Non-binary Spectrum' },
  { value: 'NEUTROIS', label: 'Neutrois', emoji: '⚪', group: 'Non-binary Spectrum' },
  { value: 'TWO_SPIRIT', label: 'Two-Spirit', emoji: '🪶', group: 'Cultural' },
  { value: 'GENDER_NONCONFORMING', label: 'Gender Nonconforming', emoji: '🦋', group: 'Self-discovery' },
  { value: 'QUESTIONING', label: 'Questioning', emoji: '❓', group: 'Self-discovery' },
  { value: 'OTHER', label: 'Other', emoji: '➕', group: 'Other' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say', emoji: '🤐', group: 'Other' },
] as const

// ============================================================================
// Sexuality Options
// ============================================================================

export const SEXUALITY_OPTIONS = [
  // Monosexual
  { value: 'STRAIGHT', label: 'Straight', emoji: '👫', group: 'Monosexual' },
  { value: 'GAY', label: 'Gay', emoji: '👬', group: 'Monosexual' },
  { value: 'LESBIAN', label: 'Lesbian', emoji: '👭', group: 'Monosexual' },
  // Multi-gender attracted
  { value: 'BISEXUAL', label: 'Bisexual', emoji: '💜', group: 'Multi-gender' },
  { value: 'PANSEXUAL', label: 'Pansexual', emoji: '💛', group: 'Multi-gender' },
  { value: 'POLYSEXUAL', label: 'Polysexual', emoji: '💚', group: 'Multi-gender' },
  { value: 'OMNISEXUAL', label: 'Omnisexual', emoji: '🧡', group: 'Multi-gender' },
  { value: 'HETEROFLEXIBLE', label: 'Heteroflexible', emoji: '🌈', group: 'Multi-gender' },
  { value: 'HOMOFLEXIBLE', label: 'Homoflexible', emoji: '🌈', group: 'Multi-gender' },
  // Asexual spectrum
  { value: 'ASEXUAL', label: 'Asexual', emoji: '🖤', group: 'Ace Spectrum' },
  { value: 'DEMISEXUAL', label: 'Demisexual', emoji: '🖤', group: 'Ace Spectrum' },
  { value: 'GRAYSEXUAL', label: 'Graysexual', emoji: '🖤', group: 'Ace Spectrum' },
  { value: 'RECIPROSEXUAL', label: 'Reciprosexual', emoji: '🖤', group: 'Ace Spectrum' },
  // Identity-based
  { value: 'QUEER', label: 'Queer', emoji: '🏳️‍🌈', group: 'Identity' },
  { value: 'QUESTIONING', label: 'Questioning', emoji: '❓', group: 'Identity' },
  // Attraction-specific
  { value: 'SAPPIOSEXUAL', label: 'Sapiosexual', emoji: '🧠', group: 'Attraction' },
  { value: 'ANDROSEXUAL', label: 'Androsexual', emoji: '💙', group: 'Attraction' },
  { value: 'GYNESEXUAL', label: 'Gynesexual', emoji: '💖', group: 'Attraction' },
  { value: 'SKOLIOSEXUAL', label: 'Skoliosexual', emoji: '💚', group: 'Attraction' },
  // Romantic orientation
  { value: 'BIROMANTIC', label: 'Biromantic', emoji: '💕', group: 'Romantic' },
  { value: 'AROMANTIC', label: 'Aromantic', emoji: '🖤', group: 'Romantic' },
  // Fallbacks
  { value: 'OTHER', label: 'Other', emoji: '➕', group: 'Other' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say', emoji: '🤐', group: 'Other' },
] as const

// ============================================================================
// ============================================================================
// Phase B: Dom/Sub Role Options
// ============================================================================

export const DOM_SUB_ROLE_OPTIONS = [
  // Core dynamics
  { value: 'DOMINANT', label: 'Dominant', emoji: '👑', group: 'Core', description: 'Takes the lead, provides structure' },
  { value: 'SUBMISSIVE', label: 'Submissive', emoji: '🦋', group: 'Core', description: 'Yields control, follows guidance' },
  { value: 'SWITCH', label: 'Switch', emoji: '🔄', group: 'Core', description: 'Flows between both roles' },
  { value: 'VANILLA', label: 'Vanilla', emoji: ' vanilla', group: 'Core', description: 'Traditional dynamics' },
  { value: 'EXPLORING', label: 'Exploring', emoji: '🔍', group: 'Core', description: 'Curious, open to discover' },
  // Positional
  { value: 'TOP', label: 'Top', emoji: '⬆️', group: 'Positional', description: 'Prefers giving/active role' },
  { value: 'BOTTOM', label: 'Bottom', emoji: '⬇️', group: 'Positional', description: 'Prefers receiving/passive role' },
  // Specialized
  { value: 'BRAT', label: 'Brat', emoji: '😈', group: 'Specialized', description: 'Playfully challenges authority' },
  { value: 'BRAT_TAMER', label: 'Brat Tamer', emoji: '😤', group: 'Specialized', description: 'Handles bratty energy with care' },
  { value: 'PRIMAL', label: 'Primal', emoji: '🐺', group: 'Specialized', description: 'Instinct-driven, raw connection' },
  { value: 'RIGGER', label: 'Rigger', emoji: '🪢', group: 'Specialized', description: 'Creates rope/bondage art' },
  { value: 'ROPE_BUNNY', label: 'Rope Bunny', emoji: '🐰', group: 'Specialized', description: 'Enjoys being tied' },
  { value: 'OWNER', label: 'Owner', emoji: '🔑', group: 'Specialized', description: 'Claims ownership dynamic' },
  { value: 'PET', label: 'Pet', emoji: '🐱', group: 'Specialized', description: 'Pet/play dynamic' },
  { value: 'SADIST', label: 'Sadist', emoji: '⚔️', group: 'Specialized', description: 'Inflicts consensual sensation' },
  { value: 'MASOCHIST', label: 'Masochist', emoji: '🔥', group: 'Specialized', description: 'Receives consensual sensation' },
  { value: 'DADDY_MOMMY', label: 'Daddy/Mommy', emoji: '🧸', group: 'Specialized', description: 'Caregiver dynamic' },
  { value: 'LITTLE', label: 'Little', emoji: '🧒', group: 'Specialized', description: 'Age regression dynamic' },
  { value: 'MASTEX', label: 'Master/Mistress', emoji: '⛓️', group: 'Specialized', description: 'Total power exchange' },
  // Fallback
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say', emoji: '🤐', group: 'Other' },
] as const

// ============================================================================
// Phase B: Kink Interest Categories
// ============================================================================

export const KINK_CATEGORIES = [
  // Bondage & Restraint
  { value: 'BONDAGE', label: 'Bondage & Restraint', emoji: '🪢', group: 'Bondage' },
  { value: 'ROPE_PLAY', label: 'Rope Play (Shibari)', emoji: '🧵', group: 'Bondage' },
  { value: 'SENSORY_RESTRAINT', label: 'Sensory Restraint', emoji: '🔒', group: 'Bondage' },
  // Impact & Sensation
  { value: 'IMPACT_PLAY', label: 'Impact Play', emoji: '👏', group: 'Sensation' },
  { value: 'WAX_PLAY', label: 'Wax Play', emoji: '🕯️', group: 'Sensation' },
  { value: 'TEMPERATURE_PLAY', label: 'Temperature Play', emoji: '🧊', group: 'Sensation' },
  { value: 'ELECTRO_STIM', label: 'Electrostimulation', emoji: '⚡', group: 'Sensation' },
  { value: 'SENSORY_DEPRIVATION', label: 'Sensory Deprivation', emoji: '🎭', group: 'Sensation' },
  // Power Exchange
  { value: 'TOTAL_POWER_EXCHANGE', label: 'Total Power Exchange (TPE)', emoji: '⛓️', group: 'Power Exchange' },
  { value: 'CONSENSUAL_NON_CONSENT', label: 'Consensual Non-Consent', emoji: '🤫', group: 'Power Exchange' },
  { value: 'PRAISE_KINK', label: 'Praise Kink', emoji: '✨', group: 'Power Exchange' },
  { value: 'DEGRADATION', label: 'Degradation (Consensual)', emoji: '🖤', group: 'Power Exchange' },
  { value: 'FINANCIAL_DOMINATION', label: 'Financial Domination', emoji: '💳', group: 'Power Exchange' },
  // Roleplay
  { value: 'PET_PLAY', label: 'Pet Play', emoji: '🐾', group: 'Roleplay' },
  { value: 'AGE_PLAY', label: 'Age Play', emoji: '🧸', group: 'Roleplay' },
  { value: 'MEDICAL_PLAY', label: 'Medical Play', emoji: '🩺', group: 'Roleplay' },
  { value: 'TEACHER_STUDENT', label: 'Teacher/Student', emoji: '📚', group: 'Roleplay' },
  { value: 'BOSS_EMPLOYEE', label: 'Boss/Employee', emoji: '💼', group: 'Roleplay' },
  // Exhibitionism & Voyeurism
  { value: 'EXHIBITIONISM', label: 'Exhibitionism', emoji: '👁️', group: 'Public' },
  { value: 'VOYEURISM', label: 'Voyeurism', emoji: '🫣', group: 'Public' },
  { value: 'PUBLIC_PLAY', label: 'Public Play', emoji: '🌆', group: 'Public' },
  // Psychological
  { value: 'MIND_CONTROL', label: 'Mind Control/Hypnosis', emoji: '🧠', group: 'Psychological' },
  { value: 'BIMBIFICATION', label: 'Bimbofication', emoji: '💄', group: 'Psychological' },
  { value: 'BRAINWASHING', label: 'Brainwashing Roleplay', emoji: '🌀', group: 'Psychological' },
  // Fetish
  { value: 'FOOT_FETISH', label: 'Foot Fetish', emoji: '🦶', group: 'Fetish' },
  { value: 'LATEX_RUBBER', label: 'Latex & Rubber', emoji: '🤖', group: 'Fetish' },
  { value: 'LEATHER', label: 'Leather', emoji: '🧥', group: 'Fetish' },
  { value: 'HIGH_HEELS', label: 'High Heels', emoji: '👠', group: 'Fetish' },
  { value: 'UNIFORMS', label: 'Uniforms', emoji: '👮', group: 'Fetish' },
  { value: 'BODY_MODIFICATION', label: 'Body Modification', emoji: '💎', group: 'Fetish' },
] as const

export const KINK_EXPERIENCE_OPTIONS = [
  { value: 'BEGINNER', label: 'Beginner', emoji: '🌱', description: 'New to kink, exploring basics' },
  { value: 'INTERMEDIATE', label: 'Intermediate', emoji: '🌿', description: 'Some experience, expanding skills' },
  { value: 'EXPERIENCED', label: 'Experienced', emoji: '🌳', description: 'Well-versed in dynamics' },
  { value: 'EXPERT', label: 'Expert', emoji: '🏆', description: 'Deep knowledge & mastery' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say', emoji: '🤐' },
] as const

// Priority Options
// ============================================================================

export const PRIORITY_OPTIONS = [
  { value: 'family', label: 'Family' },
  { value: 'career', label: 'Career' },
  { value: 'health', label: 'Health & Wellness' },
  { value: 'personal_growth', label: 'Personal Growth' },
  { value: 'adventure', label: 'Adventure & Travel' },
  { value: 'creativity', label: 'Creativity' },
  { value: 'community', label: 'Community' },
  { value: 'financial_security', label: 'Financial Security' },
  { value: 'spirituality', label: 'Spirituality' },
  { value: 'fun', label: 'Fun & Enjoyment' },
] as const

// ============================================================================
// Dealbreaker Options
// ============================================================================

export const DEALBREAKER_OPTIONS = [
  { value: 'wants_kids', label: 'Wants children' },
  { value: 'no_kids', label: 'Doesn\'t want children' },
  { value: 'smoking', label: 'Smokes' },
  { value: 'drinking', label: 'Drinks alcohol' },
  { value: 'drugs', label: 'Uses recreational drugs' },
  { value: 'religious', label: 'Religious' },
  { value: 'non_religious', label: 'Not religious' },
  { value: 'political_conservative', label: 'Politically conservative' },
  { value: 'political_liberal', label: 'Politically liberal' },
  { value: 'long_distance', label: 'Long distance' },
  { value: 'different_life_goals', label: 'Different life goals' },
] as const

// ============================================================================
// Interest Options
// ============================================================================

export const INTEREST_OPTIONS = [
  { value: 'reading', label: 'Reading', category: 'Indoor' },
  { value: 'cooking', label: 'Cooking', category: 'Indoor' },
  { value: 'gaming', label: 'Gaming', category: 'Indoor' },
  { value: 'movies', label: 'Movies & TV', category: 'Indoor' },
  { value: 'music', label: 'Music', category: 'Indoor' },
  { value: 'art', label: 'Art & Design', category: 'Creative' },
  { value: 'writing', label: 'Writing', category: 'Creative' },
  { value: 'photography', label: 'Photography', category: 'Creative' },
  { value: 'hiking', label: 'Hiking', category: 'Outdoor' },
  { value: 'running', label: 'Running', category: 'Outdoor' },
  { value: 'cycling', label: 'Cycling', category: 'Outdoor' },
  { value: 'yoga', label: 'Yoga', category: 'Fitness' },
  { value: 'gym', label: 'Gym', category: 'Fitness' },
  { value: 'sports', label: 'Sports', category: 'Fitness' },
  { value: 'travel', label: 'Travel', category: 'Lifestyle' },
  { value: 'foodie', label: 'Food & Dining', category: 'Lifestyle' },
  { value: 'dancing', label: 'Dancing', category: 'Social' },
  { value: 'volunteering', label: 'Volunteering', category: 'Social' },
  { value: 'technology', label: 'Technology', category: 'Intellectual' },
  { value: 'science', label: 'Science', category: 'Intellectual' },
] as const

// ============================================================================
// Common Values
// ============================================================================

export const EDUCATION_OPTIONS = [
  { value: 'high_school', label: 'High School' },
  { value: 'some_college', label: 'Some College' },
  { value: 'associates', label: 'Associate\'s Degree' },
  { value: 'bachelors', label: 'Bachelor\'s Degree' },
  { value: 'masters', label: 'Master\'s Degree' },
  { value: 'doctorate', label: 'Doctorate' },
  { value: 'professional', label: 'Professional Degree' },
  { value: 'trade', label: 'Trade School' },
  { value: 'other', label: 'Other' },
] as const
