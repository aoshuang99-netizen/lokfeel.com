# Living Connection OS — P1 Generative Workspace 交付记录

> 阶段定义见 `02-plan.md`。本文只记录**已交付的事实与证据**，不含计划。
> 承 `03-changes-p0.md`。

## 1. 交付物

| 文件 | 作用 |
|---|---|
| `src/lib/workspace-spec/schema.ts` | **`WorkspaceSpec` 契约**：zod **严格对象** + 节点类型**白名单**（`agent` 属保留类型，不可产出） |
| `src/lib/workspace-spec/compile.ts` | **Intent-to-UI Compiler**：自然语言 → 受约束 spec（规则式、纯函数、确定性） |
| `src/lib/workspace-spec/index.ts` | 模块出口 |
| `src/components/living/node-card.tsx` | **节点白名单渲染器**（`switch` 穷尽 + `never` 兜底） |
| `src/components/living/living-canvas.tsx` | **Living Canvas**：DOM/SVG 混合、拖动、聚焦、折叠；<1024px 降级卡片流 |
| `src/components/living/use-media-query.ts` | 响应式订阅（`useSyncExternalStore`） |
| `src/app/workspace/living-workspace.tsx`（重写） | Composer 接入编译器；动作就绪性接 **`GET /api/v1/org` 的真实 `capabilities`** |
| `tests/workspace-spec/{schema,compile}.test.ts` | 单测（契约安全属性 + 不伪造 + 确定性） |
| `scripts/check-ui-invariants.mjs`（扩展） | 新增 **R6**（禁产保留节点类型）、**R7**（禁 `dangerouslySetInnerHTML`/`eval`） |
| `scripts/qa/verify-ui-invariants-mutation.mjs` | **变异自证**脚本（7 条规则逐条证明生效） |

## 2. 四个关键设计决定

### 2.1 「模型不得直接产 HTML/React」的**唯一**执法点是 `WorkspaceSpec`

设计基准 §二 要求模型只能产**受约束的结构**。本切片把这条落成三层，缺一层都不成立：

```
自然语言 ──[compile]──▶ WorkspaceSpec ──[zod 严格校验]──▶ 白名单组件渲染
             ▲                ▲                    ▲
          可替换（T09 换 LLM）  不可绕过            不可绕过
```

- **严格对象**：`z.strictObject` 让**未知字段直接失败**。因此"模型想塞一个
  `dangerouslySetInnerHTML` / `onClick` 字段"会在**校验层**被拒，而不是靠渲染层
  "碰巧没用到"。安全属性必须由**拒绝**保证。
- **白名单呈现**：渲染器只认 `NODE_TYPES`；`agent` 被列进 `RESERVED_NODE_TYPES`，
  契约层直接不认这个 `type` → 产出即校验失败。
- **推进器可替换**：T09 落地后只换 `compile.ts` 的提案实现，
  **校验层与渲染层一行都不用改** —— 这是 P1 先把契约做实、而不是先接模型的理由。

### 2.2 规则式而非 LLM：是**范围纪律**，不是能力妥协

LLM 提案属于 **T09 Agent Runtime**（那里才有 schema 校验之外的提示注入防御、
成本限额、失败降级）。P1 只做**契约 + 校验 + 渲染**这条不可绕过的骨架。

因此编译器**只认 5 类目标**（渠道对接 / 成员招募 / 活动 / 调研 / 导师陪伴）：
识别不出就返回 `ok:false` + 原因 + 5 条建议，**绝不硬凑一个 spec**。
"用模糊关键词覆盖一切"会让不相关的话也被'理解'成任务 —— 那比不识别更糟。

### 2.3 不编造：原文没写的字段**不补默认值**

- 没写期限 → **不默认 30 天**；没写预算 → **不编预算**；
- 没给可量化判据 → `successCriteria` 就是空数组，UI 明说"描述里未给可量化判据"；
- **候选节点恒为空数组**：真实候选需要 ACTIVE 社群成员身份后由服务端召回；
  预填任何候选都是伪造匹配（AC-13）；
- 抽出的约束/判据一律标为**草稿**（写进 `notes`），要用户确认后才创建 Mission。

### 2.4 动作就绪性来自**服务端下发的真实能力**，不是前端猜的

`availableActions[].ready` 在**编译期一律为 `false` + 原因**；渲染时由
`GET /api/v1/org` 返回的 `capabilities` **覆写**。该端点注释明确写着
"供界面做降级展示（**不是授权依据**）"—— 所以这里的能力**只用来禁用**，
真正的授权仍在服务端 `withTenant(capability)` 重做一遍。

本仓当前 `Membership = 0` → 该端点 403 → 全部租户动作**禁用 + 写明真实原因**，
而不是放一个点了没反应的按钮（AC-18）。

## 3. 门禁扩展（R6 / R7）

| 规则 | 判据 | 为什么必须是门禁 |
|---|---|---|
| **R6** | 不得出现 `type: 'agent'` | T09 未交付前产出 agent 节点 = **伪造能力**（阻断标准 #6/#9） |
| **R7** | 不得使用 `dangerouslySetInnerHTML` / `eval` / `new Function` | `WorkspaceSpec` 只能被白名单组件渲染，**绝不能当代码执行** |

并在 `SCOPES` 里加入 `src/lib/workspace-spec` —— 否则契约层本身**不受门禁保护**，
而那恰恰是最该被守的地方。

## 4. 证据（全部可复跑）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | 见 §6 |
| 单测 | `npx jest tests/workspace-spec` | 见 §6 |
| Lint | `eslint src/components/living src/app/workspace src/lib/workspace-spec scripts/check-ui-invariants.mjs scripts/qa/verify-ui-invariants-mutation.mjs --max-warnings=0` | 见 §6 |
| UI 不变量 | `npm run check:ui-invariants` | ✅ 10 文件通过（R1–R7） |
| **变异自证** | `npm run verify:ui-invariants` | ✅ **7/7 规则逐条被证明生效**；负向对照未误报；临时文件已清理 |
| 生产构建 | `npx next build` | 🔴 **本机环境级失败（见 §5）** —— 非本切片引入；同一命令在 Netlify 上可成功构建 |

> `verify:ui-invariants` 的设计要点：**不改动真实文件**，而是在被扫描目录内写
> **单条违反**的临时文件 → 断言 exit 1 且命中对应 `[R<n>]` → 再写一个**合法**文件
> 做负向对照（必须仍 exit 0）→ `finally` 删除。这样既证明"规则会红"，
> 也证明"不会无脑红"。

## 5. ⚠️ 本地 `next build` 的环境级故障（**结论经过一次修正**）

本切片期间，本地 `npx next build` 在 *Collecting page data* 阶段反复失败：

```
Error: Failed to collect configuration for /careers
  [cause]: TypeError: d.createContext is not a function
    at module evaluation (src/app/(public)/careers/page.tsx:3:1)
  > 3 | import { Briefcase, Globe, Users } from "lucide-react";
```

### 5.1 先记录一次**被推翻的结论**（这是本文最该读的一段）

| 阶段 | 我当时的结论 | 实际是否成立 |
|---|---|---|
| 初判 | "Turbopack **持久化缓存损坏**，清 `.next` 即修" | ❌ **不成立** |
| 依据 | 清缓存后的那次构建**没有**在 page-data 阶段报错 | ❌ **那次构建先卡在类型检查**（我代码的 `TS2339`），**根本没走到 page-data 阶段** ⇒ 不构成任何证据 |
| 反证 | —— | 复跑（**同样**清了 `.next`）→ **同样失败**，只是报错页换成了 `/cancellations-policy` |

> 教训：**"我没看到它失败" ≠ "它没失败"**。中间阶段先失败会截断后续阶段，
> 从而伪造出"后续阶段已通过"的假象。下结论前必须确认**判据真的被执行过**。

### 5.2 真实的观测事实（可复跑）

1. **报错页面每次不同**：第一次是 `/18-usc-2257` + `/careers` + `/about`，
   第二次是 `/cancellations-policy`。
2. 这些页面的**唯一共同点**：都是 `(public)` 下的 **Server Component**（无 `'use client'`），
   且都只 `import … from 'lucide-react'`。**本次改动一行未碰**。
3. **同一份源码 + 同一套依赖在 Netlify 上构建成功**：生产部署
   `6acde3962c8778501cd81f27` 正是由 `f6630ea` 构建产出，且站点在正常服务。

⇒ 判定：**不是本仓源码缺陷**，而是「`(public)` 页面在**服务端图**里加载 `lucide-react`」
这条路径在**本机环境**下不稳定。

### 5.3 机制（读依赖源码得出，非猜测）

- `lucide-react@1.48.0` 的 **CJS 入口**在**模块顶层**调用 `react.createContext({})`
  —— `dist/cjs/lucide-react.js:140` 的 `LucideContext`；
- 它的 **ESM 入口不含** `createContext`（对 `dist/esm/**` 全目录检索：**零命中**）；
- React 的 **`react-server` 条件不导出** `createContext`（RSC 中它是客户端专用 API）。

⇒ 只要服务端图解析到 **CJS 入口**，模块求值就会抛 `d.createContext is not a function`。
该包**没有 `exports` 字段**（只有 `main` / `module`），这会让"挑哪个入口"更依赖
bundler 的默认优先级 —— 这是它比一般包更脆的原因。

**为什么"只坏个别页面"**：构建在**第一个**失败处中止，报出来的页面只是某个 worker
恰好**先**求值到的那个 —— 是**调度产物**，不是这些文件的属性。

### 5.4 风险与缓解（**必须记下**）

Netlify 的构建命令也是 `npm run build` ＝ `next build`（Turbopack）。
本机已证实不稳定 ⇒ **下一次推 `main` 发版可能撞上**，且失败长相与此处一致
（会表现为"部署失败"，而不是"代码错"）。

候选缓解（**都需要单独验证后再动**，不要凭直觉改）：

| # | 缓解 | 说明 |
|---|---|---|
| ① | 把 `lucide-react` 从 `optimizePackageImports` 摘掉 | 代价：该包不再做 barrel 摇树优化，进包体积 |
| ② | 换一个 **CJS 入口不在顶层调 `createContext`** 的 lucide-react 版本 | 根本修法，但要回退大版本 |
| ③ | 升级 Next / Turbopack | 若上游已修该解析行为则最干净 |

> 本次用**自还原探针**（`/tmp/lf-probe-lucide.mjs`：备份 → 变异 → 构建 → **`finally` 还原** →
> `git diff --exit-code next.config.ts` 自证仓库未被改动）验证了 ①，结果见 §5.5。
> 之所以要"自还原"，是因为**探针本身不能留下副作用** —— 否则下一次构建会带着变异跑，
> 而没人记得原因。

### 5.5 探针结果（① 被**否定**）+ Netlify 承重事实的核实

**探针**（`/tmp/lf-probe-lucide.mjs`，自还原）：

```text
已临时移除 lucide-react from optimizePackageImports
… /about、/18-usc-2257 同样报 TypeError: d.createContext is not a function
已还原 next.config.ts
✅ 还原校验通过：next.config.ts 与提交版本逐字节一致
```

⇒ **候选 ① 被否定**：把 `lucide-react` 从 `optimizePackageImports` 摘掉**并未修复**。
（顺带：自还原机制工作正常，仓库未被污染 —— `git status` 只有本切片自己的新文件。）

**承重事实核实**（`/tmp/lf-netlify-deploy.mjs`，Node 内置 `fetch` + 重试）：

| 项 | 值 |
|---|---|
| deploy | `6acde3962c8778501cd81f27` |
| state | **`ready`** |
| commit | `f6630ea`（与本机失败的那份源码同族，且 `lucide-react` 同为 `^1.48.0`） |
| error_message | （无） |

⇒ **"同源码 + 同依赖 + 同构建命令（`npm run build`）在 Netlify 上构建成功"是已核实的事实**，
不是推断。因此"本机失败 ≠ 源码缺陷"这条结论**成立**。

**尚未确定的**是本机与 Netlify 在"服务端图如何为该包挑入口"上的差异。候选 ②（版本）
与 ③（Next/Turbopack）**未验证**；本次**没有**继续深挖，理由是它**不阻塞任何既定门禁**
（见 §4 与 §6：tsc / jest / eslint / 脚本守卫 / UI 不变量 / 变异自证全部通过），
且本阶段**未发版**。⇒ 记为**已知环境限制 + 发版风险**（§5.4），留给下一次发版前的核查动作。

## 6. 收尾核对

- [x] `npm run check:ui-invariants` → 10 文件通过（R1–R7）
- [x] `npm run verify:ui-invariants` → 7/7 规则证明生效
- [x] `npx tsc --noEmit` / `npx jest`（本切片 + 全量）/ ESLint / `check:script-decls` → 全部通过（见下方）

### 最终证据

| 项 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | **exit 0 / 0 error** |
| 单测（本切片） | `npx jest tests/workspace-spec --maxWorkers=1` | **2 套 / 26 用例全通过 / exit 0** |
| 单测（全量） | `npx jest --maxWorkers=2` | 见下方「全量回归」 |
| Lint | `node ./node_modules/eslint/bin/eslint.js src/components/living src/app/workspace src/lib/workspace-spec scripts/check-ui-invariants.mjs scripts/qa/verify-ui-invariants-mutation.mjs --max-warnings=0` | **exit 0 / 0 error / 0 warning**（输出为空） |
| 脚本守卫 | `npm run check:script-decls` | **63 脚本 / 0**（+1 为新变异脚本） |
| UI 不变量 | `npm run check:ui-invariants` | ✅ **10 文件通过（R1–R7）** |
| 变异自证 | `npm run verify:ui-invariants` | ✅ **7/7 规则逐条被证明生效** + 负向对照未误报 + 临时文件已清理 + 收尾复验 exit 0 |

### 全量回归

`npx jest --maxWorkers=2 --silent` → **64 套 / 1259 用例全部通过 / exit 0**（`247.99s`）。
相对上一基线（T08 Slice 3 的 **62 套 / 1233**）：**+2 套（`tests/workspace-spec/{schema,compile}`）/ +26 用例**，
**既有用例零失败**（本切片对既有模块只做了 `globals.css` 追加段与 `package.json` 加脚本，未改任何既有业务代码）。

### 类型检查期间的一处真错（清缓存重建抓出）

清缓存后的第一次重建**在类型检查阶段失败**，报：

```
src/app/workspace/living-workspace.tsx(253,90): error TS2339: Property 'status' does not exist on type 'OrgOverviewRes'.
```

原因：`GET /api/v1/org` 的响应是 `{ organization, myRole, capabilities, memberTotal }`，
`status` 在 `organization` **里**，而页面把它读成了顶层字段。已修，修正后 `tsc --noEmit` exit 0。

> 这条正好反证了「清缓存 → 复跑」的价值：它既排除了缓存造成的**伪缺陷**，
> 也确实抓出了一处**真缺陷**。若只看到第一条报错就停下，会把两者混为一谈。

## 7. 踩坑记录（本切片新增）

1. **期限内提前 `return` 导致预算/数量抽不到**：`extractDraftFields` 首版在
   "找到期限"时直接 `return`，于是"**同时写了期限和预算**"的输入反而丢字段。
   靠"抽不到"的用例发现不了 —— 需要**组合型**用例（已在单测固化为回归）。
2. **`useSyncExternalStore` 的第三个参数（服务端快照）决定 hydration 是否失配**：
   媒体查询必须返回 `false`、主题必须返回 `'field'`，否则首屏 SSR 与客户端不一致。
3. **门禁范围（SCOPES）本身会漏**：P0 时 `SCOPES` 不含 `src/lib/workspace-spec`
   （当时还不存在）—— 新增目录若忘了加进 SCOPES，该目录就"天然绿"。

## 8. P1 收口（`consent`/`action`/`outcome` 真实数据装配 + Mission 创建接线）

> 承上一版 §8 的"P1 剩余"。本段只记**已交付的事实与证据**。

### 8.1 交付物

| 文件 | 作用 |
|---|---|
| `src/lib/workspace-spec/assemble.ts`（新） | **真实数据装配器**（纯函数、零 IO）：三个真实来源 → 三类节点；并含"草稿 → 创建 Mission 请求体"的缺口判定 |
| `src/lib/workspace-spec/schema.ts`（改） | 三处展示枚举改为**服务端真实枚举的镜像** + **编译期漂移守卫**；契约版本 `1.0 → 1.1` |
| `src/lib/workspace-spec/index.ts`（改） | 出口补全新符号 |
| `src/app/workspace/living-workspace.tsx`（改） | 接 3 个真实读端点 → 装配 → 合并进画布；`create-mission` 真发 `POST /api/v1/missions`（带幂等键、诚实三态） |
| `src/components/living/living-canvas.tsx`（改） | 新增 `blockedActions`：**由数据本身**决定的阻断（能力之外的"做不了"，如缺必填项） |
| `src/components/living/node-card.tsx`（改） | consent 的字段标签/空态文案改为与真实来源一致 |
| `tests/workspace-spec/{assemble,schema}.test.ts` | 装配器 **37 例**（新）+ 取值域白名单 **4 例**（新）+ **契约版本值钉住 1 例**（新）；含**枚举镜像的硬编码回归**（`schema.test.ts` 由 9 例增至 **14 例**，`compile.test.ts` 既有 17 例不动） |
| `tests/agent/runtime.test.ts`（改） | 夹具/断言改用 `WORKSPACE_SPEC_VERSION` 常量，解除与版本号的耦合（见 §8.2 ⑤） |
| `scripts/qa/verify-workspace-spec-drift.mjs`（新） | **漂移守卫的变异自证**：证明"镜像≠服务端"时 `tsc` 真的会失败 |
| `scripts/qa/verify-p1-workspace-e2e.mts`（新） | **隔离库端到端取证**：真实 HTTP 全链路 + 用真实载荷跑装配器 |
| `package.json` | 新增 `verify:p1:e2e` / `verify:workspace-drift` |

### 8.2 🔴 本轮抓到的五个真问题

**① 三处展示枚举全是"猜"的，且**三处都猜错**。**

| 节点 | P1 首版猜测值 | 服务端真实枚举（T05/T06/T08） |
|---|---|---|
| `consent.status` | `PENDING` / `GRANTED` / `REVOKED` | `CONSENT_PENDING` / `MUTUALLY_ACCEPTED` / `REJECTED` / `REVOKED` / `EXPIRED` |
| `action.jobs[].status` | `PENDING` / `RUNNING` / `RETRY` / `DEAD` / `DONE` | `PENDING` / `RUNNING` / `SUCCEEDED` / `FAILED` / `DEAD` / `TAKEN_OVER` / `CANCELLED` |
| `outcome.outcomes[].level` | `…` / `EVIDENCE_BACKED` | `…` / **`EXTERNALLY_VERIFIED`**（`EVIDENCE_BACKED` 从未存在） |

危险不在"显示得不好看"，而在**真实数据一到就会被 `z.strictObject` 拒绝** →
整块渲染被阻止，而页面上不会报任何错，只是**永远空着**。
"只有渲染分支、没有真实数据装配"这一状态恰好**掩盖**了它 —— 没有真实数据，
就永远触发不到拒绝路径。⇒ 这正说明"接真实数据"不是装饰性工作。

修法不是"把枚举放宽成 `z.string()`"（那等于放弃白名单），而是**逐字镜像 + 编译期双向等价断言**
（`AssertTrue<Exact<镜像, 服务端>>`）：任一侧增删取值即 `tsc` 失败。

**② `GET /api/v1/org` 的信封读错了一层 —— 能力集恒为空。**

首版按 `org.data.capabilities` 读，而该端点返回 `{success, data:{…, capabilities}}`。
后果：`capabilities` 恒为 `∅` ⇒ **所有租户动作永久禁用**。而"全部禁用"与"权限不足"
在界面上**长得一模一样**，所以从 P0 起一直没人发现（它甚至看起来"更安全"）。
对照证据：`src/app/console/*` 一律走 `data.data`（同一信封，读法正确）。
**同类风险**：`/api/notifications`、`/api/matches`、`/api/chats/unread-count` 是**裸对象**
（无信封）—— 两种风格并存，所以"读错层"这件事只能逐个端点核对，不能靠惯例。

**③ `compileWorkspaceSpec` 的产出**不等于**可创建体。**

服务端 `parseMissionCreate` 要求 `goal ≥ 8`、`offer ≥ 1`、`successCriteria ≥ 5` **三者都必填**；
而草稿里的 `offer` 是可选的、`successCriteria` 是从文本抽出的数组（常常为空）。
若"凑一个默认对价"发出去，就是**凭空发明用户没说的承诺**。⇒ 装配器
`missionDraftFromSpec()` 在缺字段时**恒返回 `body: null` + 缺口清单**，
由界面禁用按钮并写明缺什么（`blockedActions`），而不是让用户点了才吃 400。

**④（顺带）写路径的 `Idempotency-Key` 不止 `/missions`。**
`POST /api/v1/intents` 与 `POST /api/v1/connections/proposals` 同样必需 ——
E2E 首轮正是因此拿到 400（而 400 的原因**不在 body 里**，在响应头的约定里）。

**⑤ 契约版本号被**别的模块的测试夹具**硬编码 —— 升版本后 T09 整组用例红（本轮自己造出来又自己修掉的）。**

`version: z.literal(WORKSPACE_SPEC_VERSION)` 一升到 `1.1`，`tests/agent/runtime.test.ts`
里写死的 `version: '1.0'` 夹具立刻变成**非法 spec** ⇒ 走"违反契约"分支：

| 表面症状 | 实际含义 |
|---|---|
| `PROPOSED` → `DEGRADED`（4 例） | 模型产出被拒 → 回落规则式 |
| `payload.version` 期望 `1.0` 实得 `1.1`（2 例） | 兜底产出用的是**新**常量 |
| `typeof out.rawText` 期望 `"string"` 实得 `"object"`（1 例） | `rawText` 是 **`null`** —— `typeof null === 'object'` |

最后一条尤其会**误导排查方向**：报错文本读起来像"rawText 类型坏了"，真因却是"根本没走到那条赋值"。

修法（两步，缺一不可）：
1. 夹具/断言改用**导出的常量** `WORKSPACE_SPEC_VERSION` ⇒ 测试与契约版本解耦，以后升版本不再误红；
2. 同时在**契约自己的测试**里显式钉住版本值：`expect(WORKSPACE_SPEC_VERSION).toBe('1.1')`
   且 `version:'1.0'` / `'2.0'` 必须被拒 —— 否则第 1 步会让"版本号"这个**唯一闸门**失去任何断言。

⚠️ 顺带一条**方法论教训**：本文件 §8.5 初稿曾在后台全量回归**尚未打印汇总行**时写下"1483 全部通过"；
实际结果是 **7 例失败**。**"全量回归全绿"必须以看到 `Test Suites: … , Tests: …` 汇总行为准**，
不能用"前面若干 suite 都是 PASS"外推。

### 8.3 装配器的五条纪律（每条都是"看起来能用"与"真的能用"的分界）

1. **零 IO**：取数在组件（`useApiGet`），映射是纯函数 ⇒ 可单测，也可被 E2E 直接喂真实载荷。
2. **不猜、不转义**：状态/档位**逐字**照搬；不做"把 `REJECTED` 归成 `PENDING`"式的美化（那等于隐瞒一次拒绝）。
3. **来源不可用 ≠ 没有数据**：403/读取失败 → **不产节点**（空节点会被渲染成"暂无…"，是彻底的误导），只产一条写明原因的说明。
4. **不静默丢**：载荷里有不认识的形状 → **整节点拒绝**并说明原因（跳过坏数据 = 少显示 ≠ 不显示，且无痕迹）。
5. **截断必须可见**：超节点/条目上限、字段超长、`attempts` 越界钳制 → 都产出一条说明。

> 一处刻意的不对称：`consent` 是"一提案一节点"，**提案为 0 时不产空节点**，
> 而 `action` / `outcome` 是数组载荷，**空数组仍产节点**（渲染器给真实空态）。
> 但"查询成功且确实为空"在两种情况下都**产出一条明确说明** —— 否则它与"读不到"无从区分。

### 8.4 证据（全部可复跑）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | **exit 0 / 0 error** |
| 单测（本切片） | `npx jest tests/workspace-spec` | **3 套 / 68 用例通过 / exit 0** |
| 单测（全量） | `npx jest --maxWorkers=2` | 见 §8.5 |
| Lint | `eslint src/components/living src/app/workspace src/lib/workspace-spec tests/workspace-spec scripts/qa/verify-*.{mjs,mts} --max-warnings=0` | **exit 0 / 0 error / 0 warning** |
| UI 不变量 | `npm run check:ui-invariants` | ✅ **11 文件通过（R1–R7）** |
| UI 变异自证 | `npm run verify:ui-invariants` | ✅ **7/7 规则逐条被证明生效** |
| 脚本守卫 | `npm run check:script-decls` | **67 脚本 / 0** |
| **漂移守卫变异自证** | `npm run verify:workspace-drift` | ✅ **13/13**：基线 exit 0 → 三次真实变异各自被 `tsc` 捕获（`TS2344` 精确落在守卫声明行 113–115）→ 还原后逐字一致且 exit 0 |
| **端到端（隔离库）** | `npm run verify:p1:e2e`（`QA_BASE=http://localhost:3099`） | ✅ **55 通过 / 0 失败 / exit 0** |

**端到端取证做了什么**（`scripts/qa/verify-p1-workspace-e2e.mts`，全部走真实 HTTP）：

1. 两个夹具账号登录取会话 → `GET /api/v1/org` 断言 `capabilities` 非空且 OWNER 含 `mission.create`
   （这一步同时**否证了问题②**：读错层的话这里就是 0 项）。
2. `POST /api/v1/missions`（带幂等键）→ 201；**同键重放** → 201 + `Idempotent-Replayed: true` + 同 id，
   且 `GET /api/v1/missions` 的 `meta.total` **未增加**（这才是"幂等"的判据，光看状态码不够）。
3. 负向：缺键 → 400 且 `details.field === 'Idempotency-Key'`；MEMBER → 403；两者都**未产生任务**。
4. 造真实数据全链路：双方加入 → 双方提交意图 → 发起提案（`CONSENT_PENDING`）→
   发起方接受（**仍 `CONSENT_PENDING`**，AC-04）→ 被介绍方接受（`MUTUALLY_ACCEPTED`）→
   介绍 → 上报成果（`SELF_REPORTED`）→ 对手方确认（升级为 **`COUNTERPARTY_CONFIRMED`**）。
5. 用上面三个读端点的**真实响应**喂装配器 → 合并进草稿 spec → 断言
   `WorkspaceSpecSchema` 通过、`version === 1.1`、且所有状态/档位**都落在服务端枚举内**。
   ⇒ 这就是"渲染层永远拿得到合法数据"的端到端判据。
6. 独立断言"来源失败 → 不产节点 + 写明原因"。

> ⚠️ 前置条件写在脚本头注释里：先 `seed-t02-e2e --reset --regenerate` 建隔离库，
> 再以 `DATABASE_URL=file:/tmp/t02-e2e.db npx next dev -p 3099` 起服务。
> **脚本刻意不自己起服务** —— 否则"服务起不来"会被误报成"功能坏了"。
> 该用例会**真的创建** Mission / 提案 / 成果，所以必须跑在隔离库上。

### 8.5 全量回归

`npx jest` → **77 套 / 1498 用例全部通过 / exit 0**（汇总行抄录，非外推）。
相对上一基线（T09 Slice 3 的 **76 套 / 1456**）：**+1 套（`tests/workspace-spec/assemble`）/ +42 用例**，
`tests/workspace-spec` 由 2 套 26 例增至 **3 套 68 例**。**既有用例零失败。**

> 🔴 本行数字**修正过一次**：初稿写"77 套 / 1483 全绿"时，后台全量回归其实**尚未打印汇总行**，
> 真实结果是 **7 例失败**（T09 `tests/agent/runtime.test.ts` 的版本号硬编码，见 §8.2 ⑤）。
> 教训已写进 §8.2 ⑤：**以汇总行为准**。

## 9. 下一步

- **前端 P1 已收口**。剩余未接线动作（`propose-connection` / `invite-member` / `report-outcome`）
  一律**显式禁用 + 写明"尚未接线"**，不留"点了没反应"的按钮（AC-18）。
- **前端 P2**（Field 2.5D 关系网络 → 引 `@xyflow/react`）/ **P3**（首页 3D，且首屏文案与登录入口必须独立于 3D）。
- **T09 Agent Runtime**：把 `compile.ts` 的**规则式提案器**换成 LLM 提案器
  （zod 校验 / 提示注入防御 / 成本限额 / 失败降级），契约与渲染层不动 ——
  本轮把契约与真实端点对齐之后，这一步的"接线成本"已经降到只剩 `proposeSpecDraft()` 一处。
- 🔴 **发版前必做**：本地 `npx next build` 复核 §5 的 lucide-react 服务端图风险；
  并把本轮的唯一未取证项（隔离库 E2E 已覆盖 HTTP 与应用层，**浏览器端交互未取证**）纳入发版复验。
