import { ReactNode } from "react";
import { Inbox, Search, Heart, MessageCircle, User } from "lucide-react";

interface EmptyStateProps {
  icon?: "inbox" | "search" | "heart" | "message" | "user" | ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

const iconMap = {
  inbox: Inbox,
  search: Search,
  heart: Heart,
  message: MessageCircle,
  user: User,
};

export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  const IconComponent = typeof icon === "string" ? iconMap[icon as keyof typeof iconMap] : null;

  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${className}`}>
      {/* Icon */}
      <div className="relative mb-6">
        <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center">
          {IconComponent ? (
            <IconComponent className="w-10 h-10 text-white/30" />
          ) : (
            icon
          )}
        </div>
        {/* Glow effect */}
        <div className="absolute inset-0 rounded-full bg-primary/10 blur-xl" />
      </div>

      {/* Content */}
      <h3 className="text-xl font-semibold text-white mb-2">{title}</h3>
      {description && (
        <p className="text-white/60 max-w-sm mb-6">{description}</p>
      )}

      {/* Action */}
      {action && (
        <button
          onClick={action.onClick}
          className="btn-primary"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// Pre-configured empty states for common scenarios
export function NoMatches() {
  return (
    <EmptyState
      icon="heart"
      title="No matches yet"
      description="Complete your profile to receive personalized match recommendations."
      action={{
        label: "Complete Profile",
        onClick: () => (window.location.href = "/dashboard/profile"),
      }}
    />
  );
}

export function NoMessages() {
  return (
    <EmptyState
      icon="message"
      title="No messages yet"
      description="Start a conversation with your matches to begin connecting."
      action={{
        label: "View Matches",
        onClick: () => (window.location.href = "/dashboard/matches"),
      }}
    />
  );
}

export function NoNotifications() {
  return (
    <EmptyState
      icon="inbox"
      title="All caught up"
      description="You don't have any notifications at the moment."
    />
  );
}

export function NoSearchResults() {
  return (
    <EmptyState
      icon="search"
      title="No results found"
      description="Try adjusting your search criteria or filters."
    />
  );
}

export function NoUsers() {
  return (
    <EmptyState
      icon="user"
      title="No users found"
      description="There are no users matching your criteria."
    />
  );
}
