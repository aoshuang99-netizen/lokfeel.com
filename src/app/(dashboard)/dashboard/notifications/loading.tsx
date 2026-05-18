export default function NotificationsLoading() {
  return (
    <div className="space-y-4 animate-pulse max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="h-7 bg-foreground-faint rounded w-28" />
        <div className="h-4 bg-foreground-faint rounded w-16" />
      </div>
      {/* Notification items */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 p-4 rounded-xl bg-foreground-faint/10"
        >
          <div className="w-10 h-10 rounded-full bg-foreground-faint flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-4 bg-foreground-faint rounded w-3/4" />
            <div className="h-3 bg-foreground-faint rounded w-full" />
            <div className="h-3 bg-foreground-faint rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
