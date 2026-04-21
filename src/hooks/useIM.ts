"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getPusherClient } from "@/lib/pusher";

// ─── Polling Configuration ──────────────────────────────
const POLL_INTERVAL = 5000; // 5 seconds fallback polling
const ENABLE_POLLING = true; // Always enable polling as fallback

interface Message {
  id: string;
  content: string;
  type: string;
  createdAt: string;
  sender: {
    id: string;
    name: string;
    avatar?: string;
  };
  isFromMe?: boolean;
  isRead?: boolean;
}

interface Conversation {
  id: string;
  otherUser: {
    id: string;
    name: string;
    avatar?: string;
  };
  lastMessage: Message | null;
  unreadCount: number;
  updatedAt: string;
}

// ─── Conversations Hook ──────────────────────────────────

export function useIMConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/im/conversations");
      if (!res.ok) throw new Error("Failed to fetch conversations");
      const data = await res.json();
      setConversations(data.conversations);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch + polling for real-time updates
  useEffect(() => {
    fetchConversations();

    if (ENABLE_POLLING) {
      pollRef.current = setInterval(fetchConversations, POLL_INTERVAL * 3); // Poll conversations every 15s
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchConversations]);

  return { conversations, isLoading, error, refetch: fetchConversations };
}

// ─── Messages Hook ───────────────────────────────────────

export function useIMMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | undefined>();
  const pusherRef = useRef<any>(null);
  const channelRef = useRef<any>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const isPusherConnectedRef = useRef(false);

  // Fetch messages
  const fetchMessages = useCallback(
    async (reset = false) => {
      if (!conversationId) return;

      try {
        setIsLoading(true);
        const url = new URL(`/api/im/messages/${conversationId}`, window.location.origin);
        if (!reset && cursor) url.searchParams.set("cursor", cursor);
        url.searchParams.set("limit", "50");

        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch messages");

        const data = await res.json();

        if (reset) {
          setMessages(data.messages);
          // Track latest message ID for polling
          if (data.messages.length > 0) {
            lastMessageIdRef.current = data.messages[data.messages.length - 1].id;
          }
        } else {
          setMessages((prev) => [...data.messages, ...prev]);
        }

        setHasMore(!!data.nextCursor);
        setCursor(data.nextCursor);
      } catch (err) {
        console.error("[useIM] Fetch messages error:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [conversationId, cursor]
  );

  // Poll for new messages (fallback when Pusher is not available)
  const pollForNewMessages = useCallback(async () => {
    if (!conversationId) return;

    try {
      const url = new URL(`/api/im/messages/${conversationId}`, window.location.origin);
      url.searchParams.set("limit", "10");
      url.searchParams.set("after", lastMessageIdRef.current || "");

      const res = await fetch(url);
      if (!res.ok) return;

      const data = await res.json();
      const newMessages = data.messages || [];

      if (newMessages.length > 0) {
        setMessages((prev) => {
          // Deduplicate by ID
          const existingIds = new Set(prev.map(m => m.id));
          const unique = newMessages.filter((m: Message) => !existingIds.has(m.id));
          if (unique.length > 0) {
            lastMessageIdRef.current = unique[unique.length - 1].id;
            return [...prev, ...unique];
          }
          return prev;
        });
      }
    } catch (err) {
      // Silent fail for polling
    }
  }, [conversationId]);

  // Subscribe to real-time messages (Pusher + polling fallback)
  useEffect(() => {
    if (!conversationId) return;

    // Initial fetch
    fetchMessages(true);

    // Try Pusher first
    const pusher = getPusherClient();
    if (pusher) {
      pusherRef.current = pusher;

      // Subscribe to Pusher channel (IM v2 naming convention)
      const channelName = `private-im-conv-${conversationId}`;
      try {
        const channel = pusher.subscribe(channelName);
        channelRef.current = channel;

        channel.bind("im:message", (data: { message: any }) => {
          const message = data.message;
          const newMsg: Message = {
            id: message.msgId || message.id,
            content: message.payload || message.content,
            type: message.msgType || message.type || "TEXT",
            createdAt: new Date(message.timestamp || message.createdAt).toISOString(),
            sender: message.sender || { id: message.senderId, name: "Unknown" },
          };
          lastMessageIdRef.current = newMsg.id;
          setMessages((prev) => [...prev, newMsg]);
        });

        isPusherConnectedRef.current = true;
        console.log("[useIM] Pusher connected for conversation:", conversationId);
      } catch (err) {
        console.warn("[useIM] Pusher subscription failed, using polling fallback:", err);
        isPusherConnectedRef.current = false;
      }
    } else {
      console.log("[useIM] Pusher not available, using polling fallback");
      isPusherConnectedRef.current = false;
    }

    // Always start polling as fallback (or supplementary to Pusher)
    if (ENABLE_POLLING) {
      pollRef.current = setInterval(pollForNewMessages, POLL_INTERVAL);
    }

    return () => {
      // Cleanup Pusher
      if (channelRef.current) {
        try {
          channelRef.current.unbind_all();
          if (pusherRef.current) {
            pusherRef.current.unsubscribe(`private-im-conv-${conversationId}`);
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      // Cleanup polling
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [conversationId, fetchMessages, pollForNewMessages]);

  // Send message
  const sendMessage = useCallback(
    async (content: string, type = "TEXT") => {
      if (!conversationId) return;

      const res = await fetch("/api/im/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, content, type }),
      });

      if (!res.ok) throw new Error("Failed to send message");
      const data = await res.json();

      // Add sent message to local state immediately
      if (data.success && data.message) {
        const sentMsg: Message = {
          id: data.message.id,
          content: data.message.content,
          type: data.message.type,
          createdAt: data.message.createdAt,
          sender: data.message.sender,
          isFromMe: true,
        };
        lastMessageIdRef.current = sentMsg.id;
        setMessages((prev) => {
          const existingIds = new Set(prev.map(m => m.id));
          if (!existingIds.has(sentMsg.id)) {
            return [...prev, sentMsg];
          }
          return prev;
        });
      }

      return data;
    },
    [conversationId]
  );

  // Mark messages as read
  const markAsRead = useCallback(
    async (messageIds: string[]) => {
      if (!conversationId || messageIds.length === 0) return;

      await fetch("/api/im/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, messageIds }),
      });
    },
    [conversationId]
  );

  return {
    messages,
    isLoading,
    hasMore,
    fetchMore: () => fetchMessages(false),
    sendMessage,
    markAsRead,
  };
}

// ─── Presence Hook ───────────────────────────────────────

export function useIMPresence(userId: string | null) {
  const [isOnline, setIsOnline] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    const pusher = getPusherClient();
    if (!pusher) {
      // Without Pusher, assume online when on the page
      setIsOnline(true);
      return;
    }

    const channel = pusher.subscribe(`private-im-user-${userId}`);

    channel.bind("presence-update", (data: { status: string; lastSeen?: string }) => {
      setIsOnline(data.status === "ONLINE");
      if (data.lastSeen) setLastSeen(data.lastSeen);
    });

    return () => {
      channel.unbind_all();
      pusher.unsubscribe(`private-im-user-${userId}`);
    };
  }, [userId]);

  return { isOnline, lastSeen };
}
