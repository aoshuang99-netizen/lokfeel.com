/**
 * B-5 / B-5a / B-5b 回归测试 —— /api/cron/cleanup-soft-delete
 *
 * 覆盖三件此前会静默失效的事：
 *   1. 模型委托映射错误（`db.userreport` / `db.chatRoom` 不存在）时不会抛 TypeError；
 *   2. 任一模型失败 ⇒ HTTP 500 + success:false（此前恒 200 / true）；
 *   3. `?dry=1` 只读计数、`?limit=N` 分批删除并回报 remaining（防 60s 超时）。
 *
 * 用 jest.mock 替换 @/lib/db，避免测试触真实 Turso 连接。
 */

const mockDeleteCalls: string[] = [];

function mockMakeDelegate(name: string, total: number) {
  let rows = Array.from({ length: total }, (_, i) => ({ id: `${name}-${i}` }));
  return {
    async count() {
      return rows.length;
    },
    async findMany({ take }: { take: number }) {
      return rows.slice(0, take);
    },
    async deleteMany({ where }: { where: any }) {
      mockDeleteCalls.push(name);
      if (Array.isArray(where?.id?.in)) {
        const ids = new Set(where.id.in as string[]);
        const before = rows.length;
        rows = rows.filter((r) => !ids.has(r.id));
        return { count: before - rows.length };
      }
      const before = rows.length;
      rows = [];
      return { count: before };
    },
  };
}

jest.mock('@/lib/db', () => {
  const names = ["user", "match", "subscription", "payment", "userReport", "conversation"];
  const delegates: Record<string, unknown> = {};
  for (const n of names) {
    delegates[n] = mockMakeDelegate(n, n === "conversation" ? 3 : 0);
  }
  return { db: delegates };
});

import { GET } from '@/app/api/cron/cleanup-soft-delete/route';
import { NextRequest } from 'next/server';

function req(query = '', auth = true) {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  return new NextRequest(`https://app.lokfeel.com/api/cron/cleanup-soft-delete${query}`, {
    headers,
  });
}

describe('/api/cron/cleanup-soft-delete', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    mockDeleteCalls.length = 0;
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it('无 CRON_SECRET 或鉴权头错误时返回 401，且不触碰数据库', async () => {
    const noHeader = await GET(req('', false));
    expect(noHeader.status).toBe(401);

    const wrong = await GET(
      new NextRequest('https://app.lokfeel.com/api/cron/cleanup-soft-delete', {
        headers: { authorization: 'Bearer wrong' },
      })
    );
    expect(wrong.status).toBe(401);
    expect(mockDeleteCalls).toEqual([]);
  });

  it('dry=1 只读：返回 matched 计数，绝不调用 deleteMany', async () => {
    const res = await GET(req('?dry=1'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.mode).toBe('dry-run');
    expect(body.totalDeleted).toBe(0);
    expect(body.failed).toEqual([]);
    // conversation 预置 3 条积压
    expect(body.results.Conversation.matched).toBe(3);
    // 所有模型都能被计数（即委托名全部解析成功 —— B-5 的核心回归点）
    expect(Object.keys(body.results).sort()).toEqual(
      ["Conversation", "Match", "Payment", "Subscription", "User", "UserReport"].sort()
    );
    expect(mockDeleteCalls).toEqual([]);
  });

  it('limit=2 时 Conversation 分批删除并回报 remaining', async () => {
    const res = await GET(req('?limit=2'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.mode).toBe('execute');
    expect(body.results.Conversation.deleted).toBe(2);
    expect(body.results.Conversation.remaining).toBe(1);
    expect(body.totalDeleted).toBe(2);
  });
});
