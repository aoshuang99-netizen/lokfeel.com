"use client";

import { useState } from "react";
import { useIMConversations, useIMMessages } from "@/hooks/useIM";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Send, MessageCircle, ChevronLeft } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function ChatPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const { conversations, isLoading } = useIMConversations();

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Conversation List */}
      <div
        className={cn(
          "w-full md:w-80 border-r bg-card flex flex-col",
          selectedConversationId && "hidden md:flex"
        )}
      >
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Messages</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <ConversationListSkeleton />
          ) : conversations.length === 0 ? (
            <EmptyConversations />
          ) : (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isSelected={conv.id === selectedConversationId}
                onClick={() => setSelectedConversationId(conv.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div
        className={cn(
          "flex-1 flex flex-col",
          !selectedConversationId && "hidden md:flex"
        )}
      >
        {selectedConversationId ? (
          <ChatArea
            conversationId={selectedConversationId}
            onBack={() => setSelectedConversationId(null)}
          />
        ) : (
          <EmptyChat />
        )}
      </div>
    </div>
  );
}

function ConversationItem({
  conversation,
  isSelected,
  onClick,
}: {
  conversation: {
    id: string;
    otherUser: { id: string; name: string; avatar?: string };
    lastMessage: { content: string; createdAt: string } | null;
    unreadCount: number;
  };
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full p-4 flex items-center gap-3 hover:bg-accent transition-colors text-left",
        isSelected && "bg-accent"
      )}
    >
      <Avatar src={conversation.otherUser.avatar} fallback={conversation.otherUser.name} className="h-12 w-12" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-medium truncate">{conversation.otherUser.name}</span>
          {conversation.lastMessage && (
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(conversation.lastMessage.createdAt), {
                addSuffix: false,
              })}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between mt-1">
          <p className="text-sm text-muted-foreground truncate">
            {conversation.lastMessage?.content || "No messages yet"}
          </p>
          {conversation.unreadCount > 0 && (
            <span className="ml-2 bg-primary text-primary-foreground text-xs rounded-full px-2 py-0.5 min-w-[1.25rem] text-center">
              {conversation.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function ChatArea({
  conversationId,
  onBack,
}: {
  conversationId: string;
  onBack: () => void;
}) {
  const { messages, isLoading, sendMessage } = useIMMessages(conversationId);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    if (!inputValue.trim()) return;
    
    setIsSending(true);
    try {
      await sendMessage(inputValue.trim());
      setInputValue("");
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="p-4 border-b flex items-center gap-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h3 className="font-semibold">Chat</h3>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto">
        {isLoading ? (
          <MessageListSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No messages yet. Start the conversation!
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Type a message..."
            disabled={isSending}
            className="flex-1"
          />
          <Button onClick={handleSend} disabled={isSending || !inputValue.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );
}

function MessageBubble({
  message,
}: {
  message: {
    id: string;
    content: string;
    createdAt: string;
    sender: { id: string; name: string; avatar?: string };
    isFromMe?: boolean;
  };
}) {
  const isMe = message.isFromMe;

  return (
    <div className={cn("flex gap-3", isMe && "flex-row-reverse")}>
      <Avatar src={message.sender.avatar} fallback={message.sender.name} className="h-8 w-8" />
      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-4 py-2",
          isMe
            ? "bg-primary text-primary-foreground rounded-br-none"
            : "bg-muted rounded-bl-none"
        )}
      >
        <p>{message.content}</p>
        <span
          className={cn(
            "text-xs mt-1 block",
            isMe ? "text-primary-foreground/70" : "text-muted-foreground"
          )}
        >
          {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}

function EmptyConversations() {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
      <MessageCircle className="h-12 w-12 mb-4 opacity-50" />
      <p>No conversations yet</p>
      <p className="text-sm">Start matching to chat with people!</p>
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
      <MessageCircle className="h-16 w-16 mb-4 opacity-50" />
      <h3 className="text-lg font-medium">Select a conversation</h3>
      <p className="text-sm">Choose someone from the list to start chatting</p>
    </div>
  );
}

function ConversationListSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MessageListSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className={cn("flex gap-3", i % 2 === 0 && "flex-row-reverse")}>
          <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
          <Skeleton className={cn("h-16 w-48 rounded-2xl", i % 2 === 0 ? "rounded-br-none" : "rounded-bl-none")} />
        </div>
      ))}
    </div>
  );
}
