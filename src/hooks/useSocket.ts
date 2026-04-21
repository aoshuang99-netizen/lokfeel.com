"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { MessageBubbleProps } from "@/components/chat/message-bubble";

// ============================================================================
// Types
// ============================================================================

import type {
  IMMessagePayload,
  TypingIndicator,
  ReadReceiptPayload,
  ConversationUpdatePayload,
  PaceLimitNotification,
  ConsentRequestPayload,
  ConsentResponsePayload,
  PowerBoardRulesPayload,
  MessageStatusUpdate,
  RuleEngineResult,
} from '@/lib/im/types';

interface UseSocketOptions {
  /** 会话 ID (使用 convId) */
  conversationId?: string | null;
  userId?: string | null;
  autoConnect?: boolean;
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
}

interface UseSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: Error | null;
  connect: () => void;
  disconnect: () => void;
  emit: (event: string, data?: unknown) => void;
}

interface IMEventHandlers {
  onMessage?: (message: IMMessagePayload) => void;
  onTyping?: (data: TypingIndicator) => void;
  onReadReceipt?: (data: ReadReceiptPayload) => void;
  onConversationUpdate?: (data: ConversationUpdatePayload) => void;
  onPaceLimit?: (data: PaceLimitNotification) => void;
  onConsentRequest?: (data: ConsentRequestPayload) => void;
  onConsentResponse?: (data: ConsentResponsePayload) => void;
  onRuleUpdate?: (data: PowerBoardRulesPayload) => void;
  onMessageStatus?: (data: MessageStatusUpdate) => void;
  onError?: (error: Error) => void;
}

interface UseChatRoomSocketReturn extends IMEventHandlers {
  /** 消息列表 */
  messages: IMMessagePayload[];
  /** 是否正在打字 */
  isTyping: boolean;
  /** 正在打字的用户 ID */
  typingUserId: string | null;
  /** 发送消息 */
  sendMessage: (content: string, msgType?: 'TEXT' | 'IMAGE' | 'VOICE') => Promise<void>;
  /** 发送打字指示器 */
  sendTyping: (isTyping: boolean) => void;
  /** 标记消息已读 */
  markAsRead: (upToMsgId: string) => void;
  /** 订阅会话 */
  subscribeToConversation: (convId: string) => void;
  /** 取消订阅会话 */
  unsubscribeFromConversation: () => void;
  /** 错误状态 */
  error: Error | null;
}

// ============================================================================
// Socket Configuration
// ============================================================================

const DEFAULT_SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "";
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH || "/api/socketio";

const DEFAULT_OPTIONS: UseSocketOptions = {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
};

// ============================================================================
// Socket Client Singleton
// ============================================================================

let socketClient: Socket | null = null;
let connectionListeners: Array<(socket: Socket | null) => void> = [];

export function getSocketClient(): Socket | null {
  return socketClient;
}

export function onSocketConnectionChange(listener: (socket: Socket | null) => void): () => void {
  connectionListeners.push(listener);
  return () => {
    connectionListeners = connectionListeners.filter((l) => l !== listener);
  };
}

function notifyConnectionChange(socket: Socket | null): void {
  connectionListeners.forEach((listener) => listener(socket));
}

// ============================================================================
// useSocket Hook
// ============================================================================

export function useSocket(options: UseSocketOptions = {}): UseSocketReturn {
  const { autoConnect = true, reconnection = true, reconnectionAttempts = 5, reconnectionDelay = 1000 } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const optionsRef = useRef(options);
  const reconnectAttemptsRef = useRef(0);

  // Update options ref
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Initialize socket connection
  const connect = useCallback(() => {
    if (socketClient?.connected) {
      setIsConnected(true);
      socketRef.current = socketClient;
      return;
    }

    if (socketClient && (socketClient as any).connecting) {
      setIsConnecting(true);
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      socketClient = io(DEFAULT_SOCKET_URL || undefined, {
        path: SOCKET_PATH,
        reconnection,
        reconnectionAttempts,
        reconnectionDelay,
        reconnectionDelayMax: 5000,
        transports: ["websocket", "polling"],
        autoConnect: true,
      });

      socketClient.on("connect", () => {
        console.log("[Socket] Connected:", socketClient?.id);
        setIsConnected(true);
        setIsConnecting(false);
        reconnectAttemptsRef.current = 0;
        notifyConnectionChange(socketClient);
      });

      socketClient.on("disconnect", (reason) => {
        console.log("[Socket] Disconnected:", reason);
        setIsConnected(false);
        notifyConnectionChange(null);
      });

      socketClient.on("connect_error", (err) => {
        console.error("[Socket] Connection error:", err);
        reconnectAttemptsRef.current++;
        setError(new Error(`Connection failed: ${err.message}`));
        setIsConnecting(false);

        if (reconnectAttemptsRef.current >= reconnectionAttempts) {
          setError(new Error("Unable to connect. Please check your internet connection."));
        }
      });

      socketClient.on("error", (err) => {
        console.error("[Socket] Error:", err);
        setError(new Error("Socket error occurred"));
      });

      socketRef.current = socketClient;
    } catch (err) {
      console.error("[Socket] Failed to initialize:", err);
      setError(err instanceof Error ? err : new Error("Failed to initialize socket"));
      setIsConnecting(false);
    }
  }, [reconnection, reconnectionAttempts, reconnectionDelay]);

  // Disconnect socket
  const disconnect = useCallback(() => {
    if (socketClient) {
      socketClient.disconnect();
      socketClient = null;
      socketRef.current = null;
      setIsConnected(false);
      setIsConnecting(false);
      notifyConnectionChange(null);
    }
  }, []);

  // Emit event
  const emit = useCallback((event: string, data?: unknown) => {
    if (socketClient?.connected) {
      socketClient.emit(event, data);
    } else {
      console.warn("[Socket] Cannot emit: not connected");
    }
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      // Don't disconnect on unmount - maintain singleton connection
    };
  }, [autoConnect, connect]);

  return {
    socket: socketRef.current,
    isConnected,
    isConnecting,
    error,
    connect,
    disconnect,
    emit,
  };
}

// ============================================================================
// useChatRoomSocket Hook
// ============================================================================

export function useChatRoomSocket(options: UseSocketOptions = {}): UseChatRoomSocketReturn {
  const { conversationId, userId } = options;
  
  const [messages, setMessages] = useState<IMMessagePayload[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  
  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentConvRef = useRef<string | null>(null);
  const eventHandlersRef = useRef<IMEventHandlers>({});

  // Initialize socket connection
  const { socket, isConnected, emit, error: socketError } = useSocket(options);

  // Update socket ref
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  // Update current conversation ref
  useEffect(() => {
    currentConvRef.current = conversationId || null;
  }, [conversationId]);

  // Update error state
  useEffect(() => {
    setError(socketError);
  }, [socketError]);

  // Subscribe to conversation events (IM API v2)
  const subscribeToConversation = useCallback((convId: string) => {
    if (!socketRef.current || !convId) return;
    
    console.log("[Socket] Subscribing to conversation:", convId);
    
    // Subscribe to conversation
    socketRef.current.emit("im:subscribe", { convId });
    
    // IM API v2 Events:
    
    // im:message — 新消息
    socketRef.current.on("im:message", (data: { message: IMMessagePayload }) => {
      console.log("[Socket] New message:", data.message);
      setMessages((prev) => [...prev, data.message]);
      eventHandlersRef.current.onMessage?.(data.message);
    });
    
    // im:typing — 打字指示器
    socketRef.current.on("im:typing", (data: TypingIndicator) => {
      if (data.userId !== userId) {
        setTypingUserId(data.userId);
        setIsTyping(data.isTyping);
        
        if (data.isTyping) {
          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
          }
          typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false);
            setTypingUserId(null);
          }, 3000);
        }
      }
      eventHandlersRef.current.onTyping?.(data);
    });
    
    // im:read_receipt — 已读回执
    socketRef.current.on("im:read_receipt", (data: ReadReceiptPayload) => {
      console.log("[Socket] Read receipt:", data);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.msgId === data.upToMsgId || msg.seq <= data.upToSeq
            ? { ...msg, status: 'READ' as const }
            : msg
        )
      );
      eventHandlersRef.current.onReadReceipt?.(data);
    });
    
    // im:conversation_update — 会话状态变更
    socketRef.current.on("im:conversation_update", (data: ConversationUpdatePayload) => {
      console.log("[Socket] Conversation update:", data);
      eventHandlersRef.current.onConversationUpdate?.(data);
    });
    
    // im:pace_limit — 频率限制通知
    socketRef.current.on("im:pace_limit", (data: PaceLimitNotification) => {
      console.log("[Socket] Pace limit:", data);
      eventHandlersRef.current.onPaceLimit?.(data);
    });
    
    // im:consent_request — 同意请求
    socketRef.current.on("im:consent_request", (data: ConsentRequestPayload) => {
      console.log("[Socket] Consent request:", data);
      eventHandlersRef.current.onConsentRequest?.(data);
    });
    
    // im:consent_response — 同意响应
    socketRef.current.on("im:consent_response", (data: ConsentResponsePayload) => {
      console.log("[Socket] Consent response:", data);
      eventHandlersRef.current.onConsentResponse?.(data);
    });
    
    // im:rule_update — 规则更新
    socketRef.current.on("im:rule_update", (data: PowerBoardRulesPayload) => {
      console.log("[Socket] Rule update:", data);
      eventHandlersRef.current.onRuleUpdate?.(data);
    });
    
    // im:message_status — 消息状态更新
    socketRef.current.on("im:message_status", (data: MessageStatusUpdate) => {
      console.log("[Socket] Message status:", data);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.msgId === data.msgId ? { ...msg, status: data.status } : msg
        )
      );
      eventHandlersRef.current.onMessageStatus?.(data);
    });
  }, [userId]);

  // Unsubscribe from conversation
  const unsubscribeFromConversation = useCallback(() => {
    const convId = currentConvRef.current;
    if (!socketRef.current || !convId) return;
    
    console.log("[Socket] Unsubscribing from conversation:", convId);
    
    // Unsubscribe from conversation
    socketRef.current.emit("im:unsubscribe", { convId });
    
    // Remove IM event listeners
    socketRef.current.off("im:message");
    socketRef.current.off("im:typing");
    socketRef.current.off("im:read_receipt");
    socketRef.current.off("im:conversation_update");
    socketRef.current.off("im:pace_limit");
    socketRef.current.off("im:consent_request");
    socketRef.current.off("im:consent_response");
    socketRef.current.off("im:rule_update");
    socketRef.current.off("im:message_status");
    
    // Clear state
    setMessages([]);
    setIsTyping(false);
    setTypingUserId(null);
    currentConvRef.current = null;
  }, []);

  // Auto-subscribe when conversationId changes
  useEffect(() => {
    if (conversationId && isConnected) {
      subscribeToConversation(conversationId);
    }
    
    return () => {
      unsubscribeFromConversation();
    };
  }, [conversationId, isConnected, subscribeToConversation, unsubscribeFromConversation]);

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // Send message
  const sendMessage = useCallback(async (
    content: string, 
    msgType: 'TEXT' | 'IMAGE' | 'VOICE' = 'TEXT'
  ): Promise<void> => {
    const convId = currentConvRef.current;
    if (!socketRef.current || !convId || !content.trim()) {
      throw new Error("Cannot send message: not connected or empty content");
    }

    // Generate client message ID for idempotency
    const clientMsgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Optimistic update - create temp message
    const tempMessage: IMMessagePayload = {
      msgId: clientMsgId,
      clientMsgId,
      senderId: userId || "me",
      receiverId: "",
      convId,
      seq: 0, // Will be updated by server
      msgType,
      payload: content,
      encryptionMode: 'SERVER',
      complianceTags: [],
      consentState: 'CONSENT_NONE',
      mediaLevel: msgType === 'TEXT' ? 'L0_TEXT' : msgType === 'IMAGE' ? 'L1_IMAGE' : 'L2_VOICE',
      ruleResult: 'PASS',
      isEdited: false,
      isDeleted: false,
      status: 'SENDING',
      timestamp: Date.now(),
    };
    
    setMessages((prev) => [...prev, tempMessage]);

    return new Promise((resolve, reject) => {
      socketRef.current?.emit(
        "im:send",
        { conversationId: convId, content, msgType, clientMsgId },
        (response: { 
          success: boolean; 
          message?: IMMessagePayload; 
          error?: string;
          ruleResult?: RuleEngineResult;
        }) => {
          if (response.success) {
            // Replace temp message with real one from server
            setMessages((prev) =>
              prev.map((msg) =>
                msg.clientMsgId === clientMsgId && response.message 
                  ? { ...response.message }
                  : msg
              )
            );
            
            // Handle rule engine result
            if (response.ruleResult === 'SOFT_BLOCK') {
              console.warn("[Socket] Soft block warning:", response.message);
            } else if (response.ruleResult === 'HARD_BLOCK') {
              console.error("[Socket] Hard block - message rejected:", response.error);
              setMessages((prev) => prev.filter((msg) => msg.clientMsgId !== clientMsgId));
              reject(new Error(response.error || "Message blocked by rule engine"));
              return;
            }
            
            resolve();
          } else {
            // Mark temp message as failed
            setMessages((prev) =>
              prev.map((msg) =>
                msg.clientMsgId === clientMsgId 
                  ? { ...msg, status: 'FAILED' as const }
                  : msg
              )
            );
            reject(new Error(response.error || "Failed to send message"));
          }
        }
      );
    });
  }, [userId]);

  // Send typing indicator
  const sendTyping = useCallback((isTyping: boolean) => {
    const convId = currentConvRef.current;
    if (!socketRef.current || !convId) return;
    
    socketRef.current.emit("im:typing", { convId, isTyping });
  }, []);

  // Mark message as read
  const markAsRead = useCallback((upToMsgId: string) => {
    const convId = currentConvRef.current;
    if (!socketRef.current || !convId) return;
    
    socketRef.current.emit("im:read", { convId, upToMsgId });
  }, []);

  return {
    messages,
    isTyping,
    typingUserId,
    sendMessage,
    sendTyping,
    markAsRead,
    subscribeToConversation,
    unsubscribeFromConversation,
    error,
  };
}

// ============================================================================
// Exports
// ============================================================================

export type { 
  UseSocketOptions, 
  UseSocketReturn, 
  IMEventHandlers,
  UseChatRoomSocketReturn 
};
