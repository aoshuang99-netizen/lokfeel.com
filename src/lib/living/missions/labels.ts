/**
 * V21 · C05 —— Mission 的用户语言（纯函数，无 IO）
 *
 * 服务端枚举是给机器读的；用户看到的是人话。
 *
 * 🔴 `MISSION_TRANSITIONS` 必须与服务端 `TRANSITIONS`
 *    （src/lib/connection/missions.ts:350）逐格一致：
 *    前端列出"点了必然 409"的按钮，比不给按钮更糟。
 *    漂移由 tests/living/mission-labels.test.ts 钉死。
 */

export type PublicMissionStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED'
export type MissionAction = 'publish' | 'pause' | 'resume' | 'close'

const MISSION_STATUS_LABELS: Record<PublicMissionStatus, string> = {
  DRAFT: '草稿',
  ACTIVE: '进行中',
  PAUSED: '已暂停',
  CLOSED: '已结束',
}

/** 与服务端 TRANSITIONS 同构：action → { from[], to }。 */
const MISSION_TRANSITIONS: Record<MissionAction, { from: PublicMissionStatus[]; to: PublicMissionStatus }> = {
  publish: { from: ['DRAFT', 'PAUSED'], to: 'ACTIVE' },
  pause: { from: ['ACTIVE'], to: 'PAUSED' },
  resume: { from: ['PAUSED'], to: 'ACTIVE' },
  close: { from: ['DRAFT', 'ACTIVE', 'PAUSED'], to: 'CLOSED' },
}

const ACTION_LABELS: Record<MissionAction, string> = {
  publish: '发布',
  pause: '暂停',
  resume: '恢复',
  close: '结束',
}

/** 未知状态抛错：静默显示枚举原文等于把内部状态泄露给用户。 */
export function missionStatusLabel(status: PublicMissionStatus): string {
  const label = MISSION_STATUS_LABELS[status]
  if (!label) throw new Error(`未知的任务状态：${status}`)
  return label
}

export interface MissionTransitionOption {
  action: MissionAction
  label: string
  to: PublicMissionStatus
}

/**
 * 当前状态下**允许发起**的迁移。
 * `canUpdate=false`（无 mission.update 能力）→ 空数组：没有"点了必 403"的按钮。
 */
export function missionTransitions(
  status: PublicMissionStatus,
  canUpdate: boolean,
): MissionTransitionOption[] {
  if (!canUpdate) return []
  return (Object.keys(MISSION_TRANSITIONS) as MissionAction[])
    .filter((action) => MISSION_TRANSITIONS[action].from.includes(status))
    .map((action) => ({ action, label: ACTION_LABELS[action], to: MISSION_TRANSITIONS[action].to }))
}

export function isPublicMissionStatus(value: unknown): value is PublicMissionStatus {
  return (
    typeof value === 'string' &&
    (['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED'] as const).includes(value as PublicMissionStatus)
  )
}
