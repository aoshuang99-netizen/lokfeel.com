/**
 * T03 · 主体档案（披露投影的**数据源**）
 *
 * 设计要点：**不复制字段值**。披露表只记录"哪些字段给谁看"，字段值在投影时
 * 从 User / Profile **实时读取**。理由：
 *   1. 复制会立刻产生"档案改了、意图里还是旧值"的不一致，而披露投影正是最不能出错的地方；
 *   2. 副本本身就是 PII 扩散（多一份落库就多一处泄露面）。
 *
 * 字段映射刻意与 `field-catalog.ts` 逐键对齐：
 *   `avatar` → `avatarUrl`（目录用语义化的键名，而不是照抄 DB 列名），
 *   `email` 来自 **User**（不是 Profile）—— 这类"看起来该在档案里、其实在账户上"的字段
 *   最容易在投影时被漏掉或写错，因此用纯函数 `mapProfileRow()` 集中处理并被单测钉死。
 */

import { db } from '@/lib/db'
import { decodeStringArray } from './json-codec'
import type { SubjectProfile } from './disclosure'

/** 投影所需的 Profile 列（**显式列举**，不 `select *` —— 新列默认不进入披露链路）。 */
export const SUBJECT_PROFILE_SELECT = {
  displayName: true,
  avatar: true,
  bio: true,
  city: true,
  country: true,
  occupation: true,
  company: true,
  industry: true,
  age: true,
  genderIdentity: true,
  relationshipGoal: true,
  selectedTags: true,
  lifePriorities: true,
} as const

interface ProfileRow {
  displayName?: string | null
  avatar?: string | null
  bio?: string | null
  city?: string | null
  country?: string | null
  occupation?: string | null
  company?: string | null
  industry?: string | null
  age?: number | null
  genderIdentity?: string | null
  relationshipGoal?: string | null
  selectedTags?: string | null
  lifePriorities?: string | null
}

/**
 * 纯函数：把 (User.email, Profile 行) 映射为 `SubjectProfile`。
 * 无 DB 依赖，因此可以在单测里逐字段断言"哪个键取自哪张表"。
 */
export function mapProfileRow(
  userEmail: string | null | undefined,
  profile: ProfileRow | null | undefined
): SubjectProfile {
  const p: ProfileRow = profile ?? {}
  return {
    displayName: p.displayName ?? null,
    avatarUrl: p.avatar ?? null,
    bio: p.bio ?? null,
    city: p.city ?? null,
    country: p.country ?? null,
    occupation: p.occupation ?? null,
    company: p.company ?? null,
    industry: p.industry ?? null,
    // 多值字段统一走 codec（`selectedTags` / `lifePriorities` 都是 JSON 文本列）。
    selectedTags: p.selectedTags ? decodeStringArray(p.selectedTags) : null,
    lifePriorities: p.lifePriorities ? decodeStringArray(p.lifePriorities) : null,
    age: typeof p.age === 'number' ? p.age : null,
    genderIdentity: p.genderIdentity ?? null,
    relationshipGoal: p.relationshipGoal ?? null,
    // ⚠️ 来自 User 表，不是 Profile 表。
    email: userEmail ?? null,
  }
}

/** 读取某用户的主体档案。用户不存在 → null（调用方按"无档案"处理，不抛异常）。 */
export async function loadSubjectProfile(userId: string): Promise<SubjectProfile | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, profile: { select: SUBJECT_PROFILE_SELECT } },
  })
  if (!user) return null
  return mapProfileRow(user.email, user.profile)
}

/**
 * 批量读取（组织者视图用，避免 N+1）。
 * 返回 `Map<userId, SubjectProfile>`；查不到的用户不在 Map 里（调用方按空档案处理）。
 */
export async function loadSubjectProfiles(
  userIds: string[]
): Promise<Map<string, SubjectProfile>> {
  const out = new Map<string, SubjectProfile>()
  if (userIds.length === 0) return out

  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, profile: { select: SUBJECT_PROFILE_SELECT } },
  })
  for (const u of users) {
    out.set(u.id, mapProfileRow(u.email, u.profile))
  }
  return out
}
