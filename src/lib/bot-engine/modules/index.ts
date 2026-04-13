/**
 * LokFeel Bot Behavior Engine — Module Index
 *
 * Re-exports all modules for convenient access.
 */

export { calculateOnlineProbability, calculateSessionDuration, createOnlineState, evaluateOnlineTransition, estimateNextSessionDelay } from './online-status';
export { simulateBrowseSession, generateSingleProfileView, shouldBrowseNow } from './browsing';
export type { ProfileViewEvent, BrowseSessionResult } from './browsing';
export { calculateAcceptProbability, makeMatchDecision, processPendingMatches, createMatchReactionEvent } from './match-response';
export type { PendingMatch } from './match-response';
export { shouldInitiateConversation, getInitiationDelay, generateResponse, shouldEndConversation, createChatMessageEvent } from './chat';
export type { GeneratedMessage, ChatMessageContext } from '../types';
export { BehaviorLogger } from './logger';
export type { LoggerConfig, LogLevel, BotStats, HealthSummary, AnomalyReport } from './logger';
