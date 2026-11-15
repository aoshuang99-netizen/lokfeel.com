/**
 * V21 第三批 · C02 —— 审批与执行职责分离的策略常量。
 *
 * 🔴 为什么要有 `policyVersion`：
 *   审计里只写「谁在什么时候批了」不足以回答「按哪一套规则批的」。
 *   本轮把「发起人不得自批」「批准 24h 内有效」写成**服务端策略**，
 *   历史裁决必须能区分「旧策略下的自批」与「新策略下的合规批准」——
 *   否则事后复核无法判断一条 EXECUTED 记录是不是绕过同意机制的产物。
 *
 * 版本语义：**只增不改**。修改规则必须换新版本号，不得原地改常量含义。
 */
export const AGENT_APPROVAL_POLICY_VERSION = 'v21.3-separation-of-duties'

/**
 * 批准的有效期（自 `AgentApproval.decidedAt` 起算）。
 *
 * 为什么需要过期：批准覆盖的是「当时那份产出 + 当时的披露授权」。
 * 无限期有效等于让一次点击永久授权后续所有执行，与「撤销即刻生效」相冲突。
 * 24h 是保守默认值：超过即要求重新批准（而不是静默沿用旧批准）。
 */
export const AGENT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000

/** 职责分离被违反时的稳定错误码（客户端按码分支，不解析文案）。 */
export const SELF_APPROVAL_FORBIDDEN = 'SELF_APPROVAL_FORBIDDEN'
/** 批准已过期时的稳定错误码。 */
export const APPROVAL_EXPIRED = 'APPROVAL_EXPIRED'
