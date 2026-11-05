# V20 §2-P0-2 · 生产使用基线（首次测量）

> 采集时间：2026-11-04 15:36–15:45 (GMT+8)
> 采集方式：Turso HTTP 只读管线（`POST /v2/pipeline`，**仅 `SELECT`**），数据库连接取自 `nexus-app/.env`（`DATABASE_URL` + `TURSO_AUTH_TOKEN`）
> 采集人：WorkBuddy 巡检 #1077
> 声明：本文所有数字均为库内聚合查询结果；不含任何明文凭据、用户邮箱或目标原文。

---

## 1. 为什么需要这份基线

V19.9 T-4 上线后，全部验收证据来自三类**测试**（`prod-smoke 15/15`、`public-origin 13/0`、`payment-off 18/18`）与一个**基础设施探针**（`/api/health`）。三者都无法回答一个更基本的问题：

> 生产环境上，有没有**真实用户**走通过一次 `提交目标 → 授权 → 执行 → 看到已验证结果`？

在缺这条基线的情况下，「16 PASS / 1 BLOCKED」被当成项目健康度读，实际只反映测试套件覆盖度。

---

## 2. 执行闭环基线（核心）

### 2.1 AgentRun

| 指标 | 值 |
| --- | --- |
| 总量 | **3** |
| 时间跨度 | 2026-10-20T13:14:55Z ~ 13:23:57Z（**9 分钟内**） |
| 状态分布 | `PROPOSED` 2 · `FAILED` 1 |
| `EXECUTED` | 0 |
| `AWAITING_APPROVAL` | 0 |
| 技能分布 | `INTENT_EXTRACTION` 3 / 3 |
| `requiresApproval` | 0（三次均为 false） |
| 归属组织（去重） | 1 |

### 2.2 下游表全部为空

| 表 | 行数 |
| --- | --- |
| `AgentApproval` | **0** |
| `ConsentRequest` | **0** |
| `ConsentGrant` | **0** |
| `Outcome` | **0** |
| `OutcomeVerification` | **0** |

### 2.3 归属组织为 QA，不是真实用户

| id | name | slug | createdAt |
| --- | --- | --- | --- |
| `org_default` | Default Organization | `default` | 2026-10-10 07:14 |
| `757eee19-…` | **LokFeel Preview** | `preview` | 2026-10-20T11:51:49Z |

3 次运行全部落在 `LokFeel Preview`，且发生在其创建后 **82 分钟**内 ⇒ 属 `grant-preview-org.mjs` 一类的预发脚本活动。

**结论：真实用户 Agent 使用量 = 0；生产闭环从未跑通一次。**

### 2.4 唯一失败运行

| 字段 | 值 |
| --- | --- |
| `status` | `FAILED` |
| `degradeCode` | `NO_DEGRADE_PATH` |
| `reason` | 模型输出未通过契约校验：`version Invalid input: expected "1.2"`，且规则式兜底未识别出目标类型 |
| `skill` / `risk` | `INTENT_EXTRACTION` / `LOW` |

**根因链**：system prompt 只说「必须符合 WorkspaceSpec 契约」，而契约本体从未随请求发出 ⇒ 模型自行编造 `version` ⇒ `z.strictObject` 拒绝 ⇒ 规则兜底也失败 ⇒ `FAILED`。

**修复状态（已核验，非采信文档）**：
- 提交 `003bee5 fix(agent): 意图抽取把契约抄进提示词（真实调用第一次跑就挂在 version）`
- 修复方式：`INTENT_OUTPUT_SKELETON` 用 `${WORKSPACE_SPEC_VERSION}`（`src/lib/workspace-spec/schema.ts:50` = `'1.2'`）插值进 prompt，避免"提示词与契约各改一份"
- **是否在线上构建内**：`git show 79459d6:src/lib/agent/skills.ts | grep -c INTENT_OUTPUT_SKELETON` → **2** ⇒ ✅ 在
- **是否被生产复验**：❌ 否。10-20 之后 `AgentRun` 新建 **0** ⇒ 修复在生产上仍是"未验证"

> 这条区分很重要：**"修复已部署" 与 "修复已被证明有效" 是两件事**。前者有证据（commit 在构建内），后者无证据（无运行样本）。

---

## 3. 需求侧基线

| 指标 | 值 |
| --- | --- |
| `User` 总量 | 12,922 |
| 其中真实（`isBot=0`） | 1,584 |
| 其中 Bot（`isBot=1`） | 11,338 |
| 真实用户近 7 天注册 | **0** |
| 真实用户近 30 天注册 | **0** |
| 真实用户近 90 天注册 | **1** |
| `AnalyticsEvent` 近 7 天 | 384 |
| `AnalyticsEvent` 最后写入 | **2026-10-31T01:55:01Z** ⇒ 已 **4 天+ 零事件** |
| `Match` 近 7 天 | 0 |

---

## 4. 基础设施基线（同时段，供对照）

| 面 | 值 |
| --- | --- |
| `/api/health` | 200 `healthy`，`commit=79459d6`，`builtAt=2026-11-03T04:23:12Z` |
| TTFB（3 连采，稳态） | health 1.03 / 1.14 / 1.16s；landing 1.51 / 1.12 / 1.25s |
| TTFB（冷启，首采） | 12.21s |
| `dbLatency` | 冷启 5018ms → 稳态 58 / 30ms |
| `redis` | `upstash` / configured / `degradeCount=0` |
| `firebaseAdmin` | sdkLoaded·configured·initialized 三真，`appCount=1` |
| `botModule` | enabled(env)，`warnings=[]` |
| `payments` | configured/charging 双 false；缺 4 密钥，`malformed=[]` |

> **并置阅读**：基础设施全绿 **且** 真实使用量为 0。二者不矛盾——它们测量的是不同东西。把前者当项目健康度会系统性误判。

---

## 5. 复现方法

```bash
cd ~/WorkBuddy/20260402202519/nexus-app
# 仅 SELECT；token 从 .env 读取，不落盘
python3 - <<'PY'
import json,urllib.request
def load(f):
    d={}
    for line in open(f):
        line=line.strip()
        if line and not line.startswith('#') and '=' in line:
            k,v=line.split('=',1); d[k]=v.strip().strip('"').strip("'")
    return d
e=load('.env'); url=e['DATABASE_URL'].replace('libsql://','https://'); tok=e['TURSO_AUTH_TOKEN']
def q(sql):
    body=json.dumps({"requests":[{"type":"execute","stmt":{"sql":sql}},{"type":"close"}]}).encode()
    r=urllib.request.Request(url+'/v2/pipeline',data=body,
        headers={'Authorization':'Bearer '+tok,'Content-Type':'application/json'})
    res=json.loads(urllib.request.urlopen(r,timeout=40).read())['results'][0]
    rs=res['response']['result']; cols=[c['name'] for c in rs['cols']]
    return [dict(zip(cols,[c.get('value') for c in row])) for row in rs['rows']]
print(q("SELECT status, COUNT(*) n FROM AgentRun GROUP BY status"))
print(q("SELECT COUNT(*) n, MIN(createdAt) f, MAX(createdAt) l FROM AgentRun"))
PY
```

---

## 6. 这份基线改变了什么

| 原判断 | 基线后的判断 |
| --- | --- |
| 剩余 4 项阻塞「全部解掉就收敛」 | ❌ 解掉后真实使用量仍是 0 |
| A-03b 是 P0，因为它让 16/17 | ⚠️ A-03b 是**测试缺口**，不是**用户阻塞**；真实用户根本没走到那一步 |
| health 绿 = 项目健康 | ❌ health 只覆盖基础设施；使用量需单独测 |
| 瓶颈是 push 凭据 | ⚠️ push 凭据只解锁"代码上线"；真实瓶颈是**没有用户跑完闭环** |

**建议的 P0 重定义**：从「关 A-03b（17 PASS）」改为「让 10 个真实用户各跑完一次 `目标 → 授权 → 执行 → 已验证结果`」。前者是测试绿灯，后者是产品存活判据。
