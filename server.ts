/**
 * Custom Server — Next.js + Socket.io Integration
 * 
 * This file enables Socket.io alongside Next.js for real-time IM features.
 * 
 * Usage:
 *   npx tsx server.ts
 * 
 * Note: For Vercel deployment, use Pusher instead (see use-im-pusher.ts).
 * This custom server is for self-hosted deployments.
 */

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { initializeSocketServer, shutdownSocketServer } from './src/lib/socket';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

// Initialize Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Create HTTP server
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // Initialize Socket.io
  initializeSocketServer(server, {
    path: '/api/socketio',
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || `http://${hostname}:${port}`,
      credentials: true,
    },
    heartbeatInterval: 25000,
    heartbeatTimeout: 20000,
    maxPayload: 1e6, // 1MB
  });

  // Start server
  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Socket.io server running on /api/socketio`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n> Shutting down...');
    await shutdownSocketServer();
    server.close(() => {
      console.log('> Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
});
