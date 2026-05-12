"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Pusher, { Channel } from "pusher-js";
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
  SystemNotification,
} from "@/lib/im/types";

// ============================================================================
// Pusher Configuration
// ============================================================================

const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY || "";
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "us2";
const USE_PUSHER = process.env.NEXT_PUBLIC_USE_PUSHER === "true";

// ============================================================================
// Channel Naming
// ============================================================================

const CHANNEL_PREFIX = "private-im";

function userChannel(userId: string): string {
  return `${CHANNEL_PREFIX}-user-${userId}`;
}

function conversationChannel(convId: string): string {
  return `${CHANNEL_PREFIX}-conv-${convId}`;
}

// ============================================================================
// Pusher Client Singleton
// ============================================================================

let pusherClient: Pusher | null = null;

export function getIMPusherClient(): Pusher | null {
  if (typeof window === "undefined") return null;

  if (!USE_PUSHER) {
    console.log("[IM Pusher] Disabled via NEXT_PUBLIC_USE_PUSHER");
    return null;
  }

  if (!pusherClient && PUSHER_KEY) {
    pusherClient = new Pusher(PUSHER_KEY, {
      cluster: PUSHER_CLUSTER,
      authEndpoint: "/api/im/pusher/auth",
      auth: {
        headers: {
          "Content-Type": "application/json",
        },
      },
    });

    pusherClient.connection.bind("connected", () => {
      console.log("[IM Pusher] Connected");
    });

    pusherClient.connection.bind("disconnected", () => {
      console.log("[IM Pusher] Disconnected");
    });

    pusherClient.connection.bind("error", (err: Error) => {
      console.error("[IM Pusher] Error:", err);
    });
  }

  return pusherClient;
}

export function disconnectIMPusher(): void {
  if (pusherClient) {
    pusherClient.disconnect();
    pusherClient = null;
  }
}

// ============================================================================
// Types
// ============================================================================

export interface IMEventHandlers {
  onMessage?: (message: IMMessagePayload) => void;
  onTyping?: (data: TypingIndicator) => void;
  onReadReceipt?: (data: ReadReceiptPayload) => void;
  onConversationUpdate?: (data: ConversationUpdatePayload) => void;
  onPaceLimit?: (data: PaceLimitNotification) => void;
  onConsentRequest?: (data: ConsentRequestPayload) => void;
  onConsentResponse?: (data: ConsentResponsePayload) => void;
  onRuleUpdate?: (data: PowerBoardRulesPayload) => void;
  onMessageStatus?: (data: MessageStatusUpdate) => void;
  onSystem?: (data: SystemNotification) => void;
  onError?: (error: Error) => void;
}

interface UseIMPusherReturn extends IMEventHandlers {
  pusher: Pusher | null;
  isConnected: boolean;
  error: Error | null;
}

interface UseIMConversationReturn {
  messages: IMMessagePayload[];
  isTyping: boolean;
  typingUserId: string | null;
  sendMessage: (content: string, msgType?: "TEXT" | "IMAGE" | "VOICE") => Promise<void>;
  sendTyping: (isTyping: boolean) => void;
  markAsRead: (upToMsgId: string) => void;
  subscribeToConversation: (convId: string) => void;
  unsubscribeFromConversation: () => void;
  error: Error | null;
}

// ============================================================================
// IM Event Names (Pusher)
// ============================================================================

const IM_EVENTS = {
  MESSAGE: "im:message",
  MESSAGE_STATUS: "im:message_status",
  TYPING: "im:typing",
  READ_RECEIPT: "im:read_receipt",
  CONVERSATION_UPDATE: "im:conversation_update",
  PACE_LIMIT: "im:pace_limit",
  CONSENT_REQUEST: "im:consent_request",
  CONSENT_RESPONSE: "im:consent_response",
  RULE_UPDATE: "im:rule_update",
  SYSTEM: "im:system",
} as const;

// ============================================================================
// useIMPusher Hook
// ============================================================================

export function useIMPusher(userId?: string | null): UseIMPusherReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const pusherRef = useRef<Pusher | null>(null);
  const userChannelRef = useRef<Channel | null>(null);
  const handlersRef = useRef<IMEventHandlers>({});

  // Initialize Pusher client
  useEffect(() => {
    if (!userId) return;

    const pusher = getIMPusherClient();
    if (!pusher) {
      setError(new Error("Pusher not available (disabled or not configured)"));
      return;
    }

    pusherRef.current = pusher;

    // Subscribe to user channel
    const channel = pusher.subscribe(userChannel(userId));
    userChannelRef.current = channel;

    // Bind to all IM events
    channel.bind(IM_EVENTS.MESSAGE, (data: { message: IMMessagePayload }) => {
      console.log("[IM Pusher] Message:", data.message);
      handlersRef.current.onMessage?.(data.message);
    });

    channel.bind(IM_EVENTS.MESSAGE_STATUS, (data: MessageStatusUpdate) => {
      console.log("[IM Pusher] Message status:", data);
      handlersRef.current.onMessageStatus?.(data);
    });

    channel.bind(IM_EVENTS.TYPING, (data: TypingIndicator) => {
      console.log("[IM Pusher] Typing:", data);
      handlersRef.current.onTyping?.(data);
    });

    channel.bind(IM_EVENTS.READ_RECEIPT, (data: ReadReceiptPayload) => {
      console.log("[IM Pusher] Read receipt:", data);
      handlersRef.current.onReadReceipt?.(data);
    });

    channel.bind(IM_EVENTS.CONVERSATION_UPDATE, (data: ConversationUpdatePayload) => {
      console.log("[IM Pusher] Conversation update:", data);
      handlersRef.current.onConversationUpdate?.(data);
    });

    channel.bind(IM_EVENTS.PACE_LIMIT, (data: PaceLimitNotification) => {
      console.log("[IM Pusher] Pace limit:", data);
      handlersRef.current.onPaceLimit?.(data);
    });

    channel.bind(IM_EVENTS.CONSENT_REQUEST, (data: ConsentRequestPayload) => {
      console.log("[IM Pusher] Consent request:", data);
      handlersRef.current.onConsentRequest?.(data);
    });

    channel.bind(IM_EVENTS.CONSENT_RESPONSE, (data: ConsentResponsePayload) => {
      console.log("[IM Pusher] Consent response:", data);
      handlersRef.current.onConsentResponse?.(data);
    });

    channel.bind(IM_EVENTS.RULE_UPDATE, (data: PowerBoardRulesPayload) => {
      console.log("[IM Pusher] Rule update:", data);
      handlersRef.current.onRuleUpdate?.(data);
    });

    channel.bind(IM_EVENTS.SYSTEM, (data: SystemNotification) => {
      console.log("[IM Pusher] System:", data);
      handlersRef.current.onSystem?.(data);
    });

    // Connection state
    const connectionState = pusher.connection.state;
    setIsConnected(connectionState === "connected");

    pusher.connection.bind("connected", () => setIsConnected(true));
    pusher.connection.bind("disconnected", () => setIsConnected(false));
    pusher.connection.bind("error", (err: Error) => {
      setError(err);
      handlersRef.current.onError?.(err);
    });

    // Cleanup
    return () => {
      channel.unbind_all();
      pusher.unsubscribe(userChannel(userId));
      userChannelRef.current = null;
    };
  }, [userId]);

  return {
    pusher: pusherRef.current,
    isConnected,
    error,
    ...handlersRef.current,
  };
}

// ============================================================================
// useIMConversation Hook
// ============================================================================

export function useIMConversation(
  conversationId: string | null,
  userId?: string | null
): UseIMConversationReturn {
  const [messages, setMessages] = useState<IMMessagePayload[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const convChannelRef = useRef<Channel | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentConvRef = useRef<string | null>(null);
  const handlersRef = useRef<Partial<IMEventHandlers>>({});

  // Subscribe to conversation
  const subscribeToConversation = useCallback(
    (convId: string) => {
      if (!userId) return;

      const pusher = getIMPusherClient();
      if (!pusher) {
        console.warn("[IM Conversation] Pusher not available");
        return;
      }

      // Unsubscribe from previous conversation
      if (currentConvRef.current && currentConvRef.current !== convId) {
        unsubscribeFromConversation();
      }

      console.log("[IM Conversation] Subscribing to:", convId);
      currentConvRef.current = convId;

      const channel = pusher.subscribe(conversationChannel(convId));
      convChannelRef.current = channel;

      // Bind to message events
      channel.bind(IM_EVENTS.MESSAGE, (data: { message: IMMessagePayload }) => {
        console.log("[IM Conversation] New message:", data.message);
        setMessages((prev) => {
          // P1-2: Deduplicate by message ID or clientMsgId
          // Prevents duplicate messages when optimistic update and Pusher push overlap
          const incomingMsgId = data.message.msgId;
          const incomingClientMsgId = data.message.clientMsgId;

          // Check if message already exists (by server ID)
          const existingByMsgId = prev.find(m => m.msgId === incomingMsgId);
          if (existingByMsgId) {
            // Update existing message with server data (e.g., replace optimistic temp)
            return prev.map(m =>
              m.msgId === incomingMsgId ? data.message : m
            );
          }

          // Check if message already exists (by clientMsgId — optimistic update match)
          if (incomingClientMsgId) {
            const existingByClientId = prev.find(m => m.clientMsgId === incomingClientMsgId);
            if (existingByClientId) {
              // Replace optimistic message with real server message
              return prev.map(m =>
                m.clientMsgId === incomingClientMsgId ? data.message : m
              );
            }
          }

          // Truly new message — append
          return [...prev, data.message];
        });
        handlersRef.current.onMessage?.(data.message);
      });

      channel.bind(IM_EVENTS.TYPING, (data: TypingIndicator) => {
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
        handlersRef.current.onTyping?.(data);
      });

      channel.bind(IM_EVENTS.READ_RECEIPT, (data: ReadReceiptPayload) => {
        console.log("[IM Conversation] Read receipt:", data);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.msgId === data.upToMsgId || msg.seq <= data.upToSeq
              ? { ...msg, status: "READ" }
              : msg
          )
        );
        handlersRef.current.onReadReceipt?.(data);
      });

      channel.bind(IM_EVENTS.MESSAGE_STATUS, (data: MessageStatusUpdate) => {
        console.log("[IM Conversation] Message status:", data);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.msgId === data.msgId ? { ...msg, status: data.status } : msg
          )
        );
        handlersRef.current.onMessageStatus?.(data);
      });
    },
    [userId]
  );

  // Unsubscribe from conversation
  const unsubscribeFromConversation = useCallback(() => {
    const convId = currentConvRef.current;
    if (!convId) return;

    console.log("[IM Conversation] Unsubscribing from:", convId);

    if (convChannelRef.current) {
      convChannelRef.current.unbind_all();
      const pusher = getIMPusherClient();
      if (pusher) {
        pusher.unsubscribe(conversationChannel(convId));
      }
      convChannelRef.current = null;
    }

    // Clear state
    setMessages([]);
    setIsTyping(false);
    setTypingUserId(null);
    currentConvRef.current = null;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, []);

  // Auto-subscribe when conversationId changes
  useEffect(() => {
    if (conversationId) {
      subscribeToConversation(conversationId);
    }

    return () => {
      unsubscribeFromConversation();
    };
  }, [conversationId, subscribeToConversation, unsubscribeFromConversation]);

  // Cleanup typing timeout
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // Send message via REST API
  const sendMessage = useCallback(
    async (
      content: string,
      msgType: "TEXT" | "IMAGE" | "VOICE" = "TEXT"
    ): Promise<void> => {
      const convId = conversationId;
      if (!convId || !content.trim()) {
        throw new Error("Cannot send message: no conversation or empty content");
      }

      // Generate client message ID
      const clientMsgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // Optimistic update
      const tempMessage: IMMessagePayload = {
        msgId: clientMsgId,
        clientMsgId,
        senderId: userId || "me",
        receiverId: "",
        convId,
        seq: 0,
        msgType,
        payload: content,
        encryptionMode: "SERVER",
        complianceTags: [],
        consentState: "CONSENT_NONE",
        mediaLevel: msgType === "TEXT" ? "L0_TEXT" : msgType === "IMAGE" ? "L1_IMAGE" : "L2_VOICE",
        ruleResult: "PASS",
        isEdited: false,
        isDeleted: false,
        status: "SENDING",
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, tempMessage]);

      try {
        const response = await fetch("/api/im/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: convId,
            content,
            msgType,
            clientMsgId,
          }),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          // Mark as failed
          setMessages((prev) =>
            prev.map((msg) =>
              msg.clientMsgId === clientMsgId
                ? { ...msg, status: "FAILED" as const }
                : msg
            )
          );
          throw new Error(data.error || "Failed to send message");
        }

        // Replace temp message with real one
        if (data.message) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.clientMsgId === clientMsgId ? data.message : msg
            )
          );
        }
      } catch (err) {
        console.error("[IM Conversation] Send error:", err);
        throw err;
      }
    },
    [conversationId, userId]
  );

  // Send typing indicator via REST API
  const sendTyping = useCallback(
    (isTyping: boolean) => {
      const convId = conversationId;
      if (!convId) return;

      fetch("/api/im/typing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, isTyping }),
      }).catch(console.error);
    },
    [conversationId]
  );

  // Mark messages as read via REST API
  const markAsRead = useCallback(
    (upToMsgId: string) => {
      const convId = conversationId;
      if (!convId) return;

      fetch("/api/im/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, upToMsgId }),
      }).catch(console.error);
    },
    [conversationId]
  );

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

export type { UseIMPusherReturn, UseIMConversationReturn };
// IMEventHandlers is already exported as an interface above
