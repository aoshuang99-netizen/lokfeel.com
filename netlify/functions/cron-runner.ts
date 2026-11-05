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
  /**
   * true = 该端点支持 cursor 分页且响应带 { hasMore, nextCursor }，
   * cron-runner 会在时间预算内连续翻页（WO-1090-B）。
   * ⚠️ 目前只有 bot-online 的响应契约是 `nextCursor`；
   * bot-match 用的是 `continueFrom`、bot-chat 的游标键名不同，接进来前需逐个核对。
   */
  paginated?: boolean
}

const CRON_JOBS: CronJob[] = [
  { path: "/api/cron/bot-tick", method: "GET" },
  { path: "/api/cron/bot-online", method: "GET", paginated: true },
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

  const budget = Number(process.env.CRON_DRAIN_BUDGET_MS ?? DRAIN_BUDGET_MS);

  const results = await Promise.allSettled(
    CRON_JOBS.map(async (job) => {
      // 🔴 2026-11-05 修（WO-1090-B）：分页端点必须「吃完一页再要下一页」。
      // 原实现只发一次请求，丢掉响应里的 hasMore / nextCursor ⇒
      // bot-online 每小时只处理 100 个 bot（MAX_BOTS_PER_BATCH），
      // 全量 11338 个要 114 小时才轮一遍，而且每次都从 id 最小的那 100 个开始，
      // 线上表现就是「永远同一批 bot 在线」。现在按时间预算连续翻页，
      // 并用随机起始 offset 打散窗口（无状态，不依赖持久化 cursor）。
      if (job.paginated) {
        const drained = await drainPaginated(base, secret, job.path, budget);
        return { path: job.path, ...drained };
      }
      const res = await fetch(base + job.path, {
        method: job.method ?? "GET",
        headers: { Authorization: `Bearer ${secret}` },
      });
      return { path: job.path, status: res.status };
    })
  );

  const summary = results.map((r, i) =>
    r.status === "fulfilled"
      ? `${CRON_JOBS[i].path} -> ${r.value.status}` +
        ("processed" in r.value
          ? ` (pages=${r.value.pages} processed=${r.value.processed}${r.value.complete ? "" : " BUDGET"})`
          : "")
      : `${CRON_JOBS[i].path} -> ERR ${r.reason}`
  );
  console.log("[cron-runner] tick:\n" + summary.join("\n"));

  return { statusCode: 200, body: "ok" };
}

/** 单次 tick 用于连续翻页的总时间预算（Netlify 同步函数默认 10s 上限） */
const DRAIN_BUDGET_MS = 6000;

/** 起始 offset 的随机窗口上限：留出余量，避免 skip 越过表尾 */
const MAX_START_OFFSET = 10000;

export type DrainResult = {
  status: number;
  pages: number;
  processed: number;
  /** true = 已翻到 hasMore=false，本轮扫完 */
  complete: boolean;
};

/**
 * 连续翻页直到 hasMore=false 或时间预算耗尽。
 *
 * 依赖 bot-online 路由的契约：`{ hasMore, nextCursor, stats: { batchSize } }`，
 * 且支持 `?offset=N`（无 cursor 时生效）用于打散起始窗口。
 */
export async function drainPaginated(
  base: string,
  secret: string,
  path: string,
  budgetMs: number,
  rng: () => number = Math.random,
  now: () => number = () => Date.now(),
): Promise<DrainResult> {
  const startedAt = now();
  const startOffset = Math.floor(rng() * MAX_START_OFFSET);
  let cursor: string | undefined;
  let pages = 0;
  let processed = 0;

  while (now() - startedAt < budgetMs) {
    const qs = new URLSearchParams();
    if (cursor) qs.set("cursor", cursor);
    else if (startOffset > 0) qs.set("offset", String(startOffset));

    const url = base + path + (qs.toString() ? `?${qs}` : "");
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
    });

    if (res.status !== 200) {
      return { status: res.status, pages, processed, complete: false };
    }

    let body: { stats?: { batchSize?: number }; hasMore?: boolean; nextCursor?: string } | null = null;
    try {
      body = await res.json();
    } catch {
      return { status: 200, pages, processed, complete: false };
    }

    pages++;
    processed += Number(body?.stats?.batchSize ?? 0);

    if (body?.hasMore && typeof body?.nextCursor === "string" && body.nextCursor) {
      cursor = body.nextCursor;
      continue;
    }
    return { status: 200, pages, processed, complete: true };
  }

  return { status: 200, pages, processed, complete: false };
}
