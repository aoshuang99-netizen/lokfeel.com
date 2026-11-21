import { Sparkles } from 'lucide-react'

/**
 * GA-08 诚实态：真实模型 Provider 尚未接入时，聊天页必须明确说明 AI 不可用。
 *
 * 不得用静态话术冒充 AI 建议，也不得暗示建议来自模型。这里只呈现事实状态，
 * 普通聊天继续可用；真实 Provider 接入并通过验收前，此组件保持唯一 AI 表达入口。
 */
export function AiWritingUnavailable() {
  return (
    <div
      role="status"
      data-testid="ai-writing-unavailable"
      className="flex items-center gap-2 px-4 py-2 text-xs text-foreground-muted bg-background-secondary border-t border-card-border"
    >
      <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>AI writing isn&apos;t available right now. You can still chat.</span>
    </div>
  )
}
