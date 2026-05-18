export default function SettingsLoading() {
  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-pulse">
      {/* Header */}
      <div className="h-7 bg-foreground-faint rounded w-24" />
      {/* Settings sections */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-foreground-faint/10 p-5 space-y-4">
          <div className="h-5 bg-foreground-faint rounded w-32" />
          <div className="space-y-3">
            <div className="h-12 bg-foreground-faint rounded-xl" />
            <div className="h-12 bg-foreground-faint rounded-xl" />
            <div className="h-20 bg-foreground-faint rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}
