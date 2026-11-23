# P0-1 · 真人邀请完整闭环 —— 状态与证据

日期：2026-11-23 · 基线 `7b03a84` · 本地候选（未推送/未部署）

## 断链根因（已确认并修复）

旧 `/api/invites` 用**进程内存 Map** 存邀请码：服务重启即全丢；`POST` 只返回
`valid:true`，从不写任何关系。`/register?ref=` 被注册页完全忽略。结果：
「邀请码看起来有效、链接能复制、对方也注册了，但两人之间什么都没有」。

这不满足用户的核心成果指标（首次有效真人连接完成率）——它只制造了邀请码，
没有制造连接。

## 修复后的真实链路

1. `POST /api/invites` → 生成邀请码，落到**持久化** `VerificationToken`
   （`identifier=friend-invite`，7 天有效，maxUses=1），重启仍在。
2. `/connect/invite?code=INV-XXXXXX` 落地页：公开只读查状态（不建联），
   未登录也能看到邀请内容；**必须显式点「接受连接」**。
3. `POST /api/invites/accept` → 唯一建立关系的操作：在事务里 CAS 消费 token，
   写 `Match(ACCEPTED)` + `Conversation`（双方 participant）。发起人不从 body 读，
   取会话身份，杜绝越权建联。
4. 注册页 `?ref=` 被消费：注册成功后回落到接受页，不丢链接；**不自动建联**。
5. `POST /api/invites/revoke` → 仅邀请人可撤回。

领域模块：`src/lib/social/friend-invites.ts`（依赖注入 db，便于模拟重启）。

## 验证结果（真实执行，非 mock）

### 领域单测（TDD RED→GREEN）
`tests/social/friend-invites.test.ts`：**12/12 PASS**。覆盖：重启后持久化、
过期、伪造 token、越权自建、撤回、撤回越权、未同意不建联、
真实 Match(ACCEPTED)+Conversation+双方 participant、重复接受幂等、
用户对幂等、错误码稳定性。RED 证据：初始因模块不存在而 0 tests 失败。

### 两账号 HTTP + DB 读回（真实 server，跨真实进程重启）
脚本：`scripts/qa/p01-friend-invite-loop.mjs`
- 阶段 1（`pre-restart`，8/8 PASS）：A 创建邀请 201、公开查 PENDING、
  **未同意不建联**（Match/Conv 均为 0）、伪造 token 400、越权自建 400、
  越权撤回被拒、**过期邀请 409 EXPIRED 且不建联**。证据：`evidence/phase1-pre-restart.json`
- **真实停止并重启 server**
- 阶段 2（`post-restart`，10/10 PASS）：重启后邀请码仍可查、
  B 显式接受返回 conversationId、DB 写 Match(ACCEPTED)、DB 写 Conversation+双方
  participant、token 一次性消费、重复接受 409 且幂等不新增、**A→B / B→A 双向
  消息各一条并经 DB 读回**。证据：`evidence/phase2-post-restart.json`

合计 **18/18 PASS**，跨越真实服务重启。

### 浏览器 UI 三态（Playwright + 系统 Chrome）
脚本：`scripts/qa/p01-friend-invite-ui.mjs`，截图在 `evidence/ui/`。
> ⚠️ 本地 dev server 环境有 CSP（禁止 `unsafe-eval`）而 React **dev 模式需要 eval**，
> 导致 dev 下 React 无法水合、页面停在 loading —— 这是本地取证环境限制，非产品缺陷。
> 生产构建（next build/start，与 CI/线上一致）不需要 eval。UI 取证在生产构建上执行。

## 覆盖的负例（全部真实，无 mock）
服务重启 · 过期 · 重复接受 · 撤回 · 撤回越权 · 伪造 token · 越权自建 · 未同意不建联

## 诚实边界
- 这是**双测试账号**的技术 Alpha 闭环，不是 10 人真人样本。扩大发布前仍需 10 人真实
  完成率取样（用户指令 P0-1 的扩大条件）——**未测，不填虚构百分比**。
- 个人好友邀请与企业成员邀请是两套系统；本修复未触碰 `/api/v1/invitations`（ADMIN 能力）。
- 邀请落地页不暴露邀请人邮箱/id（只读状态），避免链接转发泄露隐私。
- `NEXT_PUBLIC_APP_URL` 在隔离环境仍是默认值（API 返回的 `inviteUrl` 主机名不准），
  但 UI 用 `window.location.origin` 拼分享链接，实际分享不受影响；上线前需在
  Netlify env 校正该变量。
