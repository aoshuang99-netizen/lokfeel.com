import * as React from 'react'
import { cn } from '@/lib/utils'

interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'primary' | 'white'
}

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-[3px]',
}

const variantClasses = {
  default: 'border-muted-foreground/30 border-t-muted-foreground',
  primary: 'border-primary/30 border-t-primary',
  white: 'border-card-border border-t-white',
}

const Spinner = React.forwardRef<HTMLDivElement, SpinnerProps>(
  ({ className, size = 'md', variant = 'default', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'animate-spin rounded-full',
          sizeClasses[size],
          variantClasses[variant],
          className
        )}
        {...props}
      />
    )
  }
)
Spinner.displayName = 'Spinner'

interface LoadingOverlayProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode
}

const LoadingOverlay = React.forwardRef<HTMLDivElement, LoadingOverlayProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm',
          className
        )}
        {...props}
      >
        <div className="flex flex-col items-center gap-2">
          <Spinner size="lg" />
          {children && <p className="text-sm text-muted-foreground">{children}</p>}
        </div>
      </div>
    )
  }
)
LoadingOverlay.displayName = 'LoadingOverlay'

export { Spinner, LoadingOverlay }
