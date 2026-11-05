/**
 * WO-1090-B 回归守卫：cron-runner 必须「吃完一页再要下一页」
 *
 * 背景（源码级事实）：cron-runner 原实现对每个端点只发一次 fetch，
 * 并把响应里的 hasMore / nextCursor 直接丢弃。bot-online 的
 * MAX_BOTS_PER_BATCH = 100，而生产 bot 总量 11338 ⇒ 每小时只能处理 100 个，
 * 全量轮一遍需要 114 小时；且每次都从 id 最小的 100 个开始
 * ⇒ 「永远同一批 bot 在线」，与实测「在线集合逐小时完全相同」一致。
 *
 * 本测试锁定：
 *   ① 有 hasMore 时必须继续请求，且带上 nextCursor；
 *   ② 第一页无 cursor 时应带 offset（打散起始窗口）；
 *   ③ 时间预算耗尽即停，不得无限翻页；
 *   ④ 非 200 立即中止，不掩盖鉴权/开关失败。
 */

import { drainPaginated } from '../../netlify/functions/cron-runner';

const SECRET = 'test-secret';
const BASE = 'https://example.test';

type Page = { hasMore: boolean; nextCursor?: string; batch: number; status?: number };

function mockFetch(pages: Page[]) {
  const calls: string[] = [];
  let i = 0;
  const fn = jest.fn(async (url: string) => {
    calls.push(url);
    const page = pages[Math.min(i, pages.length - 1)];
    i++;
    const status = page.status ?? 200;
    return {
      status,
      json: async () => ({
        status: 'ok',
        hasMore: page.hasMore,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        stats: { batchSize: page.batch },
      }),
    } as { status: number; json: () => Promise<{ status: string; hasMore: boolean; nextCursor?: string; stats: { batchSize: number } }> };
  });
  global.fetch = fn as unknown as typeof global.fetch;
  return { calls, fn };
}

describe('WO-1090-B · cron-runner 分页吞取', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('hasMore=true 时继续翻页，并透传 nextCursor', async () => {
    const { calls } = mockFetch([
      { hasMore: true, nextCursor: 'bot-00099', batch: 100 },
      { hasMore: true, nextCursor: 'bot-00199', batch: 100 },
      { hasMore: false, batch: 100 },
    ]);

    const r = await drainPaginated(BASE, SECRET, '/api/cron/bot-online', 60_000, () => 0);

    expect(r.pages).toBe(3);
    expect(r.processed).toBe(300);
    expect(r.complete).toBe(true);
    expect(calls).toHaveLength(3);
    // 第一页没有 cursor（offset=0 时不带 offset），后两页必须带上前一页的游标
    expect(calls[0]).toBe(`${BASE}/api/cron/bot-online`);
    expect(calls[1]).toContain('cursor=bot-00099');
    expect(calls[2]).toContain('cursor=bot-00199');
  });

  it('第一页带随机 offset（打散窗口，避免永远从 id 最小处开始）', async () => {
    const { calls } = mockFetch([{ hasMore: false, batch: 100 }]);
    await drainPaginated(BASE, SECRET, '/api/cron/bot-online', 60_000, () => 0.5);
    expect(calls[0]).toContain('offset=5000');
  });

  it('时间预算耗尽即停（不允许无界翻页）', async () => {
    // 每页耗时 1s，预算 2.5s ⇒ 最多 3 次请求
    let t = 0;
    const now = () => (t += 1000);
    mockFetch(Array.from({ length: 50 }, () => ({ hasMore: true, nextCursor: 'c', batch: 100 })));

    const r = await drainPaginated(BASE, SECRET, '/api/cron/bot-online', 2500, () => 0, now);

    expect(r.complete).toBe(false);
    expect(r.pages).toBeLessThanOrEqual(3);
  });

  it('非 200 立即中止并如实回报状态码（不把 401/503 当成功）', async () => {
    const { calls } = mockFetch([{ hasMore: true, nextCursor: 'x', batch: 0, status: 401 }]);
    const r = await drainPaginated(BASE, SECRET, '/api/cron/bot-online', 60_000, () => 0);
    expect(r.status).toBe(401);
    expect(r.complete).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('负向对照：旧实现（只发一次、丢掉 hasMore）处理量恒为 1 页', async () => {
    // 复刻旧行为：单次 fetch，不读 hasMore
    const { calls } = mockFetch([
      { hasMore: true, nextCursor: 'bot-00099', batch: 100 },
      { hasMore: true, nextCursor: 'bot-00199', batch: 100 },
    ]);
    const res = await fetch(`${BASE}/api/cron/bot-online`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    await res.json();
    expect(calls).toHaveLength(1); // 11338 个 bot 只推进 100 个
  });
});
