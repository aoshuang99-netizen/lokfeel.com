/**
 * AC-10 · 数据生命周期统一出口
 *
 * 分层（单向）：
 *   policy（纯函数 · 保留期清理）
 *   account（纯函数 · 导出清单与删除政策）
 *      ↑
 *   sweep / export / erasure（IO，由上面的纯判定驱动）
 *
 * 使用约定：
 *   - 路由层只 import 本文件；
 *   - **删什么/导出什么**只能由 `policy.ts` / `account.ts` 的判定决定，
 *     不要在别处拼查询条件。
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

export {
  ACCOUNT_EXPORT_VERSION,
  ERASURE_ACTIONS,
  ERASURE_POLICY_VERSION,
  ERASED_DISPLAY_NAME,
  ERASED_EMAIL_DOMAIN,
  EXPORT_ROW_LIMIT,
  PROFILE_REDACTED_FIELDS,
  USER_REDACTED_FIELDS,
  activeErasureActions,
  erasedEmailFor,
  erasedProfilePatch,
  redactProfileForExport,
  redactUserForExport,
  type ErasedProfilePatch,
  type ErasureAction,
  type ErasureActionKind,
} from './account'

export { runLifecycleSweep, type SweepOptions, type SweepReport } from './sweep'

export {
  EXPORT_UNCOVERED,
  exportAccountData,
  type AccountExport,
  type ExportSection,
} from './export'

export {
  executeErasure,
  planErasure,
  type ErasureImpact,
  type ErasurePlan,
  type ErasureResult,
} from './erasure'
