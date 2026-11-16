/**
 * Goal-draft relay (V22 总令 §F) — shared helpers for the typed-goal handoff.
 *
 * Flow: landing page (`/` `#goal-input`) → `/register?goal=…` → `/workspace?view=now&goal=…`.
 * The goal must survive signup AND a reload, so it is carried in two places:
 *   1. the `?goal=` query parameter (explicit, per-navigation);
 *   2. `sessionStorage` (survives reload / a dropped query string).
 *
 * Security contract:
 *   - URL values are untrusted. They are ONLY ever returned as plain strings for
 *     React text nodes / `<textarea>` values; never written to innerHTML, never
 *     passed to `dangerouslySetInnerHTML`, never eval'd.
 *   - `withGoal` appends the goal as a QUERY parameter only. It is never placed
 *     in the path portion of any server request URL.
 *   - Everything is normalised (trim + capped at `GOAL_MAX_LENGTH`) before use.
 *
 * The encode/decode/normalise/parse/build functions are pure. Only the two
 * `sessionStorage` helpers perform IO, and both are wrapped in try/catch because
 * storage can be blocked (private mode, disabled storage, SSR).
 */

export const GOAL_DRAFT_STORAGE_KEY = "lokfeel.goal.draft";
export const GOAL_MAX_LENGTH = 240;

/** Trim + cap. Pure, never throws, safe on non-string input. */
export function normalizeGoal(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, GOAL_MAX_LENGTH);
}

/** Pure encode primitive: `encodeURIComponent` of a normalised goal. */
export function encodeGoal(goal: string): string {
  return encodeURIComponent(normalizeGoal(goal));
}

/**
 * Pure decode counterpart to `encodeGoal`. Tolerates malformed `%`-encoding by
 * falling back to the raw (still normalised) text instead of throwing.
 */
export function decodeGoal(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw === "") return "";
  try {
    return normalizeGoal(decodeURIComponent(raw));
  } catch {
    return normalizeGoal(raw);
  }
}

/**
 * Read `?goal=` out of a query string. `URLSearchParams` already decodes `%XX`
 * and `+` for us, so the value is only normalised (no second decode). Pure.
 */
export function readGoalFromSearch(search: string | null | undefined): string {
  if (typeof search !== "string" || search === "") return "";
  try {
    return normalizeGoal(new URLSearchParams(search).get("goal"));
  } catch {
    return "";
  }
}

/** IO: persist the draft. Guarded for SSR and blocked storage. */
export function writeGoalDraft(goal: string): void {
  const normalized = normalizeGoal(goal);
  if (!normalized) return;
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.setItem(GOAL_DRAFT_STORAGE_KEY, normalized);
  } catch {
    // Storage blocked; callers still carry the goal in the query string.
  }
}

/** IO: read the persisted draft. Guarded for SSR and blocked storage. */
export function readGoalDraft(): string {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return "";
    return normalizeGoal(window.sessionStorage.getItem(GOAL_DRAFT_STORAGE_KEY));
  } catch {
    return "";
  }
}

/**
 * Restore a goal: the URL `?goal=` wins (freshest), then `sessionStorage`.
 * SSR-safe (returns "" on the server). Pass `search` to read a specific query
 * string; otherwise the current `window.location.search` is used.
 */
export function restoreGoalDraft(search?: string | null): string {
  const fromUrl = readGoalFromSearch(
    search ?? (typeof window !== "undefined" ? window.location.search : ""),
  );
  return fromUrl || readGoalDraft();
}

/**
 * Append the goal as a `?goal=` / `&goal=` QUERY parameter only (never in the
 * path). Existing params are preserved; a pre-existing `goal` is replaced.
 * Pure. When there is no goal, `base` is returned unchanged.
 *
 * e.g. withGoal("/workspace?view=now", "a & b")
 *      → "/workspace?view=now&goal=a%20%26%20b"
 */
export function withGoal(base: string, goal: string): string {
  const normalized = normalizeGoal(goal);
  if (!normalized) return base;
  const qIndex = base.indexOf("?");
  const path = qIndex === -1 ? base : base.slice(0, qIndex);
  const params = new URLSearchParams(qIndex === -1 ? "" : base.slice(qIndex + 1));
  params.delete("goal");
  const rest = params.toString();
  return `${path}?${rest ? `${rest}&` : ""}goal=${encodeGoal(normalized)}`;
}
