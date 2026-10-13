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

## 8. 下一步（P1 未完 + T09）

- **P1 剩余**：`Living Canvas` 的 `consent` / `action` / `outcome` 三类节点
  目前只有渲染分支、**没有真实数据装配**（需要租户上下文）；
  Mission Studio 的 **`POST /api/v1/missions`（幂等键）** 尚未接线 ——
  它需要 ACTIVE 社群成员身份，计划在**隔离 E2E 库**（`file:/tmp/t02-e2e.db`，
  member `e2e.member@example.test`）里做端到端取证，而不是在本机账号上伪造。
- **T09 Agent Runtime**：把 `compile.ts` 的**规则式提案器**换成 LLM 提案器
  （zod 校验 / 提示注入防御 / 成本限额 / 失败降级），契约与渲染层不动。
  🔴 技术栈分叉（TS 内编排 vs Python/LangGraph）**仍需拍板**。
