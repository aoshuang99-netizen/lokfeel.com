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
| 生产构建 | `npx next build` | 见 §6、§5 |

> `verify:ui-invariants` 的设计要点：**不改动真实文件**，而是在被扫描目录内写
> **单条违反**的临时文件 → 断言 exit 1 且命中对应 `[R<n>]` → 再写一个**合法**文件
> 做负向对照（必须仍 exit 0）→ `finally` 删除。这样既证明"规则会红"，
> 也证明"不会无脑红"。

## 5. ⚠️ 环境事故：Turbopack 持久化缓存导致的**伪缺陷**

**现象**：首次 `npx next build` 在 *Collecting page data* 阶段失败：

```
Error: Failed to collect configuration for /careers
  [cause]: TypeError: d.createContext is not a function
    at module evaluation (src/app/(public)/careers/page.tsx:3:1)
  > 3 | import { Briefcase, Globe, Users } from "lucide-react";
```

**排查**（三条独立证据）：

1. 报错页面是 `(public)/18-usc-2257`、`/careers`、`/about` —— **本次改动一行未碰**；
2. 本仓有大量页面同样 `import … from 'lucide-react'`，却**只有 3 页**报错
   → 非确定性，不像源码缺陷；
3. `lucide-react@1.48.0` 的 CJS 入口在**模块顶层**调用 `react.createContext({})`
   （`dist/cjs/lucide-react.js:140` 的 `LucideContext`）—— 该写法在服务端图里
   确实可能踩到 `react-server` 条件，**但**这解释不了"只坏 3 页"。

**结论**：`rm -rf .next` 后**同样代码**重新构建，该错误**不再出现**
（构建推进到 *Running TypeScript*）→ 判定为 **Turbopack 持久化缓存局部损坏**，
与源码无关。

> **留给后来的教训**：本仓 `next build` 出现**同仓同类文件只有个别报错**、
> 且报错点是"库在模块顶层调 React API"时，**先清 `.next` 再复现**，
> 不要先去改业务代码。反之，如果清缓存后**仍然复现**，再上万能对照
> （`git worktree add origin/main` + 软链 `node_modules` 跑同一用例）。

## 6. 收尾核对

- [x] `npm run check:ui-invariants` → 10 文件通过（R1–R7）
- [x] `npm run verify:ui-invariants` → 7/7 规则证明生效
- [ ] `npx tsc --noEmit` / `npx jest tests/workspace-spec` / ESLint → **见下方"最终证据"**

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

## 8. 下一步（P1 未完 + T09）

- **P1 剩余**：`Living Canvas` 的 `consent` / `action` / `outcome` 三类节点
  目前只有渲染分支、**没有真实数据装配**（需要租户上下文）；
  Mission Studio 的 **`POST /api/v1/missions`（幂等键）** 尚未接线 ——
  它需要 ACTIVE 社群成员身份，计划在**隔离 E2E 库**（`file:/tmp/t02-e2e.db`，
  member `e2e.member@example.test`）里做端到端取证，而不是在本机账号上伪造。
- **T09 Agent Runtime**：把 `compile.ts` 的**规则式提案器**换成 LLM 提案器
  （zod 校验 / 提示注入防御 / 成本限额 / 失败降级），契约与渲染层不动。
  🔴 技术栈分叉（TS 内编排 vs Python/LangGraph）**仍需拍板**。
