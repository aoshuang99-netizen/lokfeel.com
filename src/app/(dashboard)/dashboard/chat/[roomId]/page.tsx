"use client";

import { use, useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Send, MoreVertical, Phone, Video, Loader2, Shield } from "lucide-react";
import { toast } from "sonner";

interface ChatRoomPageProps {
  params: Promise<{ roomId: string }>;
}

interface Message {
  id: string;
  content: string;
  messageType: string;
  sender: {
    id: string;
    name: string;
    avatar: string | null;
    isSelf: boolean;
  };
  isRead: boolean;
  createdAt: string;
}

interface ChatRoomInfo {
  id: string;
  otherUser: {
    id: string;
    name: string;
    age: number | null;
    avatar: string | null;
    isOnline?: boolean;
  };
  matchScore: number;
}

export default function ChatRoomPage({ params }: ChatRoomPageProps) {
  const { roomId } = use(params);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [roomInfo, setRoomInfo] = useState<ChatRoomInfo | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Load messages
  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/${roomId}/messages`);
      if (!res.ok) throw new Error("Failed to load messages");
      const data = await res.json();
      setMessages(data.messages);
    } catch (error) {
      console.error("Load messages error:", error);
    }
  }, [roomId]);

  // Load room info
  useEffect(() => {
    async function loadRoomInfo() {
      try {
        // Get chat rooms list to find this room's info
        const res = await fetch("/api/chat");
        if (!res.ok) throw new Error("Failed to load chat info");
        const data = await res.json();
        const room = data.rooms.find((r: ChatRoomInfo) => r.id === roomId);
        if (room) {
          setRoomInfo(room);
        }
      } catch (error) {
        console.error("Load room info error:", error);
      }
    }
    loadRoomInfo();
  }, [roomId]);

  // Initial load and polling
  useEffect(() => {
    async function init() {
      setIsLoading(true);
      await loadMessages();
      setIsLoading(false);
      scrollToBottom();
    }
    init();

    // Poll for new messages every 3 seconds
    pollIntervalRef.current = setInterval(loadMessages, 3000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [loadMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isSending) return;

    setIsSending(true);
    const tempMessage = newMessage.trim();
    setNewMessage("");

    // Optimistically add message
    const optimisticMessage: Message = {
      id: `temp-${Date.now()}`,
      content: tempMessage,
      messageType: "TEXT",
      sender: {
        id: "me",
        name: "You",
        avatar: null,
        isSelf: true,
      },
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const res = await fetch(`/api/chat/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: tempMessage }),
      });

      if (!res.ok) throw new Error("Failed to send message");

      const data = await res.json();
      
      // Replace optimistic message with real one
      setMessages((prev) =>
        prev.map((msg) => (msg.id === optimisticMessage.id ? data.message : msg))
      );
    } catch (error) {
      console.error("Send error:", error);
      toast.error("Failed to send message");
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((msg) => msg.id !== optimisticMessage.id));
      setNewMessage(tempMessage); // Restore text
    } finally {
      setIsSending(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  // Group messages by date
  const groupedMessages = messages.reduce((groups: Record<string, Message[]>, message) => {
    const date = formatDate(message.createdAt);
    if (!groups[date]) groups[date] = [];
    groups[date].push(message);
    return groups;
  }, {});

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-8rem)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="glass-card p-4 flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/chat"
            className="p-2 -ml-2 text-white/60 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          {roomInfo && (
            <Link href={`/dashboard/matches/${roomInfo.id}`} className="flex items-center gap-3">
              <div className="relative">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-white/10">
                  <img
                    src={roomInfo.otherUser.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${roomInfo.otherUser.id}`}
                    alt={roomInfo.otherUser.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                {roomInfo.otherUser.isOnline && (
                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-success border-2 border-[#0d0c11] rounded-full" />
                )}
              </div>
              <div>
                <h2 className="font-semibold text-white">
                  {roomInfo.otherUser.name}
                  {roomInfo.otherUser.age && `, ${roomInfo.otherUser.age}`}
                </h2>
                <p className="text-xs text-white/60">
                  {roomInfo.otherUser.isOnline ? "Online" : "Offline"}
                </p>
              </div>
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button className="p-2 rounded-lg hover:bg-white/5 transition-colors text-white/60 hover:text-white">
            <Phone className="w-5 h-5" />
          </button>
          <button className="p-2 rounded-lg hover:bg-white/5 transition-colors text-white/60 hover:text-white">
            <Video className="w-5 h-5" />
          </button>
          <button className="p-2 rounded-lg hover:bg-white/5 transition-colors text-white/60 hover:text-white">
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Match Info Banner */}
      {roomInfo && (
        <Link
          href={`/dashboard/matches`}
          className="glass-card p-3 flex items-center gap-3 mb-4 hover:bg-white/10 transition-colors"
        >
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
            <span className="text-white font-bold">{Math.round(roomInfo.matchScore)}%</span>
          </div>
          <div>
            <p className="text-sm font-medium text-white">{Math.round(roomInfo.matchScore)}% Compatibility</p>
            <p className="text-xs text-white/60">Based on your relationship blueprints</p>
          </div>
          <Shield className="w-5 h-5 text-success ml-auto" />
        </Link>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2">
        {messages.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
              <Send className="w-8 h-8 text-white/40" />
            </div>
            <p className="text-white/60">No messages yet</p>
            <p className="text-sm text-white/40 mt-1">Start the conversation!</p>
          </div>
        ) : (
          Object.entries(groupedMessages).map(([date, dateMessages]) => (
            <div key={date}>
              {/* Date Separator */}
              <div className="flex items-center justify-center my-4">
                <span className="text-xs text-white/40 px-3 py-1 rounded-full bg-white/5">
                  {date}
                </span>
              </div>

              {dateMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.sender.isSelf ? "justify-end" : "justify-start"} mb-4`}
                >
                  {!message.sender.isSelf && (
                    <div className="w-8 h-8 rounded-full overflow-hidden mr-2 flex-shrink-0">
                      <img
                        src={message.sender.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${message.sender.id}`}
                        alt={message.sender.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                      message.sender.isSelf
                        ? "bg-gradient-to-r from-primary to-secondary text-white rounded-br-md"
                        : "glass-card text-white/90 rounded-bl-md"
                    }`}
                  >
                    {message.messageType === "SYSTEM" ? (
                      <p className="text-sm italic text-white/70">{message.content}</p>
                    ) : (
                      <>
                        <p className="text-sm leading-relaxed">{message.content}</p>
                        <p className={`text-[10px] mt-1 ${
                          message.sender.isSelf ? "text-white/60" : "text-white/40"
                        }`}>
                          {formatTime(message.createdAt)}
                          {message.sender.isSelf && message.isRead && (
                            <span className="ml-1">✓✓</span>
                          )}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="mt-4">
        <div className="glass-card p-3 flex items-center gap-3">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-transparent text-white placeholder:text-white/40 outline-none"
            disabled={isSending}
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || isSending}
            className="p-3 rounded-xl bg-gradient-to-r from-primary to-secondary text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {isSending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
