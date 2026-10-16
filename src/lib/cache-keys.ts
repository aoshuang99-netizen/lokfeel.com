/**
 * 缓存键的**单一来源**（AC-10 · 数据生命周期）
 *
 * ## 为什么把键集中到这里
 *
 * AC-10 要求「缓存/索引清理**按政策生效**」。要做到"按政策生效"，删除侧就必须
 * 能**精确列出**该失效哪些键 —— 而如果键在各调用点就地拼接（形如 `auth:user:<id>` 的模板串），
 * 删除侧只剩两种选择：把每个位置都记住（**必然漂移**），或者全局 flush（误伤）。
 *
 * 漂移的失败方式是**静默的**：某处把 `auth:user:` 改成 `auth:user:v2:`，
 * 删除照旧返回 200、审计照旧写、单测照旧绿 —— 只是这个人的邮箱与昵称
 * 在缓存里**多活了 90 秒**。所以键必须只有一份定义，且删除侧与写入侧**引用同一个函数**。
 *
 * ## 两类键：本人键 vs 引用他人的键（🔴 二者处理方式不同）
 *
 *   1. **本人键**（`userScopedCacheKeys`）—— 内容只关于该用户自己。
 *      可按**精确键**失效，代价 O(1)，不影响任何其他用户。
 *
 *   2. **引用他人的键**（`USER_REFERENCING_CACHE_PREFIXES`）—— 键属于**别人**，
 *      但**值里含该用户的快照**。最典型的是 `who-liked-me:<viewerId>`：
 *      它缓存的是"谁喜欢过我"，其中每一项都是**别的用户**的
 *      `displayName / avatar / age / city / gender / relationshipGoal`
 *      （见 `src/app/api/who-liked-me/route.ts`）。
 *      ⇒ **按 id 找不到它**（键里是 viewerId，不是被销号者的 id），
 *        只能按前缀全局失效。销号是低频事件，全局失效换来的是"确实清干净"。
 *
 * ## 本仓缓存的实际覆盖面（核对结论）
 *
 * 服务端缓存只有 `redisCache`（`@/lib/cache` 是它的别名，不是第二套存储）。
 * 全部写入点是 4 处：`auth:user:` · `settings:` · `discover:profile:` · `who-liked-me:`。
 * 另外 `discover:exclude:` 目前**只被失效、没有写入点**（历史遗留），
 * 仍纳入清单：将来一旦恢复写入，销号侧无需再改。
 *
 * ⚠️ 本模块**必须**保持纯函数、零依赖 —— 它同时被 `auth.ts`（每请求热路径）、
 *    路由与 `lifecycle/erasure.ts` 引用。
 */

/**
 * 全部用户维度的缓存键构造器。
 *
 * 🔴 新增任何"按用户缓存"的键，**必须**在这里加一项，并在
 *    `userScopedCacheKeys()` / `USER_REFERENCING_CACHE_PREFIXES` 里归类。
 */
export const CACHE_KEYS = {
  /** `requireAuth()` 的当前用户快照（含 email / name / image）。TTL 60s。 */
  authUser: (userId: string) => `auth:user:${userId}`,
  /** `/api/settings` 的设置页聚合数据（含 user + profile）。 */
  settings: (userId: string) => `settings:${userId}`,
  /** `/api/discover` 里**当前用户自己**的档案（含 PII）。TTL 120s。 */
  discoverProfile: (userId: string) => `discover:profile:${userId}`,
  /** `/api/discover` 的排除名单（**只存 id**，不含 PII）。 */
  discoverExclude: (userId: string) => `discover:exclude:${userId}`,
  /** `/api/who-liked-me` 的结果（🔴 值里含**别人的**档案快照）。TTL 60s。 */
  whoLikedMe: (userId: string) => `who-liked-me:${userId}`,
} as const

/**
 * 只关于**本人**的缓存键 —— 销号时按精确键失效即可。
 *
 * 顺序固定（便于报告与测试逐字比对）。
 */
export function userScopedCacheKeys(userId: string): string[] {
  return [
    CACHE_KEYS.authUser(userId),
    CACHE_KEYS.settings(userId),
    CACHE_KEYS.discoverProfile(userId),
    CACHE_KEYS.discoverExclude(userId),
  ]
}

/**
 * 🔴 **值里可能含该用户快照**、但键属于**他人**的缓存前缀 —— 销号必须按前缀全局失效。
 *
 * 不放进 `userScopedCacheKeys()` 的原因：它不是"这个人的键"，
 * 所以既无法用 id 定位，也不该被"只清本人"的逻辑误解为可精确失效。
 */
export const USER_REFERENCING_CACHE_PREFIXES = ['who-liked-me:'] as const
