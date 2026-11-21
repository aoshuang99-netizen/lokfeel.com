# 全站禁止假页面/假可视化：数据与组件契约

本文件是 PR/CI 审查契约提案，不是当前项目已经实施的源码。

## 1. 所有用户可见动态面板的强制字段

```ts
/** 后端投影，需与真实代码 Schema 对齐；前端不可凭空补写服务端状态 */
type EvidenceBoundView<T> =
  | { status: 'loading'; requestId: string }
  | { status: 'ready'; data: T; source: {
      endpointOrQueryId: string; recordIds: string[]; asOf: string;
      permissionScope: 'personal' | 'shared' | 'organization';
      actorId: string; schemaVersion: string; pageInfo?: { total: number; truncated: boolean }
    }}
  | { status: 'empty'; emptyReason: 'NO_RECORDS'; primaryAction: string }
  | { status: 'denied'; code: 'FORBIDDEN' | 'CONSENT_REVOKED' }
  | { status: 'unavailable'; code: 'NOT_CONNECTED' | 'MODEL_UNAVAILABLE' | 'NOT_RELEASED' }
  | { status: 'error'; requestId: string; canRetry: boolean };
```

### 真相要求
- **ready** 只能来自真实请求成功 + 有权限的服务端数据。真实 `recordCount=0` 是 `empty`，不等于网络失败。
- `empty` 显示一个自然语言解释和一个**真实可执行的**下一步动作；不能复用“0%效果”“暂无数据仪表盘”。
- `denied`、`unavailable`、`error` 必须分别呈现，提供实际重试或权限说明；无权限时根本不能把私人数据返回给前端。
- `latest`/`asOf` 来源于数据生成时间；不能用客户端当前时间伪装为“刚刚更新”。
- `verified` 指示必须有独立 verifier ID 和核验等级；如果仅平台收到了消息则写 `SENT`，接收端回执后才写 `DELIVERED`。
- 允许日志中使用无敏感信息的 `requestId`, `sourceQueryId`, `errorCode`，禁止普通日志打印聊天原文、邮箱、密码、AI prompt、私人记忆。

## 2. 图表使用条件

首页、普通聊天页：**默认零图表**。仅显示真实对话和 AI 写作控件。

企业首屏：优先展示 `ActionList`；仅当真实业务记录支持且有价值时展示小型汇总卡。任何趋势图至少同时具备：
1. 真实的事件表或审计视图；时间范围、时区和事件定义明确。
2. 清楚的分子与分母；小样本明确展示 `n`，不能暗示统计显著。
3. 查询权限、组织 ID、最后刷新时间、分页/截断状态。
4. 点击卡片能进入真实关联记录，或直接完成一个有权限的下一步动作。
5. 无数据时不生成随机曲线、不用 `0` 代替网络失败、不创造“成功率100%”。

### Example：组织“待我确认 3”
```
source: GET /api/v1/connections/pipeline?bucket=PENDING_CONSENT (需实际核对实现和授权)
total: 3  # **仅当服务端真实返回该值**
asOf: service-produced timestamp (required for release)
actor: current org member + role
CTA: Open first pending proposal (must open accessible ID)
```
这是 **数据契约示例，不代表当前组织已经有3条提案**。

### Example：Chat “已送达”
```
messageId: real server-issued ID
senderPersistedAt: timestamp (means SENT)
recipientAckId: record-backed value (means DELIVERED)
recipientReadEventId: record-backed value (means READ)
```
没有 recipientAckId 必须是 `SENT` 或 `UNKNOWN`，不可插一个“已送达”勾号。

## 3. PR 静态审查与运行时强制项

对公共页及普通用户默认页扫描：`Mission pipeline`、`WorkspaceSpec`、`INTENT_EXTRACTION`、`Token count`、`5 MCP`、`50 REST routes`、`Outcome verified`、`LokFee!`；出现则必须说明仅位于高级/开发者页面或直接整改。

对组件搜索 `Math.random`, `setTimeout(...success...)`, `placeholder KPI`, `fakeData`, `sample verified`, `readable chart without source`；命中一律需要审查，不等于自动定罪。

每个组件必须至少有：
`normal / loading / empty / failed / denied / mobile / keyboard` 七个状态的测试或明确不适用理由；AI 还需 `unavailable / consent revoked / model timeout`，商业还需 `not approved`。

## 4. 所有面向用户按钮的双向映射

```
UI_ACTION_ID
 → route + authenticated role
 → backend API + input schema
 → permission/consent decision
 → durable state change OR explicit no-op reason
 → visible state feedback
 → reliable server receipt / event id
 → negative case / rollback
```

不能点击的装饰按钮必须删除；确实尚未开放的路线要标 `Coming later`，不可假设按一下就能成功。

## 5. 文案真实性的机器门禁

每条 marketing claim 登记 `claim_id / claim_text / locale / feature_flag / evidence_ref / last_reviewed / owner`，缺证据则在发布构建时不渲染或降级为保守文案。

`SHOW_PRIVATE_AI_MARKETING = REAL_MODEL_PASS && AI_CONSENT_PASS && ALPHA_ENABLED`，**不要**仅由某个 `NEXT_PUBLIC` 环境变量自称“AI已上线”。

`SHOW_PRICE = BUSINESS_APPROVED && VERIFIED_SKU && LEGAL_APPROVED && PROVIDER_ELIGIBLE`，服务端强制；客户端隐藏价格不足以阻止实际 Checkout 创建。
