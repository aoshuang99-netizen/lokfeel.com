/**
 * Chat API Client
 * 
 * Provides a typed interface for all chat-related API endpoints.
 * Handles authentication, error handling, and response parsing.
 * 
 * @version 2.0 - 与 backend-architect 的 IM API 对齐
 * 
 * API Endpoints:
 * - POST /api/im/send - 发送消息
 * - GET  /api/im/conversations - 会话列表
 * - GET  /api/im/messages/[convId] - 消息历史
 * - POST /api/im/read - 标记已读
 * - GET  /api/im/presence - 在线状态
 * - POST /api/im/consent - 同意管理
 */

// ============================================================================
// Types
// ============================================================================

import type {
  IMMessagePayload,
  ConversationListItem,
  GetConversationsAPIResponse,
  GetMessagesAPIResponse,
  SendMessageAPIRequest,
  SendMessageAPIResponse,
  MarkReadAPIRequest,
  MarkReadAPIResponse,
  RuleEngineResult,
  PaceLimitNotification,
  ConsentRequestPayload,
  PresenceStatus,
} from './im/types';

// Legacy type aliases for backward compatibility
export type Message = IMMessagePayload;
export type Conversation = ConversationListItem;

export interface ChatUser {
  id: string;
  name: string;
  age?: number;
  avatar?: string | null;
  isOnline?: boolean;
  isBot?: boolean;
  lastSeen?: string;
  presence?: PresenceStatus;
}

// Legacy request/response types (for backward compatibility)
export interface SendMessageRequest {
  content: string;
  type?: "text" | "image" | "voice";
  replyToId?: string;
  clientMsgId?: string;
}

export interface SendMessageResponse {
  success: boolean;
  message?: Message;
  error?: string;
  code?: string;
  ruleResult?: RuleEngineResult;
  paceInfo?: PaceLimitNotification;
}

export interface GetMessagesParams {
  beforeMsgId?: string;
  limit?: number;
}

export interface GetMessagesResponse {
  messages: Message[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface MarkReadRequest {
  conversationId: string;
  upToMsgId: string;
}

export interface TypingRequest {
  isTyping: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}

// Additional types for new IM API
export interface ConversationsParams {
  limit?: number;
  cursor?: string;
}

export interface PresenceParams {
  userId?: string;
  status?: PresenceStatus;
}

export interface ConsentRequest {
  action: 'request' | 'grant' | 'deny';
  targetId: string;
  conversationId: string;
  consentType: string;
  requestedLevel: string;
  reason?: string;
}

export interface ConsentResponse {
  state: string;
  grant?: boolean;
  pendingRequest?: ConsentRequestPayload;
}

// ============================================================================
// API Client Class
// ============================================================================

class ChatApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl;
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Handle non-JSON responses
      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return {} as T;
      }

      const data = await response.json();

      if (!response.ok) {
        const error: ApiError = {
          code: data.code || `HTTP_${response.status}`,
          message: data.message || response.statusText,
          details: data.details,
        };
        throw error;
      }

      return data as T;
    } catch (err) {
      // Re-throw if it's already an API error object
      if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
        throw err;
      }
      throw new Error(`Network error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  // ===========================================================================
  // IM API v2 - 新 API (与 backend-architect 对齐)
  // ===========================================================================

  /**
   * 发送消息 (IM API v2)
   * 
   * @param conversationId 会话 ID
   * @param content 消息内容
   * @param msgType 消息类型 (TEXT, IMAGE, VOICE, etc.)
   * @param clientMsgId 客户端消息 ID (用于幂等)
   */
  async sendMessage(
    conversationId: string,
    content: string,
    msgType: 'TEXT' | 'IMAGE' | 'VOICE' = 'TEXT',
    clientMsgId?: string
  ): Promise<SendMessageAPIResponse> {
    const request: SendMessageAPIRequest = {
      conversationId,
      content,
      msgType,
      clientMsgId: clientMsgId || this.generateClientMsgId(),
    };
    
    return this.request<SendMessageAPIResponse>('/api/im/send', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * 获取会话列表 (IM API v2)
   */
  async getConversations(params?: ConversationsParams): Promise<GetConversationsAPIResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    
    const query = searchParams.toString();
    const endpoint = `/api/im/conversations${query ? `?${query}` : ''}`;
    
    return this.request<GetConversationsAPIResponse>(endpoint, {
      method: 'GET',
    });
  }

  /**
   * 获取消息历史 (IM API v2)
   */
  async getMessages(
    conversationId: string,
    params?: GetMessagesParams
  ): Promise<GetMessagesAPIResponse> {
    const searchParams = new URLSearchParams();
    if (params?.beforeMsgId) searchParams.set('beforeMsgId', params.beforeMsgId);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    
    const query = searchParams.toString();
    const endpoint = `/api/im/messages/${conversationId}${query ? `?${query}` : ''}`;
    
    return this.request<GetMessagesAPIResponse>(endpoint, {
      method: 'GET',
    });
  }

  /**
   * 标记已读 (IM API v2)
   */
  async markAsRead(conversationId: string, upToMsgId: string): Promise<MarkReadAPIResponse> {
    const request: MarkReadAPIRequest = {
      conversationId,
      upToMsgId,
    };
    
    return this.request<MarkReadAPIResponse>('/api/im/read', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * 获取在线状态
   */
  async getPresence(): Promise<Record<string, PresenceStatus>> {
    return this.request<Record<string, PresenceStatus>>('/api/im/presence', {
      method: 'GET',
    });
  }

  /**
   * 更新在线状态
   */
  async updatePresence(status: PresenceStatus): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/api/im/presence', {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  }

  /**
   * 获取同意状态
   */
  async getConsent(conversationId?: string): Promise<ConsentResponse> {
    const endpoint = conversationId 
      ? `/api/im/consent?conversationId=${conversationId}`
      : '/api/im/consent';
    
    return this.request<ConsentResponse>(endpoint, {
      method: 'GET',
    });
  }

  /**
   * 请求/管理同意
   */
  async updateConsent(request: ConsentRequest): Promise<{
    success: boolean;
    requestId?: string;
  }> {
    return this.request<{ success: boolean; requestId?: string }>('/api/im/consent', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // ===========================================================================
  // Legacy API (向后兼容)
  // ===========================================================================

  /**
   * Get all conversations for the current user (legacy)
   * @deprecated Use getConversations() instead
   */
  async getConversationsLegacy(): Promise<{ chats: Conversation[] }> {
    return this.request<{ chats: Conversation[] }>("/api/chat", {
      method: "GET",
    });
  }

  /**
   * Get a single conversation by ID (legacy)
   * @deprecated 使用 getMessages() 获取消息
   */
  async getConversation(roomId: string): Promise<{ room: any }> {
    return this.request<{ room: any }>(`/api/chat/${roomId}`, {
      method: "GET",
    });
  }

  /**
   * Send a message (legacy)
   * @deprecated Use sendMessage() instead
   */
  async sendMessageLegacy(roomId: string, data: SendMessageRequest): Promise<SendMessageResponse> {
    return this.request<SendMessageResponse>(`/api/chat/${roomId}/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * Send typing indicator
   */
  async sendTyping(conversationId: string, isTyping: boolean): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/im/typing`, {
      method: 'POST',
      body: JSON.stringify({ conversationId, isTyping }),
    });
  }

  // ===========================================================================
  // User Actions API
  // ===========================================================================

  /**
   * Get user messaging limits
   */
  async getUserLimits(): Promise<{
    isPremium: boolean;
    maxChats: number;
    currentChats: number;
    messagesSent: number;
    messagesRemaining: number;
  }> {
    return this.request<{
      isPremium: boolean;
      maxChats: number;
      currentChats: number;
      messagesSent: number;
      messagesRemaining: number;
    }>("/api/user/limits", {
      method: "GET",
    });
  }

  /**
   * Block a user
   */
  async blockUser(userId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/users/${userId}/block`, {
      method: "POST",
    });
  }

  /**
   * Unblock a user
   */
  async unblockUser(userId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/users/${userId}/unblock`, {
      method: "POST",
    });
  }

  /**
   * Report a user
   */
  async reportUser(
    userId: string,
    reason: string,
    details?: string
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/users/${userId}/report`, {
      method: "POST",
      body: JSON.stringify({ reason, details }),
    });
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  /**
   * Generate a unique client message ID
   */
  private generateClientMsgId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const chatApi = new ChatApiClient();

// ============================================================================
// React Hooks
// ============================================================================

import { useCallback, useState } from "react";

/**
 * Hook for using the chat API with automatic error handling
 */
export function useChatApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await fn();
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Unknown error");
        setError(error);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    loading,
    error,
    execute,
    clearError: () => setError(null),
  };
}

// ============================================================================
// Exports
// ============================================================================

export default chatApi;
