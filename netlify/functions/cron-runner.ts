// Netlify scheduled function — replaces Vercel Cron for LokFeel.
//
// It runs on the schedule declared in netlify.toml ([functions.cron-runner])
// and pings every internal cron endpoint with the CRON_SECRET. The cron
// endpoints themselves live under src/app/api/cron/* and are guarded by
// `Authorization: Bearer <CRON_SECRET>` (see bot-tick/route.ts for the check).
//
// 🔴 2026-10-20 修：此前这里对所有端点统一用 POST，但
// `bot-tick` / `bot-online` / `bot-chat` / `bot-match` / `status` **只导出 GET**
// ⇒ Next 返回 405。仓库内唯一的调度链路对它们全部失效
// （线上实测：GET=401 / POST=405，2026-10-20）。若另有 cron-job.org 外部调度，
// 影响可被掩盖 —— 查一下它的任务列表即可确认。
// 症状不是报错，而是「机器人不动、匹配不推进」——最容易被当成产品问题。
// 现在**逐端点声明方法**，并由 `scripts/ci/verify-cron-methods.mjs` 做源码级
// 防回归（route 的导出方法 vs 这里的调用方法，不一致就判红）。
//
// NOTE on frequency: Netlify's free plan only reliably supports hourly (or
// coarser) scheduled functions. Several LokFeel crons are sub-hourly
// (bot-tick every minute, bot-online every 15m, bot-chat every 5m). This
// runner triggers them hourly, which keeps the system alive on the free tier.
// 自托管（systemd timer）后按各端点的设计频率跑，见 deploy/selfhost/cron/。

export const schedule = "23 * * * *"; // hourly, off the :00 mark

type CronJob = {
  path: string
  /** 必须与 route.ts 导出的方法一致，否则 405。默认 GET（多数端点只导出 GET） */
  method?: "GET" | "POST"
}

const CRON_JOBS: CronJob[] = [
  { path: "/api/cron/bot-tick", method: "GET" },
  { path: "/api/cron/bot-online", method: "GET" },
  { path: "/api/cron/bot-chat", method: "GET" },
  { path: "/api/cron/bot-match", method: "GET" },
  { path: "/api/cron/bot-learning", method: "GET" },
  { path: "/api/cron/cleanup-soft-delete", method: "GET" },
  // migrate-avatars 只导出 POST（route.ts 里没有 GET）
  { path: "/api/cron/migrate-avatars", method: "POST" },
  // T06 · outbox 驱动器：领取到期任务、回收失联租约、投递站内信/邮件，
  // 并对账补漏（"已双方同意但未入队"的提案）。同样受小时级限制 ——
  // 更细的粒度可让 cron-job.org 直接打这个端点（见文件头说明）。
  { path: "/api/cron/workflow-tick", method: "GET" },
  // AC-10 · 数据生命周期清理（端点已就绪，**默认不随 cron 自动跑**）。
  // 删除不可逆 ⇒ 按约定需运营方显式开启：取消下一行注释并重新发版即可。
  // 在此之前可手工 `GET /api/cron/lifecycle-sweep?dry=1` 观察命中数（只统计、不写）。
  // 保留期以**天**计，小时级调度绰绰有余；PENDING/RUNNING 任务永不触碰。
  // { path: "/api/cron/lifecycle-sweep", method: "GET" },
  { path: "/api/cron/status", method: "GET" },
]

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
    CRON_JOBS.map(async (job) => {
      const res = await fetch(base + job.path, {
        method: job.method ?? "GET",
        headers: { Authorization: `Bearer ${secret}` },
      });
      return { path: job.path, status: res.status };
    })
  );

  const summary = results.map((r, i) =>
    r.status === "fulfilled"
      ? `${CRON_JOBS[i].path} -> ${r.value.status}`
      : `${CRON_JOBS[i].path} -> ERR ${r.reason}`
  );
  console.log("[cron-runner] tick:\n" + summary.join("\n"));

  return { statusCode: 200, body: "ok" };
}
