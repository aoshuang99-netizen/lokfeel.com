/**
 * T06 · Workflow Execution 运行时统一出口
 *
 * 使用约定（与 `src/lib/connection/index.ts` 同一风格）：
 *   - 路由层只 import 本文件，不深入具体实现文件；
 *   - **对外投递一律经 `deliverNotification()`** —— 它是披露守卫与沙箱判定的唯一入口；
 *   - **业务写之后调 `hooks.ts` 的钩子**，不要直接拼装任务入队。
 *
 * 分层的依赖方向（单向，无环）：
 *
 *   job-core（纯函数）
 *      ↑
 *   stage-machine（纯函数）   delivery（投递出口）
 *      ↑                          ↑
 *   workflow（阶段持久化） ────► runtime（引擎）
 *                                  ↑
 *                              hooks（业务钩子）
 */

// ── 内核纯函数：任务与退避 ──
export {
  TERMINAL_JOB_STATUSES,
  DEFAULT_BACKOFF,
  DEFAULT_LEASE_MS,
  DEFAULT_STAGE_TIMEOUT_MS,
  JobFailure,
  decideAfterFailure,
  deliveryDedupeKey,
  failureKindOf,
  isClaimable,
  isJobFailure,
  isLeaseAlive,
  isStageTimedOut,
  isTerminalJobStatus,
  jobDedupeKey,
  leaseExpiry,
  nextBackoffMs,
  stageTimeoutLabel,
  type BackoffPolicy,
  type FailureKind,
  type JobOutcome,
  type WorkflowJobKind,
  type WorkflowJobStatus,
} from './job-core'

// ── 内核纯函数：阶段状态机 ──
export {
  STAGE_LABELS,
  STAGE_ORDER,
  appendTimeline,
  applyEvent,
  isStageAdvance,
  isTerminalStage,
  stageIndex,
  type TimelineEntry,
  type WorkflowEvent,
  type WorkflowStage,
} from './stage-machine'

// ── 通知内容与披露边界 ──
export {
  LEAK_MIN_OVERLAP,
  NOTIFICATION_TEMPLATES,
  NotificationLeakError,
  SENDER_ATTRIBUTION_SUFFIX,
  assertNoLeakage,
  hasSenderAttribution,
  isNotificationTemplate,
  longestCommonSubstringLength,
  renderNotification,
  type NotificationTemplate,
  type RenderInput,
  type RenderedNotification,
} from './notification-content'

// ── 统一投递出口（站内信 + 邮件沙箱）──
export {
  createResendSender,
  deliverNotification,
  resolveEmailSender,
  type DeliveryDeps,
  type DeliveryInput,
  type DeliveryResult,
  type DeliveryStatus,
  type EmailSender,
  type NotificationChannel,
} from './delivery'

// ── 阶段持久化与运营视图 ──
export {
  ATTENTION_JOB_STATUSES,
  advanceIntroductionWorkflow,
  ensureIntroductionWorkflow,
  getIntroductionWorkflow,
  getWorkflowOverview,
  listIntroductionWorkflows,
  listWorkflowJobs,
  type AdvanceWorkflowInput,
  type AdvanceWorkflowResult,
  type EnsureWorkflowInput,
  type IntroductionWorkflowView,
  type WorkflowJobView,
  type WorkflowOverview,
} from './workflow'

// ── 引擎 ──
export {
  DEFAULT_TICK_BUDGET_MS,
  DEFAULT_TICK_LIMIT,
  cancelJobsForProposal,
  claimJobs,
  enqueueJob,
  executeJob,
  isLeakageError,
  readPayload,
  releaseLeases,
  requeueJobManually,
  runWorkflowTick,
  takeOverJob,
  type ClaimOptions,
  type ClaimedJob,
  type EnqueueJobInput,
  type EnqueueResult,
  type ExecuteDeps,
  type ExecuteOutcome,
  type ExecuteResult,
  type JobPayload,
  type TickOptions,
  type TickReport,
} from './runtime'

// ── 业务钩子 ──
export {
  FOLLOWUP_DELAY_MS,
  onConnectionIntroduced,
  onConsentDecided,
  onProposalCreated,
  reconcileMissingJobs,
  type HookResult,
  type ProposalRef,
} from './hooks'

// ── 运营告警（R9：死信主动推送）──
export {
  DEFAULT_ALERT_ORG_LIMIT,
  OPERATOR_ALERT_ACTION_URL,
  OPERATOR_ALERT_TEMPLATE,
  alertDayKey,
  alertOperatorsOfAttention,
  findOrgsWithAttention,
  listAlertRecipients,
  operatorAlertDedupeKey,
  type AttentionAlertReport,
} from './alerts'
