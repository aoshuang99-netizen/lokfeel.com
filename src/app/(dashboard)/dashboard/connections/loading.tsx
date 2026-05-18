export default function ConnectionsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-7 bg-foreground-faint rounded w-32" />
          <div className="h-4 bg-foreground-faint rounded w-48" />
        </div>
      </div>
      {/* Grid of connection cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl bg-foreground-faint/20 border border-card-border overflow-hidden">
            <div className="aspect-[3/4] bg-foreground-faint" />
            <div className="p-3 space-y-2">
              <div className="h-4 bg-foreground-faint rounded w-3/4" />
              <div className="h-3 bg-foreground-faint rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
