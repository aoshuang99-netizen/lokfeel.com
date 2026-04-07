'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Pusher from 'pusher-js'
import type { ChatMessageWithSender, NotificationPayload } from '@/types'

// ============================================================================
// Pusher Configuration
// ============================================================================

const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY || ''
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2'

// ============================================================================
// Pusher Client Singleton
// ============================================================================

let pusherClient: Pusher | null = null

/**
 * Get or create the Pusher client singleton
 */
export function getPusherClient(): Pusher | null {
  if (typeof window === 'undefined') return null
  
  if (!pusherClient && PUSHER_KEY) {
    pusherClient = new Pusher(PUSHER_KEY, {
      cluster: PUSHER_CLUSTER,
      authEndpoint: '/api/pusher/auth',
      auth: {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    })
  }
  
  return pusherClient
}

/**
 * Disconnect the Pusher client
 */
export function disconnectPusher(): void {
  if (pusherClient) {
    pusherClient.disconnect()
    pusherClient = null
  }
}

// ============================================================================
// usePusher Hook
// ============================================================================

interface UsePusherReturn {
  pusher: Pusher | null
  isConnected: boolean
  error: Error | null
}

/**
 * Hook to access the Pusher client
 */
export function usePusher(): UsePusherReturn {
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const pusher = useRef<Pusher | null>(null)
  
  useEffect(() => {
    try {
      pusher.current = getPusherClient()
      
      if (pusher.current) {
        pusher.current.connection.bind('connected', () => {
          setIsConnected(true)
        })
        
        pusher.current.connection.bind('disconnected', () => {
          setIsConnected(false)
        })
        
        pusher.current.connection.bind('error', (err: Error) => {
          setError(err)
        })
        
        // Check initial state
        setIsConnected(pusher.current.connection.state === 'connected')
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to initialize Pusher'))
    }
    
    return () => {
      // Don't disconnect on unmount - singleton pattern
    }
  }, [])
  
  return {
    pusher: pusher.current,
    isConnected,
    error,
  }
}

// ============================================================================
// useChatRoom Hook
// ============================================================================

interface UseChatRoomReturn {
  messages: ChatMessageWithSender[]
  isTyping: boolean
  sendMessage: (content: string) => void
  sendTyping: () => void
  markAsRead: (messageId: string) => void
  error: Error | null
}

/**
 * Hook to subscribe to a chat room
 */
export function useChatRoom(
  roomId: string | null,
  userId: string
): UseChatRoomReturn {
  const [messages, setMessages] = useState<ChatMessageWithSender[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const channelRef = useRef<ReturnType<Pusher['subscribe']> | null>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Subscribe to channel
  useEffect(() => {
    if (!roomId) return
    
    const pusher = getPusherClient()
    if (!pusher) {
      setError(new Error('Pusher not initialized'))
      return
    }
    
    try {
      const channel = pusher.subscribe(`private-chat-${roomId}`)
      channelRef.current = channel
      
      // Listen for new messages
      channel.bind('message', (data: { message: ChatMessageWithSender }) => {
        setMessages(prev => [...prev, data.message])
      })
      
      // Listen for typing indicators
      channel.bind('typing', (data: { userId: string }) => {
        if (data.userId !== userId) {
          setIsTyping(true)
          
          // Clear typing indicator after 3 seconds
          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current)
          }
          typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false)
          }, 3000)
        }
      })
      
      // Listen for read receipts
      channel.bind('read', (data: { messageId: string; userId: string }) => {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === data.messageId
              ? { ...msg, isRead: true, readAt: new Date() }
              : msg
          )
        )
      })
      
      return () => {
        channel.unbind_all()
        pusher.unsubscribe(`private-chat-${roomId}`)
        channelRef.current = null
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to subscribe to chat room'))
    }
  }, [roomId, userId])
  
  // Send message
  const sendMessage = useCallback(async (content: string) => {
    if (!roomId || !content.trim()) return
    
    try {
      const response = await fetch(`/api/chat/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      
      if (!response.ok) {
        throw new Error('Failed to send message')
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to send message'))
    }
  }, [roomId])
  
  // Send typing indicator
  const sendTyping = useCallback(() => {
    if (!roomId || !channelRef.current) return
    
    channelRef.current.trigger('client-typing', { userId })
  }, [roomId, userId])
  
  // Mark message as read
  const markAsRead = useCallback(async (messageId: string) => {
    if (!roomId) return
    
    try {
      await fetch(`/api/chat/${roomId}/messages/${messageId}/read`, {
        method: 'POST',
      })
    } catch (err) {
      console.error('Failed to mark message as read:', err)
    }
  }, [roomId])
  
  return {
    messages,
    isTyping,
    sendMessage,
    sendTyping,
    markAsRead,
    error,
  }
}

// ============================================================================
// useNotifications Hook
// ============================================================================

interface UseNotificationsReturn {
  notifications: NotificationPayload[]
  unreadCount: number
  markAsRead: (notificationId: string) => void
  markAllAsRead: () => void
  error: Error | null
}

/**
 * Hook to subscribe to real-time notifications
 */
export function useNotifications(userId: string | null): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<NotificationPayload[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [error, setError] = useState<Error | null>(null)
  
  useEffect(() => {
    if (!userId) return
    
    const pusher = getPusherClient()
    if (!pusher) {
      setError(new Error('Pusher not initialized'))
      return
    }
    
    try {
      const channel = pusher.subscribe(`private-user-${userId}`)
      
      // Listen for new notifications
      channel.bind('notification', (data: NotificationPayload) => {
        setNotifications(prev => [data, ...prev])
        setUnreadCount(prev => prev + 1)
        
        // Show browser notification if permitted
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(data.title, {
            body: data.body,
            icon: '/icon.png',
          })
        }
      })
      
      // Listen for unread count updates
      channel.bind('unread-count', (data: { count: number }) => {
        setUnreadCount(data.count)
      })
      
      // Fetch initial unread count
      fetchUnreadCount()
      
      return () => {
        channel.unbind_all()
        pusher.unsubscribe(`private-user-${userId}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to subscribe to notifications'))
    }
  }, [userId])
  
  // Fetch unread count
  const fetchUnreadCount = async () => {
    if (!userId) return
    
    try {
      const response = await fetch('/api/notifications/unread-count')
      if (response.ok) {
        const data = await response.json()
        setUnreadCount(data.count)
      }
    } catch (err) {
      console.error('Failed to fetch unread count:', err)
    }
  }
  
  // Mark notification as read
  const markAsRead = useCallback(async (notificationId: string) => {
    if (!userId) return
    
    try {
      const response = await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'POST',
      })
      
      if (response.ok) {
        setNotifications(prev =>
          prev.filter(n => (n.data as { notificationId?: string })?.notificationId !== notificationId)
        )
        setUnreadCount(prev => Math.max(0, prev - 1))
      }
    } catch (err) {
      console.error('Failed to mark notification as read:', err)
    }
  }, [userId])
  
  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    if (!userId) return
    
    try {
      const response = await fetch('/api/notifications/read-all', {
        method: 'POST',
      })
      
      if (response.ok) {
        setNotifications([])
        setUnreadCount(0)
      }
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err)
    }
  }, [userId])
  
  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    error,
  }
}

// ============================================================================
// usePresence Hook
// ============================================================================

interface PresenceMember {
  userId: string
  name: string
  image?: string
}

interface UsePresenceReturn {
  onlineUsers: PresenceMember[]
  isOnline: boolean
  error: Error | null
}

/**
 * Hook to track online presence
 */
export function usePresence(userId: string | null): UsePresenceReturn {
  const [onlineUsers, setOnlineUsers] = useState<PresenceMember[]>([])
  const [isOnline, setIsOnline] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  
  useEffect(() => {
    if (!userId) return
    
    const pusher = getPusherClient()
    if (!pusher) {
      setError(new Error('Pusher not initialized'))
      return
    }
    
    try {
      const channel = pusher.subscribe('presence-app')
      
      channel.bind('pusher:subscription_succeeded', (members: { members: Record<string, PresenceMember> }) => {
        setOnlineUsers(Object.values(members.members))
        setIsOnline(true)
      })
      
      channel.bind('pusher:member_added', (member: { info: PresenceMember }) => {
        setOnlineUsers(prev => [...prev, member.info])
      })
      
      channel.bind('pusher:member_removed', (member: { info: PresenceMember }) => {
        setOnlineUsers(prev => prev.filter(u => u.userId !== member.info.userId))
      })
      
      return () => {
        channel.unbind_all()
        pusher.unsubscribe('presence-app')
        setIsOnline(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to subscribe to presence'))
    }
  }, [userId])
  
  return {
    onlineUsers,
    isOnline,
    error,
  }
}

// ============================================================================
// useMatchUpdates Hook
// ============================================================================

interface MatchUpdate {
  type: 'created' | 'accepted' | 'declined' | 'expired' | 'message'
  matchId: string
  data?: Record<string, unknown>
}

interface UseMatchUpdatesReturn {
  updates: MatchUpdate[]
  error: Error | null
}

/**
 * Hook to subscribe to match updates
 */
export function useMatchUpdates(userId: string | null): UseMatchUpdatesReturn {
  const [updates, setUpdates] = useState<MatchUpdate[]>([])
  const [error, setError] = useState<Error | null>(null)
  
  useEffect(() => {
    if (!userId) return
    
    const pusher = getPusherClient()
    if (!pusher) {
      setError(new Error('Pusher not initialized'))
      return
    }
    
    try {
      const channel = pusher.subscribe(`private-user-${userId}`)
      
      channel.bind('match-update', (data: MatchUpdate) => {
        setUpdates(prev => [data, ...prev])
      })
      
      return () => {
        channel.unbind('match-update')
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to subscribe to match updates'))
    }
  }, [userId])
  
  return {
    updates,
    error,
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Request browser notification permission
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    return false
  }
  
  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

/**
 * Check if browser notifications are supported and permitted
 */
export function canUseBrowserNotifications(): boolean {
  return 'Notification' in window && Notification.permission === 'granted'
}

/**
 * Show a browser notification
 */
export function showNotification(title: string, options?: NotificationOptions): void {
  if (canUseBrowserNotifications()) {
    new Notification(title, options)
  }
}
