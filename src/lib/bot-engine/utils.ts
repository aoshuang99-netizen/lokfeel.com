/**
 * LokFeel Bot Behavior Engine — Utility Functions
 *
 * Seeded random number generator and probability distribution utilities
 * for deterministic, repeatable bot behavior simulation.
 */

// ═══════════════════════════════════════════════════════════════
// Seeded PRNG (Mulberry32)
// ═══════════════════════════════════════════════════════════════

/**
 * Mulberry32 — fast, high-quality 32-bit PRNG.
 * Produces the same sequence for a given seed, ensuring
 * each bot's behavior is deterministic and reproducible.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed | 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a hash seed from a string (e.g. bot userId).
 */
export function hashStringToSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash) || 1;
}

// ═══════════════════════════════════════════════════════════════
// Probability Distributions
// ═══════════════════════════════════════════════════════════════

/**
 * Box-Muller transform for normal (Gaussian) distribution.
 * @returns A value from N(mean, stdDev)
 */
export function normalRandom(
  random: () => number,
  mean: number,
  stdDev: number,
): number {
  const u1 = Math.max(1e-10, random());
  const u2 = random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

/**
 * Log-normal distribution — useful for response times (always positive, right-skewed).
 * @returns A positive value with the given mean and spread.
 */
export function logNormalRandom(
  random: () => number,
  mean: number,
  spread: number = 0.5,
): number {
  const normal = normalRandom(random, Math.log(mean), spread);
  return Math.max(0.1, Math.exp(normal));
}

/**
 * Exponential distribution — useful for time-between-events.
 * @returns A value from Exp(rate) where rate = 1/mean
 */
export function exponentialRandom(
  random: () => number,
  mean: number,
): number {
  return -mean * Math.log(Math.max(1e-10, random()));
}

/**
 * Weighted random selection from an array of options.
 */
export function weightedRandom<T>(
  random: () => number,
  options: Array<{ item: T; weight: number }>,
): T {
  const totalWeight = options.reduce((sum, o) => sum + o.weight, 0);
  let r = random() * totalWeight;

  for (const option of options) {
    r -= option.weight;
    if (r <= 0) return option.item;
  }

  return options[options.length - 1].item;
}

/**
 * Random integer in [min, max] inclusive.
 */
export function randomInt(random: () => number, min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

/**
 * Pick a random element from an array.
 */
export function randomPick<T>(random: () => number, arr: T[]): T {
  return arr[Math.floor(random() * arr.length)];
}

/**
 * Shuffle an array (Fisher-Yates) — returns a new array.
 */
export function shuffleArray<T>(random: () => number, arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// Time Utilities
// ═══════════════════════════════════════════════════════════════

/**
 * Get the current hour (0-23) in a given IANA timezone.
 */
export function getCurrentHourInTimezone(timezone: string): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(formatter.format(now), 10);
}

/**
 * Get current day of week (0=Sun, 6=Sat) in a given timezone.
 */
export function getCurrentDayInTimezone(timezone: string): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return dayMap[formatter.format(now)] ?? 0;
}

/**
 * Clamp a number to [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Generate a unique event ID.
 */
export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Add jitter to a timestamp (+/- percent).
 */
export function addJitter(date: Date, percent: number, random: () => number): Date {
  const jitterMs = date.getTime() * percent * (random() - 0.5) * 2;
  return new Date(date.getTime() + jitterMs);
}
