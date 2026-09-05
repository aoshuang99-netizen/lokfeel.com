// Netlify scheduled function — replaces Vercel Cron for LokFeel.
//
// It runs on the schedule declared in netlify.toml ([functions.cron-runner])
// and pings every internal cron endpoint with the CRON_SECRET. The cron
// endpoints themselves live under src/app/api/cron/* and are guarded by
// `Authorization: Bearer <CRON_SECRET>` (see bot-tick/route.ts for the check).
//
// NOTE on frequency: Netlify's free plan only reliably supports hourly (or
// coarser) scheduled functions. Several LokFeel crons are sub-hourly
// (bot-tick every minute, bot-online every 15m, bot-chat every 5m). This
// runner triggers them hourly, which keeps the system alive on the free tier.
// For finer granularity, add cron-job.org jobs hitting the same endpoints
// with header `Authorization: Bearer <CRON_SECRET>`.

export const schedule = "23 * * * *"; // hourly, off the :00 mark

const CRON_PATHS = [
  "/api/cron/bot-tick",
  "/api/cron/bot-online",
  "/api/cron/bot-chat",
  "/api/cron/bot-match",
  "/api/cron/bot-learning",
  "/api/cron/cleanup-soft-delete",
  "/api/cron/migrate-avatars",
  "/api/cron/status",
];

export default async function handler() {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.URL ||
    "https://app.lokfeel.com";
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("[cron-runner] CRON_SECRET is not set — aborting");
    return { statusCode: 500, body: "CRON_SECRET missing" };
  }

  const results = await Promise.allSettled(
    CRON_PATHS.map(async (path) => {
      const res = await fetch(base + path, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      return { path, status: res.status };
    })
  );

  const summary = results.map((r, i) =>
    r.status === "fulfilled"
      ? `${CRON_PATHS[i]} -> ${r.value.status}`
      : `${CRON_PATHS[i]} -> ERR ${r.reason}`
  );
  console.log("[cron-runner] tick:\n" + summary.join("\n"));

  return { statusCode: 200, body: "ok" };
}
