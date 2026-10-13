/**
 * T09 · 批准状态机 —— AC-08「注入不得绕过审批」的**结构性**证据
 *
 * 这里断言的是**边不存在**，而不是"某个函数返回了 false"：
 * 只要 `AWAITING_APPROVAL → EXECUTED` 不在迁移表里，
 * 那么无论模型输出什么文本，都**没有代码路径**能从"待批"走到"已执行"。
 */

import {
  APPROVAL_TRANSITIONS,
  AgentTransitionError,
  TERMINAL_STATUSES,
  assertExecutable,
  assertTransition,
  canExecute,
  canTransition,
  isTerminal,
  nextStatuses,
} from '@/lib/agent'
import { AGENT_RUN_STATUSES } from '@/lib/agent'

describe('迁移真相表', () => {
  it('🔴 AWAITING_APPROVAL 不能直达 EXECUTED（这就是"绕不过审批"）', () => {
    expect(APPROVAL_TRANSITIONS.AWAITING_APPROVAL).not.toContain('EXECUTED')
    expect(canTransition('AWAITING_APPROVAL', 'EXECUTED')).toBe(false)
  })

  it('非高风险技能：PROPOSED 可直接 EXECUTED', () => {
    expect(canTransition('PROPOSED', 'EXECUTED')).toBe(true)
  })

  it('PROPOSED 不能直接 APPROVED（没有东西处于"待批"）', () => {
    expect(canTransition('PROPOSED', 'APPROVED')).toBe(false)
  })

  it('只有 APPROVED 能执行"需要批准"的结果', () => {
    expect(canTransition('APPROVED', 'EXECUTED')).toBe(true)
  })

  it('降级结果同样要走批准（降级不降低门槛）', () => {
    expect(nextStatuses('DEGRADED')).toContain('AWAITING_APPROVAL')
    expect(canTransition('DEGRADED', 'APPROVED')).toBe(false)
  })

  it('终态不再接受任何迁移', () => {
    expect(TERMINAL_STATUSES).toEqual(expect.arrayContaining(['EXECUTED', 'REJECTED', 'FAILED', 'BLOCKED_QUOTA']))
    for (const s of TERMINAL_STATUSES) {
      expect(isTerminal(s)).toBe(true)
    }
  })

  it('每个状态都有显式条目（防止漏配后 `nextStatuses` 静默返回空 —— 那会"看起来像终态"）', () => {
    for (const s of AGENT_RUN_STATUSES) {
      expect(Object.prototype.hasOwnProperty.call(APPROVAL_TRANSITIONS, s)).toBe(true)
    }
  })

  it('迁移目标都是合法状态名（防止拼写错误造出"到不了的状态"）', () => {
    for (const from of AGENT_RUN_STATUSES) {
      for (const to of APPROVAL_TRANSITIONS[from]) {
        expect(AGENT_RUN_STATUSES).toContain(to)
      }
    }
  })
})

describe('canExecute', () => {
  it('需批准的动作：只有 APPROVED 放行', () => {
    expect(canExecute('APPROVED', true)).toBe(true)
    expect(canExecute('AWAITING_APPROVAL', true)).toBe(false)
    expect(canExecute('PROPOSED', true)).toBe(false)
    expect(canExecute('DEGRADED', true)).toBe(false)
    expect(canExecute('REJECTED', true)).toBe(false)
  })

  it('不需批准的动作：PROPOSED / DEGRADED 放行', () => {
    expect(canExecute('PROPOSED', false)).toBe(true)
    expect(canExecute('DEGRADED', false)).toBe(true)
    expect(canExecute('AWAITING_APPROVAL', false)).toBe(false)
  })
})

describe('assertExecutable / assertTransition', () => {
  it('非法执行会抛 AgentTransitionError，且带上可读原因', () => {
    expect(() => assertExecutable('AWAITING_APPROVAL', true)).toThrow(AgentTransitionError)
    try {
      assertExecutable('AWAITING_APPROVAL', true)
    } catch (err) {
      expect((err as Error).message).toContain('人工批准')
    }
  })

  it('合法执行不抛错', () => {
    expect(() => assertExecutable('APPROVED', true)).not.toThrow()
    expect(() => assertExecutable('PROPOSED', false)).not.toThrow()
  })

  it('非法迁移抛错、合法迁移不抛', () => {
    expect(() => assertTransition('REJECTED', 'EXECUTED')).toThrow(AgentTransitionError)
    expect(() => assertTransition('AWAITING_APPROVAL', 'APPROVED')).not.toThrow()
  })
})
