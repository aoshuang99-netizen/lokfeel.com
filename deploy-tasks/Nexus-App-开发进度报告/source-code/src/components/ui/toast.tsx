'use client'

import * as React from 'react'
import { Toaster as HotToaster, toast as hotToast } from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react'

// ============================================================================
// Toast Provider
// ============================================================================

interface ToasterProps {
  position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
}

export function Toaster({ position = 'bottom-right' }: ToasterProps) {
  return (
    <HotToaster
      position={position}
      toastOptions={{
        duration: 4000,
        style: {
          background: 'hsl(var(--background))',
          color: 'hsl(var(--foreground))',
          border: '1px solid hsl(var(--border))',
          padding: '12px 16px',
          borderRadius: '8px',
        },
      }}
    >
      {(t) => (
        <div
          className={cn(
            'flex items-center gap-3 max-w-md',
            t.visible ? 'animate-in fade-in slide-in-from-bottom-2' : 'animate-out fade-out'
          )}
        >
          {t.type === 'success' && <CheckCircle className="h-5 w-5 text-green-500" />}
          {t.type === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
          {t.type === 'loading' && (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          )}
          {t.type === 'blank' && <Info className="h-5 w-5 text-blue-500" />}
          <div className="flex-1">{t.message as React.ReactNode}</div>
          <button
            onClick={() => hotToast.dismiss(t.id)}
            className="rounded p-1 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </HotToaster>
  )
}

// ============================================================================
// Toast API
// ============================================================================

export const toast = {
  success: (message: string) => hotToast.success(message),
  error: (message: string) => hotToast.error(message),
  loading: (message: string) => hotToast.loading(message),
  promise: <T,>(
    promise: Promise<T>,
    messages: {
      loading: string
      success: string
      error: string
    }
  ) => hotToast.promise(promise, messages),
  dismiss: (toastId?: string) => hotToast.dismiss(toastId),
  custom: (message: React.ReactNode, options?: { duration?: number; icon?: React.ReactNode }) => {
    return hotToast.custom(
      (t) => (
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg',
            t.visible ? 'animate-in fade-in slide-in-from-bottom-2' : 'animate-out fade-out'
          )}
        >
          {options?.icon}
          <div>{message}</div>
        </div>
      ),
      { duration: options?.duration || 4000 }
    )
  },
}

// ============================================================================
// Toast Hook
// ============================================================================

interface UseToastReturn {
  success: (message: string) => void
  error: (message: string) => void
  loading: (message: string) => string
  promise: <T,>(
    promise: Promise<T>,
    messages: {
      loading: string
      success: string
      error: string
    }
  ) => Promise<T>
  dismiss: (toastId?: string) => void
}

export function useToast(): UseToastReturn {
  return {
    success: toast.success,
    error: toast.error,
    loading: toast.loading,
    promise: toast.promise,
    dismiss: toast.dismiss,
  }
}
