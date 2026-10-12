/**
 * AC-10 · 数据生命周期统一出口
 *
 * 分层（单向）：
 *   policy（纯函数）
 *      ↑
 *   sweep（IO，由 policy 驱动）
 *
 * 使用约定：
 *   - 路由层只 import 本文件；
 *   - **删什么**只能由 `policy.ts` 的判定决定，不要在别处拼查询条件。
 */

export {
  DEFAULT_RETENTION,
  LIFECYCLE_POLICY_VERSION,
  cutoffFor,
  describePolicy,
  policyFromEnv,
  shouldPurgeDelivery,
  shouldPurgeJob,
  shouldPurgeNotification,
  type RetentionPolicy,
} from './policy'

export { runLifecycleSweep, type SweepOptions, type SweepReport } from './sweep'
