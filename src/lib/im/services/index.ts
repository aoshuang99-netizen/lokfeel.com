/**
 * IM Services — Central export hub
 */

export { PaceController, paceController } from './pace-controller';
export { PresenceManager, presenceManager } from './presence-manager';
export { RuleEvaluator, ruleEvaluator, getUserRules, getDefaultRules } from './rule-evaluator';
export { SeqGenerator, seqGenerator } from './seq-generator';
export { AuditLogger, auditLogger } from './audit-logger';
export type { AuditLogEntry, AuditAction } from './audit-logger';
export type { PaceCheckResult } from './pace-controller';
export type { PresenceInfo } from './presence-manager';

// WebSocket 推送函数
export { pushToUser, pushToConversation } from '../websocket/pusher-bridge';
