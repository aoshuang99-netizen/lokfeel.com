/**
 * Dashboard Loading Skeleton
 * Next.js自动在路由切换时显示此骨架屏，提升FCP感知速度
 */
export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav skeleton */}
      <div className="h-16 border-b border-card-border bg-background-secondary animate-pulse" />
      
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Welcome skeleton */}
        <div className="mb-8">
          <div className="h-8 w-48 bg-background-tertiary rounded-lg animate-pulse mb-2" />
          <div className="h-4 w-64 bg-background-tertiary rounded animate-pulse" />
        </div>

        {/* Match cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-card-border bg-background-secondary p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-background-tertiary animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-24 bg-background-tertiary rounded animate-pulse" />
                  <div className="h-3 w-16 bg-background-tertiary rounded animate-pulse" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-3 w-full bg-background-tertiary rounded animate-pulse" />
                <div className="h-3 w-3/4 bg-background-tertiary rounded animate-pulse" />
              </div>
              <div className="flex gap-2">
                <div className="h-6 w-16 bg-background-tertiary rounded-full animate-pulse" />
                <div className="h-6 w-20 bg-background-tertiary rounded-full animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
