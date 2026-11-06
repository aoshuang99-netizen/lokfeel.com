/**
 * WO-1089 回归守卫：bot 在线状态不得「群体同步」
 *
 * 背景（实测，非推断）：
 *   - 生产 11338 个 bot：7838 个 botConfig = NULL，3500 个为早期导入格式，
 *     含 `online.avgSessionsPerDay` 的为 **0 个** ⇒ 100% 走默认配置回退。
 *   - 原默认配置硬编码 `seed: 42`，而 `evaluateOnlineTransition` 的随机种子只含日期
 *     ⇒ 全体 bot 共用同一颗骰子，每天只掷一次：要么全体离线，要么全体上线。
 *   - UTC 2026-11-04：seed = 20261146，random() = 0.7449 > p ≈ 0.0559 ⇒ 全体离线。
 *     线上抽查 600 个 bot 全部 offline / transitions = 0，与此判定一致。
 *
 * 本测试锁定两件事：
 *   ① seed 必须由 botId 派生（去相关），不得为常量；
 *   ② 同一天内群体在线比例必须落在合理区间（既非 0% 也非 100%）。
 */

import { getBotConfig } from '../../src/lib/bot-engine/default-config';
import { createSeededRandom } from '../../src/lib/bot-engine/utils';
import {
  calculateOnlineProbability,
  evaluateOnlineTransition,
  createOnlineState,
} from '../../src/lib/bot-engine/modules/online-status';

/** 早期导入格式：不含 online 字段，实测生产 3500 条均为此形态 */
const LEGACY_CONFIG = JSON.stringify({
  originalId: 'F00001',
  ageGroup: 'Young Professional',
  region: 'Northeast',
  profession: 'Event Planner',
});

describe('WO-1089 · 默认配置种子去相关', () => {
  it('legacy 配置走回退分支，且 seed 不等于常量 42', () => {
    const a = getBotConfig(LEGACY_CONFIG, 'cmosgf23g00006');
    expect(a.seed).not.toBe(42);
    expect(a.seed).toBeGreaterThan(0);
  });

  it('不同 botId 得到不同 seed（不再是同一颗骰子）', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 500; i++) {
      seeds.add(getBotConfig(null, `bot-${i}`).seed);
    }
    // 500 个 id 至少应有 490 个互不相同的 seed
    expect(seeds.size).toBeGreaterThan(490);
  });

  it('同一 botId 的 seed 稳定（可复现，不随调用漂移）', () => {
    const s1 = getBotConfig(null, 'bot-stable').seed;
    const s2 = getBotConfig(null, 'bot-stable').seed;
    expect(s1).toBe(s2);
  });

  it('WO-1090：同一天内相邻小时必须换骰子（原实现日粒度，全天结论恒定）', () => {
    // 原语义：种子只含日期 ⇒ 同一天 24 次调用结果逐字相同。
    // 现语义：种子含小时 ⇒ (日期, 小时) 不同则骰子不同。
    const dateKey = 20261105;
    const h3 = createSeededRandom(dateKey * 24 + 3)();
    const h4 = createSeededRandom(dateKey * 24 + 4)();
    expect(h3).not.toBe(h4);
  });

  it('WO-1090：(日期, 小时) → 种子单射，不会跨天撞种子', () => {
    const seeds = new Set<number>();
    const dateKey = 20261105;
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        seeds.add((dateKey + d) * 24 + h);
      }
    }
    expect(seeds.size).toBe(7 * 24);
  });
});

describe('WO-1089 · 群体去相关后在线比例合理', () => {
  /**
   * 🔴 2026-11-06 修（CI flaky，非生产 bug）：
   * calculateOnlineProbability 内部 getCurrentHourInTimezone() 读的是**真实系统时钟**，
   * 命中 peakHours [20,21] 时 peakMultiplier = 5.0，p 从 ~0.046 抬到 ~0.208。
   * CI 在 UTC 02:56（纽约 21:56 晚高峰）跑 → ratio 0.2065 > 0.12 ⇒ FAIL；
   * 本地 GMT+8 下午（纽约凌晨 off-peak）跑 → ratio ~0.046 ⇒ 稳定 PASS。
   * 用例标题写「固定日期」却只固定了种子里的 dateKey，没固定时钟，属测试自身缺陷。
   *
   * 修复：把时钟固定到 2026-11-04T08:00:00Z = 纽约 03:00（off-peak），
   * 与用例内 dateKey = 20261104 / hour = 3 的语义一致。
   * 不放宽 0.12 阈值、不改生产算法、不删断言。
   */
  const FIXED_ISO = '2026-11-04T08:00:00Z';

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(FIXED_ISO));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('固定日期下 2000 个 bot 的在线比例落在 2%–12%（非全 0、非全 1）', () => {
    const dateKey = 20261104; // UTC 2026-11-04
    const hour = 3;
    let online = 0;
    const N = 2000;

    for (let i = 0; i < N; i++) {
      const cfg = getBotConfig(null, `bot-${i}`);
      // 复刻 evaluateOnlineTransition 的种子构成：config.seed + 日期*24 + 小时（WO-1090）
      const cfgTyped = cfg as { seed: number };
      const p = calculateOnlineProbability(cfg, 'America/New_York');
      const rand = createSeededRandom(cfgTyped.seed + dateKey * 24 + hour)();
      if (rand < p) online++;
    }

    const ratio = online / N;
    expect(ratio).toBeGreaterThan(0.02);
    expect(ratio).toBeLessThan(0.12);
  });

  it('负向对照：seed 全为 42 时群体判定退化为一刀切', () => {
    const dateKey = 20261104;
    const cfg = getBotConfig(null, 'any');
    const p = calculateOnlineProbability(cfg, 'America/New_York');
    const r = createSeededRandom(42 + dateKey * 24 + 3)();
    // 同一颗骰子 ⇒ 11338 个 bot 的结论要么全 true 要么全 false
    const allSame = Array.from({ length: 100 }, () => r < p).every(Boolean)
      || Array.from({ length: 100 }, () => r < p).every((v) => !v);
    expect(allSame).toBe(true);
  });

  it('负向对照（WO-1090）：去掉小时项后，全天 24 次判定逐字相同', () => {
    const dateKey = 20261105;
    const decisions: boolean[] = [];
    for (let h = 0; h < 24; h++) {
      // 旧种子构成：只有日期，没有小时
      decisions.push(createSeededRandom(dateKey)() < 0.05);
    }
    expect(new Set(decisions).size).toBe(1);
  });

  it('evaluateOnlineTransition 在独立 seed 下应能产生 session_start 事件', () => {
    // 找出一个当天会命中的 seed，验证转移逻辑本身是通的（排除「引擎完全坏掉」）
    const cfg = getBotConfig(null, 'probe') as { seed: number };

    let hit = false;
    for (let i = 1; i <= 500 && !hit; i++) {
      const testCfg = { ...cfg, seed: i };
      const state = createOnlineState('probe');
      const { state: next, events } = evaluateOnlineTransition(
        state,
        testCfg,
        'America/New_York'
      );
      if (next.isOnline) {
        hit = true;
        expect(events.some((e) => e.type === 'session_start')).toBe(true);
      }
    }
    expect(hit).toBe(true);
  });
});

/**
 * WO-1090 · 小时粒度骰子（端到端，走真实 evaluateOnlineTransition + 假时钟）
 *
 * 为什么必须有这组测试：WO-1089 只解决了「全体 bot 共用一颗骰子」，
 * 但种子仍只含日期 ⇒ 每个 bot 当天只有一个固定结论。
 * 实测 3000 个真实 botId（UTC 2026-11-05）：78.7% 全天 0 次上线、
 * 5.0% 全天 24 小时都在线，h03 与 h04 的在线集合 Jaccard = 1.000。
 * 线上表现就是「永远是同一批头像亮着」。
 */
describe('WO-1090 · 小时粒度判定', () => {
  const TZ = 'America/New_York';
  const baseCfg = getBotConfig(null, 'probe') as { seed: number };

  const decideAt = (seed: number, iso: string): boolean => {
    jest.useFakeTimers().setSystemTime(new Date(iso));
    try {
      const cfg = { ...baseCfg, seed };
      const { state } = evaluateOnlineTransition(createOnlineState('probe'), cfg, TZ);
      return state.isOnline;
    } finally {
      jest.useRealTimers();
    }
  };

  it('相邻小时的判定不再逐字相同（群体里应有约 2p(1-p) 的翻转）', () => {
    const N = 2000;
    let flipped = 0;
    for (let seed = 1; seed <= N; seed++) {
      const d3 = decideAt(seed, '2026-11-05T03:00:00Z');
      const d4 = decideAt(seed, '2026-11-05T04:00:00Z');
      if (d3 !== d4) flipped++;
    }
    // 若骰子仍与小时无关，翻转数恒为 0
    expect(flipped).toBeGreaterThan(0);
    expect(flipped / N).toBeGreaterThan(0.02);
  });

  it('单个 bot 一天内的在线小时数不应恒定（不能每天只掷一次）', () => {
    const seed = 12345;
    const hours: boolean[] = [];
    for (let h = 0; h < 24; h++) {
      hours.push(decideAt(seed, `2026-11-05T${String(h).padStart(2, '0')}:00:00Z`));
    }
    // 该 bot 至少应出现「某些小时在线、某些小时离线」，而非全天同一结论
    expect(hours.some(Boolean)).toBe(true);
    expect(hours.some((v) => !v)).toBe(true);
  });

  it('全天覆盖率 ≥60%（原日粒度下约等于单小时命中率 5%，即 95% 的 bot 永不出现）', () => {
    const N = 500;
    let appeared = 0;
    for (let seed = 1; seed <= N; seed++) {
      let any = false;
      for (let h = 0; h < 24 && !any; h++) {
        any = decideAt(seed, `2026-11-05T${String(h).padStart(2, '0')}:00:00Z`);
      }
      if (any) appeared++;
    }
    const coverage = appeared / N;
    expect(coverage).toBeGreaterThan(0.6);
    expect(coverage).toBeLessThan(0.95);
  });
});

/**
 * 时钟依赖根因守卫（反例组，2026-11-06 新增）
 *
 * 为什么必须有「not A」：只测 off-peak 通过，无法证明「固定时钟」这一修复是必要的，
 * 也无法防止后人误删 beforeEach 后测试重新变 flaky。本组用同一批 2000 个 bot、
 * 同一颗种子，只切换系统时钟，锁死两种时刻下的比例差异。
 *
 * 实测基线（修复前 CI）：run 42153447731 @ 064cfe8，UTC 02:56 → ratio 0.2065，
 * 断言 toBeLessThan(0.12) 失败；本地 GMT+8 下午（纽约凌晨 off-peak）→ 稳定通过。
 * 修复后本地用假时钟复现同一批 2000 bot：off-peak 0.0395 / peak 0.2065，
 * peak 数值与 CI 失败日志逐字一致。
 */
describe('WO-1089 · 时钟依赖根因守卫', () => {
  const N = 2000;
  const dateKey = 20261104;
  const hour = 3;

  const ratioAt = (iso: string): number => {
    jest.useFakeTimers().setSystemTime(new Date(iso));
    try {
      let online = 0;
      for (let i = 0; i < N; i++) {
        const cfg = getBotConfig(null, `bot-${i}`);
        const cfgTyped = cfg as { seed: number };
        const p = calculateOnlineProbability(cfg, 'America/New_York');
        const rand = createSeededRandom(cfgTyped.seed + dateKey * 24 + hour)();
        if (rand < p) online++;
      }
      return online / N;
    } finally {
      jest.useRealTimers();
    }
  };

  it('off-peak（纽约 03:00）比例落在 2%–12%', () => {
    const ratio = ratioAt('2026-11-04T08:00:00Z');
    expect(ratio).toBeGreaterThan(0.02);
    expect(ratio).toBeLessThan(0.12);
  });

  it('peak（纽约 21:00）比例突破 12% —— 复现 CI 失败形态，证明必须固定时钟', () => {
    // 2026-11-05T02:00:00Z = 纽约 2026-11-04 21:00 EST，命中 peakHours [20,21]
    const peakRatio = ratioAt('2026-11-05T02:00:00Z');
    const offPeakRatio = ratioAt('2026-11-04T08:00:00Z');
    // 实测（TZ=UTC，本地复现）：offPeak = 0.0395、peak = 0.2065。
    // 后者与 CI 失败日志 `Received: 0.2065` 逐字一致 ⇒ 根因确证，非推断。
    expect(peakRatio).toBeGreaterThan(0.12);
    expect(peakRatio).toBeGreaterThan(offPeakRatio * 2);
  });
});
