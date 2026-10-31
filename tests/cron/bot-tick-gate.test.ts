/**
 * B-6 回归测试 —— /api/cron/bot-tick
 *
 * 修的是「端点空转」：原实现从不 loadBotUsers()/tick()，`botCount` 恒 0，
 * 于是一律 return no_bots，11,338 个 Bot 从未 tick 过一次。
 *
 * 本测试锁住三条不变量：
 *   1. 鉴权失败 ⇒ 401，且不加载、不 tick；
 *   2. 默认（BOT_ENGINE_TICK_ENABLED 未设）⇒ 加载成功但 **tickSkipped=true**
 *      ⇒ 线上行为与修复前一致，不会因为合并这个补丁就悄悄开始发消息；
 *   3. 显式开启 ⇒ tickOnce 被调用一次，tickDelta=1。
 */

const mockState = {
  botCount: 0,
  tickCount: 0,
  tickCalls: 0,
  loadCalls: 0,
  emptyDb: false,
};

jest.mock('@/lib/db', () => ({ db: {} }));

jest.mock('@/lib/bot-engine/schedulers/prisma-adapter', () => ({
  createPrismaAdapter: () => ({}),
}));

jest.mock('@/lib/bot-engine', () => {
  class FakeEngine {
    getHealth() {
      return {
        botCount: mockState.botCount,
        tickCount: mockState.tickCount,
        lastTickAt: null,
        scheduledActionsPending: 0,
        globalStats: { totalEventsProcessed: 0 },
      };
    }
    async ensureBotsLoaded() {
      mockState.loadCalls++;
      if (!mockState.emptyDb && mockState.botCount === 0) mockState.botCount = 3;
      return mockState.botCount;
    }
    async tickOnce() {
      mockState.tickCalls++;
      mockState.tickCount++;
    }
  }
  return { BotEngine: FakeEngine, DEFAULT_ENGINE_CONFIG: {} };
});

const ORIGINAL_ENV = { ...process.env };

function makeRequest(auth = true) {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  return new Request('https://app.lokfeel.com/api/cron/bot-tick', { headers });
}

function loadRoute() {
  let route: typeof import('@/app/api/cron/bot-tick/route');
  jest.isolateModules(() => {
    route = require('@/app/api/cron/bot-tick/route');
  });
  return route!;
}

describe('/api/cron/bot-tick (B-6)', () => {
  beforeEach(() => {
    Object.assign(process.env, ORIGINAL_ENV);
    // BOT_ENGINE_ENABLED 必须为 true，否则路由在鉴权后直接 503
    process.env.BOT_ENGINE_ENABLED = 'true';
    process.env.CRON_SECRET = 'test-secret';
    delete process.env.BOT_ENGINE_TICK_ENABLED;
    mockState.botCount = 0;
    mockState.tickCount = 0;
    mockState.tickCalls = 0;
    mockState.loadCalls = 0;
    mockState.emptyDb = false;
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('鉴权失败返回 401，且不加载、不 tick', async () => {
    const { GET } = loadRoute();
    const res = await GET(makeRequest(false));
    expect(res.status).toBe(401);
    expect(mockState.loadCalls).toBe(0);
    expect(mockState.tickCalls).toBe(0);
  });

  it('默认门控关闭：会加载 Bot 但 tickSkipped=true，tickCount 不增长', async () => {
    const { GET } = loadRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.tickSkipped).toBe(true);
    expect(body.engine.botCount).toBe(3);
    expect(body.engine.tickCount).toBe(0);
    expect(mockState.loadCalls).toBe(1);
    expect(mockState.tickCalls).toBe(0);
  });

  it('BOT_ENGINE_TICK_ENABLED=true 时真正执行一次 tick', async () => {
    process.env.BOT_ENGINE_TICK_ENABLED = 'true';
    const { GET } = loadRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.tickSkipped).toBe(false);
    expect(body.tickDelta).toBe(1);
    expect(body.engine.tickCount).toBe(1);
    expect(mockState.tickCalls).toBe(1);
  });

  it('加载后仍为 0 才返回 no_bots（区分"没加载"与"库里没有"）', async () => {
    // 模拟库里确实没有 Bot：ensureBotsLoaded 加载不到任何配置
    mockState.emptyDb = true;
    const { GET } = loadRoute();
    const res = await GET(makeRequest());

    const body = await res.json();
    expect(body.status).toBe('no_bots');
    expect(body.botCount).toBe(0);
    expect(mockState.loadCalls).toBe(1);   // 确实尝试过加载（不再误判）
    expect(mockState.tickCalls).toBe(0);   // 也不该 tick
  });
});
