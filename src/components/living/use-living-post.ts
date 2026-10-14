'use client'

/**
 * P2 · Living 写操作的**统一出口**。
 *
 * 为什么单列一个 hook（而不是每处 `fetch` 一遍）：
 *
 *   ① **「成功」的判据只有一条** —— 服务端返回了数据。2xx 但信封 `success:false`、
 *      或响应体无法解析，一律按失败处理。"乐观成功"是这类接线最典型的自欺。
 *   ② **错误文案原文优先**：走信封的 `error.message`（服务端说的是准的）。
 *      409 尤其重要 —— 例如"该运行已有裁决，不可改判"被概括成"操作失败"之后，
 *      用户就分不清是撞了状态机、还是没权限。
 *   ③ `pendingUrl` 让按钮能准确显示"哪一个动作在飞"，而不是全局 loading
 *      （三个区同屏时，全局 loading 会让用户以为整个页面卡住）。
 */

import { useCallback, useState } from 'react'

interface ApiErrorShape {
  code?: string
  message?: string
}
interface ApiEnvelopeShape<T> {
  success?: boolean
  data?: T
  error?: ApiErrorShape
}

export interface LivingPostResult<T> {
  ok: boolean
  status: number
  data: T | null
  /** 失败时的可读原因（**原文优先**）；成功时为 null。 */
  message: string | null
}

export function useLivingPost() {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)

  const run = useCallback(async <T,>(url: string, body?: unknown): Promise<LivingPostResult<T>> => {
    setPendingUrl(url)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const json = (await res.json().catch(() => null)) as ApiEnvelopeShape<T> | null

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          data: null,
          message: json?.error?.message ?? `请求被拒绝（HTTP ${res.status}）`,
        }
      }
      if (!json || json.success === false) {
        return {
          ok: false,
          status: res.status,
          data: null,
          message: json?.error?.message ?? '服务端未返回成功信封 —— 按失败处理。',
        }
      }
      if (json.data === undefined) {
        return {
          ok: false,
          status: res.status,
          data: null,
          message: '服务端返回成功但没有数据体 —— 按失败处理（不报告成功）。',
        }
      }
      return { ok: true, status: res.status, data: json.data, message: null }
    } catch (e) {
      return {
        ok: false,
        status: 0,
        data: null,
        message: e instanceof Error ? e.message : '网络错误',
      }
    } finally {
      setPendingUrl(null)
    }
  }, [])

  return { run, pendingUrl }
}

/** `/api/v1/*` 的统一信封（与 `src/lib/api-response.ts` 一致）。 */
export interface LivingEnvelope<T> {
  success: boolean
  data: T
  error?: { code: string; message: string }
  meta?: { page: number; pageSize: number; total: number; totalPages: number }
}
