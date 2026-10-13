/**
 * `/workspace` —— Living Workspace 入口（P0 预览路由）
 *
 * 鉴权在 `layout.tsx` 完成（服务端）；本页只做装配。
 * 数据一律由客户端组件经**真实端点**获取（见 `living-workspace.tsx`），
 * 因此"刷新后状态正确恢复"是端点重取的必然结果，而不是前端存的假状态。
 */
import LivingWorkspace from './living-workspace'

export default function WorkspacePage() {
  return <LivingWorkspace />
}
