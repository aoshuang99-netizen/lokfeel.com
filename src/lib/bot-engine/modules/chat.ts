/**
 * LokFeel Bot Behavior Engine — Chat Behavior Module
 *
 * Simulates natural chat behavior for bot users:
 * - Conversation initiation based on personality and match quality
 * - Response generation using template selection + context awareness
 * - Follow-up logic with patience limits
 * - Conversation lifecycle management (start → engage → taper → end)
 * - Response timing that mimics human patterns
 */

import type {
  BotBehaviorConfig,
  ChatMessageContext,
  GeneratedMessage,
  BehaviorEvent,
  PersonalityType,
} from '../types';
import {
  createSeededRandom,
  clamp,
  normalRandom,
  randomPick,
  generateEventId,
} from '../utils';
import {
  GREETING_TEMPLATES,
  RESPONSE_TEMPLATES,
  FOLLOW_UP_TEMPLATES,
  QUESTION_TEMPLATES,
  COMPLIMENT_TEMPLATES,
  CLOSING_TEMPLATES,
  TOPIC_KEYWORDS,
  VALUE_KEYWORDS,
} from '../templates/chat-templates';

// ═══════════════════════════════════════════════════════════════
// Personality → Template Style Mapping
// ═══════════════════════════════════════════════════════════════

const PERSONALITY_GREETING_STYLES: Record<PersonalityType, Array<keyof typeof GREETING_TEMPLATES>> = {
  explorer: ['casual', 'playful', 'direct'],
  selective: ['thoughtful', 'warm', 'direct'],
  social: ['casual', 'warm', 'playful'],
  passive: ['casual', 'warm'],
  enthusiastic: ['playful', 'direct', 'warm'],
  cautious: ['thoughtful', 'warm'],
};

const PERSONALITY_RESPONSE_STYLES: Record<PersonalityType, Array<keyof typeof RESPONSE_TEMPLATES>> = {
  explorer: ['agree', 'interested', 'playful'],
  selective: ['share', 'interested', 'empathetic'],
  social: ['agree', 'share', 'playful', 'empathetic'],
  passive: ['agree', 'empathetic'],
  enthusiastic: ['playful', 'agree', 'interested'],
  cautious: ['differ', 'empathetic', 'interested'],
};

// ═══════════════════════════════════════════════════════════════
// Conversation Initiation
// ═══════════════════════════════════════════════════════════════

/**
 * Decide if a bot should initiate a conversation after a match is accepted.
 *
 * Factors:
 * - Personality's initiative probability
 * - Match score (higher scores → more likely to initiate)
 * - Whether the bot is the "receiver" (receivers may wait for senders)
 */
export function shouldInitiateConversation(
  config: BotBehaviorConfig,
  matchScore: number,
  isReceiver: boolean = false,
): boolean {
  const { chat, seed } = config;
  const random = createSeededRandom(seed + matchScore);

  // Score bonus: higher match score increases initiation probability
  const scoreBonus = (matchScore - 50) / 200; // +0.25 max bonus for score=100

  // Receiver penalty: if this bot received the match, they might wait
  const receiverPenalty = isReceiver ? -0.15 : 0;

  const finalProbability = clamp(
    chat.initConversationProbability + scoreBonus + receiverPenalty,
    0.01,
    0.95,
  );

  return random() < finalProbability;
}

/**
 * Calculate delay before initiating conversation (in minutes).
 * Bots don't initiate immediately — there's a natural pause.
 */
export function getInitiationDelay(config: BotBehaviorConfig, matchScore: number): number {
  const { chat, seed } = config;
  const random = createSeededRandom(seed + matchScore + 999);

  // Higher match score → shorter delay
  const scoreFactor = 1 - (matchScore - 50) / 100; // 0.5 to 1.0
  const baseDelay = chat.avgResponseTimeMin * scoreFactor;

  return Math.max(5, Math.round(normalRandom(random, baseDelay, baseDelay * 0.3)));
}

// ═══════════════════════════════════════════════════════════════
// Response Generation
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a response message based on conversation context.
 *
 * Selection strategy:
 * 1. Determine message type (greeting, response, question, etc.)
 * 2. Pick appropriate template based on personality style
 * 3. Optionally fill in context-specific placeholders
 * 4. Calculate realistic response delay
 */
export function generateResponse(
  config: BotBehaviorConfig,
  context: ChatMessageContext,
): GeneratedMessage {
  const { chat, seed, personalityType } = config;
  const random = createSeededRandom(seed + context.chatRoomId.length + Date.now() / 60000);

  if (context.isInitiating) {
    return generateInitMessage(config, context, random);
  }

  if (context.followUpCount > 0 && context.conversationHistory.length === 0) {
    // Partner hasn't responded to previous messages → follow up
    return generateFollowUp(config, context, random);
  }

  // Normal response to partner's message
  const messageType = selectResponseType(config, context, random);
  const content = generateMessageContent(messageType, config, context, random);
  const delayMs = calculateResponseDelayMs(chat, random, messageType);

  return {
    content,
    type: messageType,
    delayMs,
  };
}

/**
 * Select which type of response to send based on conversation flow.
 */
function selectResponseType(
  config: BotBehaviorConfig,
  context: ChatMessageContext,
  random: () => number,
): GeneratedMessage['type'] {
  const { chat } = config;
  const exchangeCount = context.conversationHistory.length;

  // Early conversation: more greetings and questions
  if (exchangeCount <= 2) {
    return randomPick(random, ['greeting', 'question', 'compliment'] as const);
  }

  // Mid conversation: balanced mix
  if (exchangeCount <= chat.avgConversationLength * 0.6) {
    const weights = [
      { item: 'response' as const, weight: 35 },
      { item: 'question' as const, weight: 30 },
      { item: 'share' as const, weight: 25 },
      { item: 'compliment' as const, weight: 10 },
    ];

    let totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let r = random() * totalWeight;
    for (const w of weights) {
      r -= w.weight;
      if (r <= 0) return w.item;
    }
    return 'response';
  }

  // Late conversation: more closings and shares
  if (exchangeCount >= chat.avgConversationLength) {
    if (random() < chat.activeEndProbability) {
      return 'closing';
    }
    const weights = [
      { item: 'share' as const, weight: 35 },
      { item: 'question' as const, weight: 20 },
      { item: 'compliment' as const, weight: 15 },
      { item: 'response' as const, weight: 20 },
      { item: 'closing' as const, weight: 10 },
    ];
    let totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let r = random() * totalWeight;
    for (const w of weights) {
      r -= w.weight;
      if (r <= 0) return w.item;
    }
    return 'share';
  }

  return 'response';
}

/**
 * Generate message content based on type and personality.
 */
function generateMessageContent(
  messageType: GeneratedMessage['type'],
  config: BotBehaviorConfig,
  context: ChatMessageContext,
  random: () => number,
): string {
  const { personalityType } = config;

  switch (messageType) {
    case 'greeting': {
      const styles = PERSONALITY_GREETING_STYLES[personalityType];
      const style = randomPick(random, styles);
      const templates = GREETING_TEMPLATES[style];
      let content = randomPick(random, templates);
      // Fill placeholders
      content = fillPlaceholders(content, context);
      return content;
    }

    case 'response': {
      const styles = PERSONALITY_RESPONSE_STYLES[personalityType];
      const style = randomPick(random, styles);
      const templates = RESPONSE_TEMPLATES[style];
      return randomPick(random, templates);
    }

    case 'question': {
      const categories = Object.keys(QUESTION_TEMPLATES) as Array<keyof typeof QUESTION_TEMPLATES>;
      const category = randomPick(random, categories);
      return randomPick(random, QUESTION_TEMPLATES[category]);
    }

    case 'follow_up':
      return randomPick(random, FOLLOW_UP_TEMPLATES);

    case 'compliment':
      return randomPick(random, COMPLIMENT_TEMPLATES);

    case 'share':
      // Generate a contextual sharing message
      return generateShareMessage(personalityType, context, random);

    case 'closing':
      return randomPick(random, CLOSING_TEMPLATES);

    default:
      return randomPick(random, RESPONSE_TEMPLATES.agree);
  }
}

/**
 * Generate a conversation initiation message.
 */
function generateInitMessage(
  config: BotBehaviorConfig,
  context: ChatMessageContext,
  random: () => number,
): GeneratedMessage {
  const styles = PERSONALITY_GREETING_STYLES[config.personalityType];
  const style = randomPick(random, styles);
  const templates = GREETING_TEMPLATES[style];
  let content = randomPick(random, templates);
  content = fillPlaceholders(content, context);

  const delayMs = calculateResponseDelayMs(config.chat, random, 'greeting');

  return {
    content,
    type: 'greeting',
    delayMs,
  };
}

/**
 * Generate a follow-up message when partner hasn't responded.
 */
function generateFollowUp(
  config: BotBehaviorConfig,
  context: ChatMessageContext,
  random: () => number,
): GeneratedMessage {
  const delayMs = calculateResponseDelayMs(config.chat, random, 'follow_up');

  // If exceeded max follow-ups, don't send
  if (context.followUpCount >= config.chat.maxFollowUps) {
    return {
      content: '',
      type: 'closing',
      delayMs: 0,
    };
  }

  const content = randomPick(random, FOLLOW_UP_TEMPLATES);

  return {
    content,
    type: 'follow_up',
    delayMs,
  };
}

/**
 * Generate a personal sharing message.
 */
function generateShareMessage(
  personalityType: PersonalityType,
  context: ChatMessageContext,
  random: () => number,
): string {
  const shareTemplates = [
    `I've been thinking about that lately. For me, ${randomPick(random, [
      'honesty is really the foundation of everything',
      'it\'s all about finding that balance between giving space and being present',
      'I think communication is the key — even when it\'s uncomfortable',
      'trust is something that builds over time for me',
      'I\'m learning to be more open about what I need',
    ])}.`,
    `That reminds me — I recently ${randomPick(random, [
      'started reading a really interesting book about relationships',
      'had a great conversation with a friend about this exact topic',
      'realized how much I\'ve grown in the past year',
      'tried something completely outside my comfort zone',
    ])}.`,
    `I've found that ${randomPick(random, [
      'quality time is really my love language',
      'I express care through acts of service',
      'I need words of affirmation to feel connected',
      'I show up best when we can just be together',
    ])}.`,
  ];

  return randomPick(random, shareTemplates);
}

/**
 * Fill placeholder tokens in template strings.
 */
function fillPlaceholders(template: string, context: ChatMessageContext): string {
  return template
    .replace(/{name}/g, context.partnerName)
    .replace(/{shared_topic}/g, randomPick(() => 0.5, TOPIC_KEYWORDS))
    .replace(/{shared_value}/g, randomPick(() => 0.5, VALUE_KEYWORDS))
    .replace(/{topic}/g, randomPick(() => 0.5, TOPIC_KEYWORDS));
}

// ═══════════════════════════════════════════════════════════════
// Response Timing
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate realistic response delay in milliseconds.
 *
 * Pattern: humans don't respond at fixed intervals.
 * - Responses cluster around certain times (reading, replying)
 * - Some are quick (< 30s), most are a few minutes
 * - Some take much longer (hours) due to being busy
 */
function calculateResponseDelayMs(
  chatConfig: BotBehaviorConfig['chat'],
  random: () => number,
  messageType: GeneratedMessage['type'],
): number {
  // Base delay from config
  let meanMin = chatConfig.avgResponseTimeMin;
  let stdDev = chatConfig.responseTimeStdDevMin;

  // Adjustments by message type
  switch (messageType) {
    case 'greeting':
      meanMin *= 0.8; // Faster greetings
      break;
    case 'follow_up':
      meanMin *= 2.0; // Slower follow-ups (give partner space)
      stdDev *= 1.5;
      break;
    case 'closing':
      meanMin *= 1.3;
      break;
    case 'question':
      meanMin *= 1.1; // Questions take slightly longer to compose
      break;
  }

  // Log-normal distribution for natural right-skewed timing
  const logMean = Math.log(Math.max(1, meanMin));
  const logStdDev = stdDev / meanMin;
  const normalValue = normalRandom(random, logMean, logStdDev);

  // Convert to milliseconds, clamp between 3 seconds and 12 hours
  const delayMin = Math.exp(normalValue);
  const delayMs = Math.max(3000, Math.min(12 * 60 * 60 * 1000, delayMin * 60 * 1000));

  return Math.round(delayMs);
}

// ═══════════════════════════════════════════════════════════════
// Conversation Lifecycle
// ═══════════════════════════════════════════════════════════════

/**
 * Check if a conversation should naturally fade or end.
 * Accounts for message frequency tapering, response gaps, and max length.
 */
export function shouldEndConversation(
  config: BotBehaviorConfig,
  context: ChatMessageContext,
  minutesSinceLastMessage: number,
): boolean {
  const { chat } = config;
  const exchangeCount = context.conversationHistory.length;

  // Don't end very early conversations
  if (exchangeCount < 4) return false;

  // Check if past average conversation length
  if (exchangeCount >= chat.avgConversationLength) {
    const random = createSeededRandom(config.seed + exchangeCount);
    // Probability of ending increases with each exchange past the average
    const overCount = exchangeCount - chat.avgConversationLength;
    const endProbability = clamp(chat.activeEndProbability + overCount * 0.1, 0, 0.9);
    if (random() < endProbability) return true;
  }

  // Long gap (no response for a long time) → fade out
  const maxGap = chat.avgResponseTimeMin * 5;
  if (minutesSinceLastMessage > maxGap) {
    return true;
  }

  return false;
}

/**
 * Create a chat message behavior event.
 */
export function createChatMessageEvent(
  botUserId: string,
  chatRoomId: string,
  content: string,
  messageType: GeneratedMessage['type'],
): BehaviorEvent {
  return {
    id: generateEventId(),
    botUserId,
    type: 'chat_message_sent',
    timestamp: new Date(),
    data: {
      chatRoomId,
      content,
      messageType,
    },
  };
}
