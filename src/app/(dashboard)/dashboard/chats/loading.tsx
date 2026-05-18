export default function ChatsLoading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] -mx-4 -mt-6 bg-background animate-pulse">
      {/* Sidebar list skeleton */}
      <div className="w-full md:w-[380px] border-r border-card-border flex flex-col">
        <div className="p-4 border-b border-card-border space-y-3">
          <div className="h-6 bg-foreground-faint rounded w-24" />
          <div className="h-10 bg-foreground-faint rounded-lg" />
          <div className="flex gap-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-7 bg-foreground-faint rounded-lg w-16" />
            ))}
          </div>
        </div>
        <div className="flex-1 divide-y divide-white/5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3">
              <div className="w-12 h-12 rounded-full bg-foreground-faint flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 bg-foreground-faint rounded w-32" />
                <div className="h-3 bg-foreground-faint rounded w-48" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Main area placeholder */}
      <div className="flex-1 hidden md:flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 rounded-full bg-foreground-faint mx-auto mb-4" />
          <div className="h-6 bg-foreground-faint rounded w-32 mx-auto" />
        </div>
      </div>
    </div>
  );
}
