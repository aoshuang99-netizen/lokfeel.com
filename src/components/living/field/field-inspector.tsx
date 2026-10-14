'use client'

/**
 * P2 · Field —— 详情面板（Selection Inspector）
 *
 * 它回答的是「我点开的这个人/这条提案，**凭什么是这样**」：
 *   - 候选：双向命中的**词元**（可复算的依据，不是分数）+ 经服务端投影的披露字段；
 *   - 提案：对外状态 + 阶段 + **尚不可介绍的原因**（AC-18：禁用必须写明为什么）。
 *
 * 🔴 关于披露字段的一条硬纪律：这里渲染的是服务端**已经投影过**的结果
 *    （`discloseSubject(profile, live, 'CANDIDATE')`）。未被授权到该档的字段，
 *    **键在 JSON 里根本不存在** —— 所以"字段少"是真实的授权状态，不是加载不全。
 *    面板必须把这句写在明面上，否则用户会以为前端漏了字段。
 *
 * 本组件**不放任何按钮**：详情是只读的；动作（发起连接 / 同意 / 介绍）走各自的服务端能力，
 * 由对应视图提供并接受 R2 门禁的"无空按钮"检查。
 */

import { EyeOff, FileText, Info, Link2, ShieldCheck } from 'lucide-react'
import {
  FIELD_BUCKET_LABELS,
  FIELD_PROPOSAL_STATE_LABELS,
  type FieldGraphNode,
} from '@/lib/living/field'

export interface FieldInspectorProps {
  node: FieldGraphNode | null
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-lf-text-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-xs text-lf-text">{value}</dd>
    </div>
  )
}

function TokenList({ title, tokens }: { title: string; tokens: string[] }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-lf-text-faint">{title}</p>
      {tokens.length === 0 ? (
        <p className="mt-0.5 text-xs text-lf-text-faint">（无）</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-1">
          {tokens.map((t) => (
            <li key={t} className="rounded-lf border border-lf-line px-1.5 py-0.5 text-[10px] text-lf-text-muted">
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function FieldInspector({ node }: FieldInspectorProps) {
  if (node === null) {
    return (
      <div className="space-y-2">
        <h2 className="text-sm font-medium">详情</h2>
        <p className="flex items-start gap-2 text-xs text-lf-text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>点选画布上的一个节点（或在列表视图里点一项），这里会显示它的依据与状态。</span>
        </p>
      </div>
    )
  }

  if (node.kind === 'viewer') {
    return (
      <div className="space-y-2">
        <h2 className="text-sm font-medium">网络中心</h2>
        <p className="text-xs text-lf-text">{node.label}</p>
        <p className="text-[11px] text-lf-text-muted">
          关系网络以你为中心：越靠近中心的人，与你的双向互补命中的词元越多。半径只由服务端算好的
          双向命中词元数（matchedTokens）决定，没有任何随机或「看着好看」的调整。
        </p>
      </div>
    )
  }

  if (node.kind === 'candidate' && node.detail) {
    const d = node.detail
    return (
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">候选 · {node.label}</h2>
          <p className="mt-0.5 text-[11px] text-lf-text-faint">
            强度 {Math.round(node.depth * 100)}%（本图内归一化） · 双向命中 {d.matchedTokens} 个词元
          </p>
        </div>

        {!d.named && (
          <p className="flex items-start gap-2 rounded-lf border border-lf-line p-2 text-[11px] text-lf-text-muted">
            <EyeOff className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>
              对方没有授权任何可命名的字段（如显示名）给「同任务的伙伴」这一档 ——
              所以这里用标识代替，不编造姓名。
            </span>
          </p>
        )}

        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-lf-text-muted">
            <Link2 className="h-3 w-3" aria-hidden="true" />
            互补依据（可复算）
          </h3>
          <TokenList title="我的需要 ↔ 对方的供给" tokens={d.evidence.myNeedTheirsOffer} />
          <TokenList title="对方的需要 ↔ 我的供给" tokens={d.evidence.theirNeedMyOffer} />
          <p className="text-[10px] text-lf-text-faint">
            以上是<strong className="font-medium">实际命中的词元</strong>，不是概率或百分比。两侧都有命中才算双向互补。
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-lf-text-muted">
            <FileText className="h-3 w-3" aria-hidden="true" />
            参与匹配的正文
          </h3>
          <Row label="对方的诉求" value={d.need || '（空）'} />
          <Row label="对方能提供" value={d.offer || '（空）'} />
        </section>

        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-lf-text-muted">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            已授权给我的档案字段（{d.disclosed.length}）
          </h3>
          {d.disclosed.length === 0 ? (
            <p className="text-[11px] text-lf-text-muted">
              对方未授权任何档案字段给这一档受众。
              <strong className="font-medium">「字段少」本身就是真实的授权状态</strong> ——
              服务端会把未授权字段的键直接删掉，所以这里不是「前端漏了」。
            </p>
          ) : (
            <dl className="space-y-1.5">
              {d.disclosed.map((f) => (
                <Row key={f.key} label={f.label} value={f.value} />
              ))}
            </dl>
          )}
        </section>
      </div>
    )
  }

  if (node.kind === 'proposal' && node.proposal) {
    const p = node.proposal
    return (
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">提案 · {node.label}</h2>
          <p className="mt-0.5 text-[11px] text-lf-text-faint">
            {FIELD_PROPOSAL_STATE_LABELS[p.state] ?? p.state}
            {p.stalled ? ' · ⚠ 停在非终态阶段超时' : ''}
          </p>
        </div>

        <dl className="space-y-1.5">
          <Row label="运营分桶" value={FIELD_BUCKET_LABELS[p.bucket] ?? p.bucket} />
          <Row label="创建时间" value={new Date(p.createdAt).toLocaleString()} />
          {p.introducedAt !== null && <Row label="已介绍于" value={new Date(p.introducedAt).toLocaleString()} />}
          {p.stage !== null && <Row label="工作流阶段（服务端原名）" value={p.stage} />}
        </dl>

        <section className="space-y-1.5">
          <h3 className="text-[11px] font-medium text-lf-text-muted">介绍执行点</h3>
          {p.canIntroduce ? (
            <p className="rounded-lf border border-lf-success/40 p-2 text-[11px] text-lf-success">
              此刻可执行「介绍」—— 与接口 POST /connections/:id/introduce 是
              <strong className="font-medium">同一判据</strong>，不存在「按钮能点但接口拒绝」的漂移。
            </p>
          ) : (
            <ul className="space-y-1">
              {p.blockers.map((b) => (
                <li key={b.code} className="rounded-lf border border-lf-line p-2 text-[11px] text-lf-text-muted">
                  尚不可介绍：{b.label}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-[10px] text-lf-text-faint">
          本图不把提案连向具体候选：服务端的运营投影刻意不含双方身份，
          连起来就是编造一条服务端没说过的关系。
        </p>
      </div>
    )
  }

  return <p className="text-xs text-lf-text-muted">该节点没有可展示的详情。</p>
}
