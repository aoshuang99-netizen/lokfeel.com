"use client";

import { use, useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Send, MoreVertical, Phone, Video } from "lucide-react";

interface ChatRoomPageProps {
  params: Promise<{ roomId: string }>;
}

const mockMessages = [
  { id: 1, sender: "them", text: "Hey! I saw we matched and I'm really excited to chat with you!", timestamp: "10:30 AM" },
  { id: 2, sender: "me", text: "Hi Sarah! Same here. Your profile caught my attention.", timestamp: "10:32 AM" },
  { id: 3, sender: "them", text: "I love that you're into hiking! Do you have any favorite spots?", timestamp: "10:33 AM" },
  { id: 4, sender: "me", text: "Yes! I recently discovered a trail near the coast. The views are incredible. Have you been hiking much?", timestamp: "10:35 AM" },
  { id: 5, sender: "them", text: "I've been meaning to get back into it! Would you want to go sometime?", timestamp: "10:36 AM" },
  { id: 6, sender: "them", text: "That sounds amazing! I'd love to explore that coffee shop too.", timestamp: "10:38 AM" },
];

const mockUser = {
  id: "1",
  name: "Sarah",
  age: 28,
  image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop",
  isOnline: true,
};

export default function ChatRoomPage({ params }: ChatRoomPageProps) {
  const { roomId } = use(params);
  const [messages, setMessages] = useState(mockMessages);
  const [newMessage, setNewMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const message = {
      id: messages.length + 1,
      sender: "me" as const,
      text: newMessage,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, message]);
    setNewMessage("");

    // Simulate reply
    setTimeout(() => {
      setIsTyping(true);
      setTimeout(() => {
        setIsTyping(false);
        const reply = {
          id: messages.length + 2,
          sender: "them" as const,
          text: "That sounds great! Let me know when works for you.",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, reply]);
      }, 2000);
    }, 1000);
  };

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
          <Link href={`/dashboard/matches/${roomId}`} className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-full overflow-hidden">
                <img
                  src={mockUser.image}
                  alt={mockUser.name}
                  className="w-full h-full object-cover"
                />
              </div>
              {mockUser.isOnline && (
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-success border-2 border-[#0d0c11] rounded-full" />
              )}
            </div>
            <div>
              <h2 className="font-semibold text-white">{mockUser.name}, {mockUser.age}</h2>
              <p className="text-xs text-white/60">
                {mockUser.isOnline ? "Online" : "Last seen 2h ago"}
              </p>
            </div>
          </Link>
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
      <Link
        href={`/dashboard/matches/${roomId}`}
        className="glass-card p-3 flex items-center gap-3 mb-4 hover:bg-white/10 transition-colors"
      >
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
          <span className="text-white font-bold">94%</span>
        </div>
        <div>
          <p className="text-sm font-medium text-white">94% Compatibility</p>
          <p className="text-xs text-white/60">View full match details</p>
        </div>
      </Link>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.sender === "me" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                message.sender === "me"
                  ? "bg-gradient-to-r from-primary to-secondary text-white rounded-br-md"
                  : "glass-card text-white/90 rounded-bl-md"
              }`}
            >
              <p className="text-sm leading-relaxed">{message.text}</p>
              <p className={`text-[10px] mt-1 ${
                message.sender === "me" ? "text-white/60" : "text-white/40"
              }`}>
                {message.timestamp}
              </p>
            </div>
          </div>
        ))}

        {/* Typing Indicator */}
        {isTyping && (
          <div className="flex justify-start">
            <div className="glass-card rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
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
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="p-3 rounded-xl bg-gradient-to-r from-primary to-secondary text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
}
