import PusherServer from "pusher";

// Server-side Pusher instance — lazy singleton to prevent crashes when env vars are missing
// P1-4 fix: was eager module-level instantiation that crashed if PUSHER_APP_ID was empty
let _pusherServer: PusherServer | null = null;

export function getPusherServer(): PusherServer | null {
  if (_pusherServer) return _pusherServer;

  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;

  if (!appId || !key || !secret) {
    console.warn("[Pusher] Not configured (missing PUSHER_APP_ID/KEY/SECRET), real-time events disabled");
    return null;
  }

  _pusherServer = new PusherServer({
    appId,
    key,
    secret,
    cluster: process.env.PUSHER_CLUSTER || "us3",
    useTLS: true,
  });

  return _pusherServer;
}

// Backward-compatible export: consumers that do `import { pusherServer }` still work
// but will get null if not configured (instead of crashing)
export const pusherServer = typeof PusherServer !== 'undefined'
  ? new Proxy({} as PusherServer, {
      get(_target, prop) {
        const instance = getPusherServer();
        if (!instance) {
          console.warn(`[Pusher] Attempted to access .${String(prop)} but Pusher is not configured`);
          return undefined;
        }
        return (instance as any)[prop];
      }
    })
  : null;

// Client-side Pusher instance - lazy import to avoid SSR issues
export const getPusherClient = () => {
  if (typeof window === "undefined") {
    return null;
  }
  const PusherClient = require("pusher-js");
  return new PusherClient(
    process.env.NEXT_PUBLIC_PUSHER_KEY || "",
    {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "us3",
      authEndpoint: "/api/im/pusher/auth",
      auth: {
        headers: {
          "Content-Type": "application/json",
        },
      },
    }
  );
};
