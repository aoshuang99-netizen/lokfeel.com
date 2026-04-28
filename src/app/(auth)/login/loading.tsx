/**
 * Login Loading Skeleton
 * 减少登录页空白闪烁
 */
export default function LoginLoading() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-md mx-auto px-6 space-y-8">
        {/* Logo skeleton */}
        <div className="text-center space-y-3">
          <div className="h-10 w-32 mx-auto bg-background-tertiary rounded-lg animate-pulse" />
          <div className="h-4 w-48 mx-auto bg-background-tertiary rounded animate-pulse" />
        </div>
        
        {/* Form skeleton */}
        <div className="space-y-4">
          <div className="h-12 w-full bg-background-tertiary rounded-xl animate-pulse" />
          <div className="h-12 w-full bg-background-tertiary rounded-xl animate-pulse" />
          <div className="h-12 w-full bg-primary/20 rounded-xl animate-pulse" />
        </div>

        {/* Divider skeleton */}
        <div className="h-4 w-48 mx-auto bg-background-tertiary rounded animate-pulse" />
      </div>
    </div>
  );
}
