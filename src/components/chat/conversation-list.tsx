"use client";

import { memo, useState, useMemo } from "react";
import { Search, MessageCircle, Loader2, MoreVertical } from "lucide-react";
import { ConversationItem, ConversationItemProps } from "./conversation-item";

// ============================================================================
// Types
// ============================================================================

interface ConversationListProps {
  conversations: ConversationItemProps[];
  isLoading?: boolean;
  error?: string | null;
  currentRoomId?: string;
  onSelect?: (id: string) => void;
  onSearch?: (query: string) => void;
  className?: string;
}

interface EmptyStateProps {
  hasSearch?: boolean;
  searchQuery?: string;
}

// ============================================================================
// Empty State Component
// ============================================================================

function EmptyState({ hasSearch, searchQuery }: EmptyStateProps) {
  return (
    <div className="p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
        <MessageCircle className="w-8 h-8 text-white/30" />
      </div>
      <p className="text-white/60 text-sm">
        {hasSearch ? "No conversations match your search" : "No conversations yet"}
      </p>
      {!hasSearch && (
        <p className="text-white/40 text-xs mt-2">
          Accept a match to start chatting
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Header Component
// ============================================================================

interface HeaderProps {
  onNewChat?: () => void;
}

function Header({ onNewChat }: HeaderProps) {
  return (
    <div className="p-4 border-b border-white/10 bg-[#13121a]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">Messages</h2>
        <div className="flex items-center gap-2">
          {onNewChat && (
            <button
              onClick={onNewChat}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              aria-label="New chat"
            >
              <MoreVertical className="w-5 h-5 text-white/60" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Search Component
// ============================================================================

interface SearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

function SearchBar({ value, onChange, placeholder = "Search conversations..." }: SearchProps) {
  return (
    <div className="px-4 pb-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-white/5 text-white placeholder:text-white/40 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
    </div>
  );
}

// ============================================================================
// Conversation List Component
// ============================================================================

function ConversationListComponent({
  conversations,
  isLoading = false,
  error = null,
  currentRoomId,
  onSelect,
  onSearch,
  className = "",
}: ConversationListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter conversations based on search
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    
    const query = searchQuery.toLowerCase();
    return conversations.filter((conv) =>
      conv.otherUser.name.toLowerCase().includes(query)
    );
  }, [conversations, searchQuery]);

  // Handle search change
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    onSearch?.(value);
  };

  // Handle conversation click
  const handleConversationClick = (id: string) => {
    onSelect?.(id);
  };

  // Render loading state
  if (isLoading) {
    return (
      <div className={`flex flex-col h-full bg-[#0d0c11] ${className}`}>
        <Header />
        <SearchBar value={searchQuery} onChange={handleSearchChange} />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className={`flex flex-col h-full bg-[#0d0c11] ${className}`}>
        <Header />
        <SearchBar value={searchQuery} onChange={handleSearchChange} />
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-red-400 text-sm text-center">{error}</p>
        </div>
      </div>
    );
  }

  // Render empty state
  if (filteredConversations.length === 0) {
    return (
      <div className={`flex flex-col h-full bg-[#0d0c11] ${className}`}>
        <Header />
        <SearchBar value={searchQuery} onChange={handleSearchChange} />
        <EmptyState hasSearch={!!searchQuery} searchQuery={searchQuery} />
      </div>
    );
  }

  // Render conversation list
  return (
    <div className={`flex flex-col h-full bg-[#0d0c11] ${className}`}>
      <Header />
      <SearchBar value={searchQuery} onChange={handleSearchChange} />
      
      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {filteredConversations.map((conversation) => (
          <ConversationItem
            key={conversation.id}
            {...conversation}
            isSelected={currentRoomId === conversation.id}
            onClick={() => handleConversationClick(conversation.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Memoized Export
// ============================================================================

export const ConversationList = memo(ConversationListComponent);

// Re-export types
export type { ConversationListProps };
