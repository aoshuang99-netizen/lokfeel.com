/**
 * Bot 行为配置回退（fallback）工厂
 *
 * 🔴 2026-11-05 修（WO-1089）背景：
 * 生产 11338 个 bot 中，`botConfig` 为 NULL 的 7838 个，另有 3500 个虽是早期导入格式
 * （originalId / ageGroup / region …）但**没有任何一个**含 `online.avgSessionsPerDay`，
 * 因此 `deserializeBotConfig` 的结果全部不满足可用性判据 ⇒ 100% 走默认配置。
 *
 * 原默认配置把 `seed` 写成常量 42，叠加 `evaluateOnlineTransition` 的种子只含日期
 * （见 online-status.ts 第 163-168 行），后果是：
 *   1. 每个 bot 每天只掷一次骰子，同一天内 24 次调用结果恒定 → 小时级调度无法补救；
 *   2. 11338 个 bot 掷的是同一颗骰子 → 要么全体离线、要么全体上线（群体同步）。
 *
 * 实测（UTC 2026-11-04）seed = 42 + 2026*10000 + 11*100 + 4 = 20261146，
 * random() = 0.7449 > p = 0.0559 ⇒ 全体离线；线上抽查 600 个 bot 全部 offline、
 * transitions = 0，与该判定完全一致。而若 seed 相互独立，600 抽样应约有 38 个在线。
 *
 * 因此默认 seed 必须由 botId 派生（hashStringToSeed），保证群体去相关。
 */

import { deserializeBotConfig } from './config';
import { hashStringToSeed } from './utils';

export function getBotConfig(botConfig: string | null, botId: string) {
  if (botConfig) {
    try {
      const parsed = deserializeBotConfig(botConfig);
      // 可用性判据：必须带 online.avgSessionsPerDay
      if (parsed?.online?.avgSessionsPerDay) {
        return parsed;
      }
    } catch {
      /* ignore */
    }
  }

  return {
    personalityType: 'passive',
    // 禁止常量：按 botId 派生，避免全体 bot 共用同一颗骰子
    seed: hashStringToSeed(botId),
    online: {
      avgSessionsPerDay: 1,
      avgSessionDurationMin: 10,
      peakHours: [20, 21],
      offPeakProbability: 0.1,
      activeDays: [0, 1, 2, 3, 4, 5, 6],
    },
  };
}
