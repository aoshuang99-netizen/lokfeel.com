/**
 * Power Board Lite 规则同步机制
 * LokFee! IM 模块边界控制系统
 * 
 * 核心功能：
 * - 规则版本管理
 * - 增量同步逻辑
 * - WebSocket 规则推送
 */

import { getDb } from '@/lib/db';
import type { ServerEvent, PowerBoardRulesPayload } from '@/lib/im/types';
import {
  PowerBoardRules,
  RuleChange,
  RuleDelta,
  RuleUpdate,
  RulesResponse,
  ServerRuleEvents,
  ClientRuleEvents,
} from './types';
import { getRuleEngine } from './engine';

// ============================================================================
// 版本管理
// ============================================================================

export class RuleVersionManager {
  /**
   * 比较两个版本号
   * @returns -1: v1 < v2, 0: v1 = v2, 1: v1 > v2
   */
  static compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }
    return 0;
  }

  /**
   * 检查是否为重大版本差异（需要完整同步）
   */
  static isMajorVersionDiff(v1: string, v2: string): boolean {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    // 主版本或次版本不同视为重大差异
    return parts1[0] !== parts2[0] || parts1[1] !== parts2[1];
  }

  /**
   * 递增补丁版本
   */
  static incrementPatch(version: string): string {
    const parts = version.split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1;
    return parts.join('.');
  }

  /**
   * 递增次版本
   */
  static incrementMinor(version: string): string {
    const parts = version.split('.').map(Number);
    parts[1] = (parts[1] || 0) + 1;
    parts[2] = 0;
    return parts.join('.');
  }

  /**
   * 递增主版本
   */
  static incrementMajor(version: string): string {
    const parts = version.split('.').map(Number);
    parts[0] = (parts[0] || 1) + 1;
    parts[1] = 0;
    parts[2] = 0;
    return parts.join('.');
  }
}

// ============================================================================
// 增量同步管理器
// ============================================================================

export class RuleSyncManager {
  private versionHistory: Map<string, Array<{ version: string; rules: PowerBoardRules; timestamp: number }>> = new Map();
  private readonly MAX_HISTORY_SIZE = 10;

  /**
   * 获取规则（支持增量同步）
   */
  async getRulesWithVersion(
    userId: string,
    clientVersion?: string
  ): Promise<RulesResponse> {
    const ruleEngine = getRuleEngine();
    const currentRules = await ruleEngine.getUserRules(userId);

    // 客户端无版本或版本落后较多，返回完整规则
    if (!clientVersion || RuleVersionManager.isMajorVersionDiff(clientVersion, currentRules.version)) {
      return {
        type: 'full',
        rules: currentRules,
        serverTimestamp: Date.now(),
      };
    }

    // 版本相同，无需更新
    if (RuleVersionManager.compareVersions(clientVersion, currentRules.version) === 0) {
      return {
        type: 'delta',
        delta: { changes: [], removedFields: [] },
        baseVersion: clientVersion,
        targetVersion: currentRules.version,
        serverTimestamp: Date.now(),
      };
    }

    // 版本接近，返回增量
    const delta = await this.calculateDelta(userId, clientVersion, currentRules);
    return {
      type: 'delta',
      delta,
      baseVersion: clientVersion,
      targetVersion: currentRules.version,
      serverTimestamp: Date.now(),
    };
  }

  /**
   * 计算规则增量
   */
  async calculateDelta(
    userId: string,
    fromVersion: string,
    toRules: PowerBoardRules
  ): Promise<RuleDelta> {
    const history = this.versionHistory.get(userId) || [];
    const fromRules = history.find(h => h.version === fromVersion)?.rules;

    if (!fromRules) {
      // 无法找到历史版本，返回所有字段作为变更
      return {
        changes: [
          { field: 'pace', oldValue: null, newValue: toRules.pace, changedAt: new Date() },
          { field: 'media', oldValue: null, newValue: toRules.media, changedAt: new Date() },
          { field: 'filter', oldValue: null, newValue: toRules.filter, changedAt: new Date() },
          { field: 'autoReply', oldValue: null, newValue: toRules.autoReply, changedAt: new Date() },
        ],
        removedFields: [],
      };
    }

    const changes: RuleChange[] = [];
    const removedFields: string[] = [];

    // 比较 pace
    if (JSON.stringify(fromRules.pace) !== JSON.stringify(toRules.pace)) {
      changes.push({
        field: 'pace',
        oldValue: fromRules.pace,
        newValue: toRules.pace,
        changedAt: new Date(),
      });
    }

    // 比较 media
    if (JSON.stringify(fromRules.media) !== JSON.stringify(toRules.media)) {
      changes.push({
        field: 'media',
        oldValue: fromRules.media,
        newValue: toRules.media,
        changedAt: new Date(),
      });
    }

    // 比较 filter
    if (JSON.stringify(fromRules.filter) !== JSON.stringify(toRules.filter)) {
      changes.push({
        field: 'filter',
        oldValue: fromRules.filter,
        newValue: toRules.filter,
        changedAt: new Date(),
      });
    }

    // 比较 autoReply
    if (JSON.stringify(fromRules.autoReply) !== JSON.stringify(toRules.autoReply)) {
      changes.push({
        field: 'autoReply',
        oldValue: fromRules.autoReply,
        newValue: toRules.autoReply,
        changedAt: new Date(),
      });
    }

    return { changes, removedFields };
  }

  /**
   * 记录规则版本历史
   */
  recordVersion(userId: string, rules: PowerBoardRules): void {
    const history = this.versionHistory.get(userId) || [];
    
    history.push({
      version: rules.version,
      rules,
      timestamp: Date.now(),
    });

    // 限制历史记录大小
    if (history.length > this.MAX_HISTORY_SIZE) {
      history.shift();
    }

    this.versionHistory.set(userId, history);
  }

  /**
   * 清理过期历史
   */
  cleanupHistory(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [userId, history] of this.versionHistory.entries()) {
      const filtered = history.filter(h => now - h.timestamp < maxAgeMs);
      if (filtered.length === 0) {
        this.versionHistory.delete(userId);
      } else {
        this.versionHistory.set(userId, filtered);
      }
    }
  }
}

// ============================================================================
// WebSocket 规则推送 (适配 IM ServerEvent 类型)
// ============================================================================

export interface WebSocketClient {
  id: string;
  userId: string;
  send: (data: ServerEvent) => void;
  isConnected: boolean;
}

export class RuleWebSocketManager {
  private clients: Map<string, WebSocketClient> = new Map();
  private userClients: Map<string, Set<string>> = new Map(); // userId -> clientIds

  /**
   * 注册客户端
   */
  registerClient(client: WebSocketClient): void {
    this.clients.set(client.id, client);
    
    const userClientIds = this.userClients.get(client.userId) || new Set();
    userClientIds.add(client.id);
    this.userClients.set(client.userId, userClientIds);
  }

  /**
   * 注销客户端
   */
  unregisterClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      const userClientIds = this.userClients.get(client.userId);
      if (userClientIds) {
        userClientIds.delete(clientId);
        if (userClientIds.size === 0) {
          this.userClients.delete(client.userId);
        }
      }
    }
    this.clients.delete(clientId);
  }

  /**
   * 广播规则更新 - 适配 ServerEvent 类型
   */
  async broadcastRuleUpdate(
    userId: string,
    update: RuleUpdate
  ): Promise<void> {
    // 获取与该用户相关的所有对话
    try {
      const db = getDb();
      const conversations = await db.match.findMany({
        where: {
          OR: [{ senderId: userId }, { receiverId: userId }],
          status: 'ACCEPTED',
        },
        select: {
          senderId: true,
          receiverId: true,
        },
      });

      // 提取对方用户ID
      const peerIds = new Set<string>();
      for (const conv of conversations) {
        const peerId = conv.senderId === userId ? conv.receiverId : conv.senderId;
        peerIds.add(peerId);
      }

      // 推送规则更新 - 使用 ServerEvent 格式
      const updateData = update as any;
      const payload: PowerBoardRulesPayload = {
        userId,
        version: update.newVersion,
        isActive: true,
        pace: updateData.pace || {
          maxMessagesPerHour: 20,
          maxMessagesPerDay: 100,
          responseWindowHours: 24,
          enforceCooldown: true,
          cooldownMinutes: 5,
          showRemainingQuota: true,
        },
        media: updateData.media || {
          defaultLevel: 'L0_TEXT',
          perUserOverride: {},
          requireConsentForUpgrade: true,
          autoBlurImages: true,
          watermarkAllMedia: true,
        },
        filter: updateData.filter || {
          blockedKeywords: [],
          blockedPatterns: [],
          blockExplicitImages: true,
          autoFlagProfanity: true,
          blockUnsolicitedContact: true,
          sensitivityLevel: 3,
        },
        privacy: {
          preferredEncryption: 'E2EE',
          allowScreenshotNotifications: true,
          autoExpireMessages: false,
          expireAfterDays: 7,
          hideOnlineStatus: false,
          hideReadReceipts: false,
        },
      };

      const event: ServerEvent = {
        eventId: `rule_update_${Date.now()}`,
        eventType: 'rule_update',
        timestamp: Date.now(),
        payload,
      };

      for (const peerId of peerIds) {
        this.sendToUser(peerId, event);
      }
    } catch (error) {
      console.error('Failed to broadcast rule update:', error);
    }
  }

  /**
   * 发送频率限制警告 - 适配 ServerEvent 类型
   */
  sendPaceWarning(
    userId: string,
    data: ServerRuleEvents['rules:pace_warning'] & { conversationId?: string; cooldownUntil?: number; reason?: string; maxMessages?: number }
  ): void {
    const event: ServerEvent = {
      eventId: `pace_warning_${Date.now()}`,
      eventType: 'pace_limit',
      timestamp: Date.now(),
      payload: {
        convId: data.conversationId || '',
        cooldownUntil: data.cooldownUntil || Date.now() + 3600000,
        reason: data.reason || 'pace_limit',
        messagesRemaining: data.messagesRemaining || 0,
        maxMessages: data.maxMessages || 20,
        resetAfterMinutes: data.resetAfterMinutes || 60,
      },
    };
    this.sendToUser(userId, event);
  }

  /**
   * 发送消息拦截通知 - 适配 ServerEvent 类型
   */
  sendMessageBlocked(
    userId: string,
    data: ServerRuleEvents['rules:message_blocked']
  ): void {
    const event: ServerEvent = {
      eventId: `msg_blocked_${Date.now()}`,
      eventType: 'system',
      timestamp: Date.now(),
      payload: {
        level: 'WARNING',
        title: 'Message Blocked',
        message: `Your message was blocked: ${data.reason}`,
        expiresAt: Date.now() + 60000,
      },
    };
    this.sendToUser(userId, event);
  }

  /**
   * 向指定用户发送消息 - 使用 ServerEvent 类型
   */
  private sendToUser(userId: string, event: ServerEvent): void {
    const clientIds = this.userClients.get(userId);
    if (!clientIds) return;

    for (const clientId of clientIds) {
      const client = this.clients.get(clientId);
      if (client && client.isConnected) {
        try {
          client.send(event);
        } catch (error) {
          console.error(`Failed to send message to client ${clientId}:`, error);
        }
      }
    }
  }

  /**
   * 处理客户端确认
   */
  handleClientAck(clientId: string, ack: ClientRuleEvents['rules:ack']): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // 可以记录客户端已收到的版本，用于重连时的同步
    console.log(`Client ${clientId} acknowledged version ${ack.version}`);
  }

  /**
   * 处理同步请求
   */
  async handleSyncRequest(
    clientId: string,
    request: ClientRuleEvents['rules:sync_request']
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const syncManager = new RuleSyncManager();
    const response = await syncManager.getRulesWithVersion(
      client.userId,
      request.lastVersion
    );

    const event: ServerEvent = {
      eventId: `sync_response_${Date.now()}`,
      eventType: 'rule_update',
      timestamp: Date.now(),
      payload: response as unknown as PowerBoardRulesPayload,
    };

    client.send(event);
  }

  /**
   * 获取在线客户端数量
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * 获取用户在线状态
   */
  isUserOnline(userId: string): boolean {
    const clientIds = this.userClients.get(userId);
    return !!clientIds && clientIds.size > 0;
  }

  /**
   * 清理断开连接的客户端
   */
  cleanup(): void {
    for (const [clientId, client] of this.clients.entries()) {
      if (!client.isConnected) {
        this.unregisterClient(clientId);
      }
    }
  }
}

// ============================================================================
// 离线规则缓存（客户端使用）
// ============================================================================

export interface CachedRules {
  rules: PowerBoardRules;
  cachedAt: number;
  expiresAt: number;
}

export class OfflineRuleCache {
  private storage: Map<string, CachedRules> = new Map();
  private readonly DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 7天

  /**
   * 缓存规则
   */
  cacheRules(userId: string, rules: PowerBoardRules, ttlMs?: number): void {
    const now = Date.now();
    this.storage.set(userId, {
      rules,
      cachedAt: now,
      expiresAt: now + (ttlMs || this.DEFAULT_TTL),
    });
  }

  /**
   * 获取缓存规则
   */
  getCachedRules(userId: string): PowerBoardRules | null {
    const cached = this.storage.get(userId);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
      this.storage.delete(userId);
      return null;
    }
    return cached.rules;
  }

  /**
   * 检查缓存是否有效
   */
  isValid(userId: string): boolean {
    const cached = this.storage.get(userId);
    if (!cached) return false;
    return Date.now() <= cached.expiresAt;
  }

  /**
   * 使缓存失效
   */
  invalidate(userId: string): void {
    this.storage.delete(userId);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.storage.clear();
  }
}

// ============================================================================
// 单例导出
// ============================================================================

let globalSyncManager: RuleSyncManager | null = null;
let globalWebSocketManager: RuleWebSocketManager | null = null;
let globalOfflineCache: OfflineRuleCache | null = null;

export function getRuleSyncManager(): RuleSyncManager {
  if (!globalSyncManager) {
    globalSyncManager = new RuleSyncManager();
  }
  return globalSyncManager;
}

export function getRuleWebSocketManager(): RuleWebSocketManager {
  if (!globalWebSocketManager) {
    globalWebSocketManager = new RuleWebSocketManager();
  }
  return globalWebSocketManager;
}

export function getOfflineRuleCache(): OfflineRuleCache {
  if (!globalOfflineCache) {
    globalOfflineCache = new OfflineRuleCache();
  }
  return globalOfflineCache;
}

// 定期清理
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    getRuleSyncManager().cleanupHistory();
    getRuleWebSocketManager().cleanup();
  }, 300000); // 每5分钟清理一次
}
