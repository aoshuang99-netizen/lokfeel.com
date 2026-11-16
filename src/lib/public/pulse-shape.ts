/**
 * `/api/v1/public/pulse` 的**响应形状**（客户端安全：本文件不 import 任何服务端模块）。
 *
 * 首页的「活数据」区块与端点共用这份类型，避免两边各写一份字段名而静默漂移。
 *
 * 🔴 语义约定（不要在展示层篡改）：
 *   · `activity === null` 表示**聚合暂时不可用**（DB 未配置 / 查询失败），
 *     **不是 0**。展示层必须显示「—」，不得显示 0，更不得替代为示例数字。
 *   · `verifiedOutcomes` 只统计 `verificationLevel ∈ {COUNTERPARTY_CONFIRMED, EXTERNALLY_VERIFIED}`。
 *     **`SELF_REPORTED` 不算验证成功** —— 这是 AC-15 的字面要求。
 *   · 所有数字都是**跨租户聚合计数**，不含任何租户标识、用户标识或业务内容。
 */

export const PULSE_WINDOW_DAYS = 30

/**
 * 聚合活动窗口（30 天）。
 *
 * 🔴 每个字段都可以是 `null`：某一张表缺失（例如迁移还没应用）时，
 * **只把那一项**置 null，其余照常给数。这样首页不会因为一个新表未迁移
 * 就从「有数」退化成「全横杠」。`null` 在展示层恒为「—」。
 */
export interface PulseActivity {
  /** 窗口内新建的任务数。 */
  missions: number | null
  /** 窗口内发起的 Agent 运行数（含被拒绝的）。 */
  runs: number | null
  /** 窗口内由**另一主体**做出的批准/拒绝裁决数（职责分离的正面证据）。 */
  decisions: number | null
  /** 窗口内达到「对手方确认」或「外部核验」的成果数。 */
  verifiedOutcomes: number | null
}

export interface PulseStage {
  stage: string
  count: number
}

export interface PublicPulse {
  asOf: string
  windowDays: number
  capabilities: {
    /** `SKILL_KEYS.length`，直接取自代码。 */
    skills: number
    /** `INTEROP_TOOL_NAMES.length`，直接取自代码。 */
    mcpTools: number
    /** `WORKSPACE_SPEC_VERSION`，直接取自代码。 */
    specVersion: string
  }
  activity: PulseActivity | null
  /** 窗口内编排阶段事件分布（前若干名），用于画真实的阶段条。 */
  stages: PulseStage[]
  /** `activity === null` 时的**机器可读**原因，不写营销话术。 */
  note?: string
}
