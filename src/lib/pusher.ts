import PusherServer from "pusher";

// Server-side Pusher instance
export const pusherServer = new PusherServer({
  appId: process.env.PUSHER_APP_ID || "",
  key: process.env.PUSHER_KEY || "",
  secret: process.env.PUSHER_SECRET || "",
  cluster: process.env.PUSHER_CLUSTER || "us3",
  useTLS: true,
});

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
