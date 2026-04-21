/**
 * Socket.io Server — Real-time IM Gateway
 * 
 * Architecture:
 * - Socket.io for WebSocket connections with fallback to polling
 * - JWT authentication on connection
 * - Room-based subscription (per conversation)
 * - Redis for connection tracking and horizontal scaling
 * 
 * Note: For Vercel deployment, use Pusher (see use-im-pusher.ts).
 * This module is for custom server deployments where Socket.io is preferred.
 */

import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import type { Socket } from 'socket.io';
import { registerSocketHandlers } from './handlers';

// ─── Types ──────────────────────────────────────────────────────────

export interface SocketServerOptions {
  /** Path for Socket.io endpoint */
  path?: string;
  /** CORS configuration */
  cors?: {
    origin: string | string[];
    credentials: boolean;
  };
  /** Heartbeat interval in ms */
  heartbeatInterval?: number;
  /** Heartbeat timeout in ms */
  heartbeatTimeout?: number;
  /** Max payload size in bytes */
  maxPayload?: number;
}

// ─── Socket.io Server Singleton ──────────────────────────────────────

let io: SocketIOServer | null = null;

export function getSocketServer(): SocketIOServer | null {
  return io;
}

export function isSocketServerInitialized(): boolean {
  return io !== null;
}

/**
 * Initialize Socket.io server
 * 
 * This should be called once when setting up the custom server.
 * For Next.js App Router, this runs in server.ts (custom server).
 */
export function initializeSocketServer(
  httpServer: HTTPServer,
  options: SocketServerOptions = {}
): SocketIOServer {
  if (io) {
    console.log('[Socket Server] Already initialized');
    return io;
  }

  const {
    path = '/api/socketio',
    cors = {
      origin: process.env.NEXT_PUBLIC_APP_URL || '*',
      credentials: true,
    },
    heartbeatInterval = 25000,
    heartbeatTimeout = 20000,
    maxPayload = 1e6, // 1MB
  } = options;

  io = new SocketIOServer(httpServer, {
    path,
    cors,
    transports: ['websocket', 'polling'],
    pingInterval: heartbeatInterval,
    pingTimeout: heartbeatTimeout,
    maxHttpBufferSize: maxPayload,
    // Redis Adapter for horizontal scaling
    adapter: createRedisAdapter(),
  });

  // Register event handlers
  registerSocketHandlers(io);

  // Global middleware
  io.use(async (socket: Socket, next) => {
    // Authentication is handled in the 'authenticate' event handler
    // This middleware runs on every connection
    console.log(`[Socket Server] New connection: ${socket.id}`);
    next();
  });

  // Connection events
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket Server] Client connected: ${socket.id}`);

    // Log connection stats
    const roomCount = socket.rooms.size - 1; // Exclude socket.id itself
    console.log(`[Socket Server] Socket ${socket.id} in ${roomCount} rooms`);
  });

  console.log('[Socket Server] Initialized successfully');

  return io;
}

/**
 * Create Redis adapter for Socket.io
 * Enables horizontal scaling across multiple server instances
 * 
 * Note: To enable Redis adapter, install @socket.io/redis-adapter
 * and uncomment the dynamic import below.
 */
function createRedisAdapter() {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    console.warn('[Socket Server] Redis not configured, using default in-memory adapter');
    return undefined;
  }

  // TODO: Enable when @socket.io/redis-adapter is installed
  // try {
  //   const { createAdapter } = await import('@socket.io/redis-adapter');
  //   // Return adapter with Redis pub/sub client
  //   console.log('[Socket Server] Redis adapter configured for horizontal scaling');
  //   return createAdapter;
  // } catch {
  //   console.warn('[Socket Server] Redis adapter not available, using default');
  //   return undefined;
  // }
  
  return undefined;
}

/**
 * Shutdown Socket.io server
 */
export async function shutdownSocketServer(): Promise<void> {
  if (!io) return;

  console.log('[Socket Server] Shutting down...');

  // Close all connections gracefully
  await new Promise<void>((resolve) => {
    io!.close(() => {
      console.log('[Socket Server] All connections closed');
      resolve();
    });
  });

  io = null;
  console.log('[Socket Server] Shutdown complete');
}

/**
 * Get connection statistics
 */
export function getSocketServerStats(): {
  connectedSockets: number;
  rooms: number;
  transport: string;
} {
  if (!io) {
    return { connectedSockets: 0, rooms: 0, transport: 'none' };
  }

  const sockets = io.sockets.sockets;
  const rooms = new Set<string>();
  
  sockets.forEach((socket) => {
    socket.rooms.forEach((room) => {
      if (room !== socket.id) {
        rooms.add(room);
      }
    });
  });

  return {
    connectedSockets: sockets.size,
    rooms: rooms.size,
    transport: 'websocket',
  };
}

/**
 * Broadcast to a conversation room
 */
export async function broadcastToConversation(
  convId: string,
  event: string,
  data: unknown,
  excludeSocketId?: string
): Promise<void> {
  if (!io) return;

  const roomName = `conv:${convId}`;
  const sockets = await io.in(roomName).fetchSockets();

  for (const socket of sockets) {
    if (socket.id !== excludeSocketId) {
      socket.emit(event, data);
    }
  }
}

/**
 * Send to a specific user (all their connections)
 */
export async function sendToUser(
  userId: string,
  event: string,
  data: unknown
): Promise<number> {
  if (!io) return 0;

  const roomName = `user:${userId}`;
  return io.to(roomName).emit(event, data) as unknown as number;
}

// ─── Express/Fastify Integration ────────────────────────────────────

/**
 * Get Socket.io request handler for Express
 * Use this when integrating with an existing Express app
 */
export function getSocketHandler() {
  if (!io) {
    throw new Error('Socket.io server not initialized');
  }
  return (req: any, res: any) => {
    // Socket.io server handler
    res.end();
  };
}
