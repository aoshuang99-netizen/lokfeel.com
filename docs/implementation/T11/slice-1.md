# T11 · Slice 1 — OpenAPI 契约固化 + 开源许可证/凭据审计

> **提交**：见 `slice-5.md` 统一回填（本任务 5 个切片合并为一次提交）。
> **状态**：✅ 已落地；`check:openapi-contract` 与 `audit:open-source` 各 5 项断言全绿。

---

## 0. 为什么第一刀砍在"契约"而不是"实现"

`BACKLOG.md` §3 T10 卡片留了一条交接：

> ⚠️ 本切片新增的 8 个端点**未**写入 `contracts/connection.openapi.yaml`，T11 做「OpenAPI 固化」时需一并补齐 —— 连同 T09 的 `/api/v1/agents/*`（同样尚未收录）。

也就是说，契约文件当时**落后于实现**。先补契约、再写适配层，顺序不能反：
反过来的话，「契约」会退化成对已写代码的事后描述，"同源核对"这一步就只是在
自己核对刚写的代码，**证明不了任何东西**。

---

## 1. 交付物

| 文件 | 变化 | 说明 |
|---|---|---|
| `contracts/connection.openapi.yaml` | 98 行 → **~700 行**；8 路径 → **34 路径 / 42 操作** | 覆盖 missions / intents / connections / outcomes / agents / bridges 六大面 |
| `scripts/check-openapi-contract.mjs` | 新建 | 契约 ↔ 实现**同源核对** |
| `scripts/qa/open-source-audit.mjs` | 新建 | 许可证分级 + 凭据扫描 |
| `scripts/fix-bot-photos-http.mjs` | 修改 | **修复一处真实凭据泄漏**（见 §4） |
| `package.json` | +2 脚本 | `check:openapi-contract`、`audit:open-source` |

**两份契约副本**：工作区交付包 `lokfeel_workbuddy_v1/contracts/connection.openapi.yaml`
与仓库 `contracts/connection.openapi.yaml` 内容一致（`shasum` 校验相同）。

### 契约的形状约定

- **每条操作**都带 `x-required-capability`（**42/42**，无例外）—— 能力名与
  `src/lib/tenancy/capabilities.ts` **逐字一致**；
- 权威声明的是**路径 / 方法 / 所需能力**；请求体 schema 精确；
  **响应体只固化关键字段**，完整形状以 `src/lib/**/dto.ts` 为准（不复制类型，
  否则契约会变成第二份类型定义，两边必然漂移）；
- 越权语义写进契约头部（`AC-19 / AC-22 的共同执法点`）：
  跨组织资源永远只对**当事方组织**可见，非当事方一律 `404`；
  **能力守卫（403）先于当事方判定（404）** —— 「没有该能力」与「不是当事方」是两件事。

---

## 2. `check-openapi-contract.mjs`：契约 ↔ 实现的同源核对

`npm run check:openapi-contract`。四项断言 + 一项警告：

| # | 断言 | 为什么需要 |
|---|---|---|
| ① | 每条操作都有 `x-required-capability` | 没有它，契约就只是"有哪些路径"，读者无法知道该带什么权限 |
| ② | 契约里的路径在实现里**存在**（`pathToFile()` 把 `{x}` 转 `[x]` 再找 `route.ts`） | 防"契约写了、代码没写"（幽灵端点） |
| ③ | 该 route 文件里 `withTenant(...)` 的能力与契约**逐字一致**（`capabilityOf()` 按 method 精确定位） | 防"契约说 `mission.read`、代码写 `mission.manage`"——这类漂移**不会**在任何运行时测试里暴露，因为测试用的是代码 |
| ④ | 契约里的能力名都真的在 `capabilities.ts` 里 | 防**幽灵能力**：写一个不存在的能力名比不写更糟，它"看起来在执法" |
| ⚠️ | 实现里已存在但契约未收录的路径 → **仅警告** | 收尾时可见，但不阻断 —— 反过来把它做成硬失败会逼人为了过门禁去补一堆与本次改动无关的条目 |

**实跑**：42 条操作 / 31 个候选能力；13 条已实现路径未收录 = 警告（含本次新增的
`/api/mcp` 与 `/api/v1/a2a/tasks` —— 它们是**协议适配层**，不是 REST 资源，
本就不属该契约的范围；这一判断写在脚本注释里，而不是靠"把警告调没"）。

---

## 3. `open-source-audit.mjs`：许可证分级 + 凭据扫描

`npm run audit:open-source`。

### 3.1 许可证分级

四档：`ALLOWED` / `WEAK`（弱 copyleft，如 LGPL、MPL）/ `STRONG`（强 copyleft，如 GPL、AGPL）/ `UNKNOWN`。
SPDX 表达式按逻辑解析：`OR` **取宽松**（`MIT OR GPL-3.0` 可选 MIT）、`AND` **取严**（必须同时满足）。
**判据**：生产依赖里出现 `STRONG` 或 `UNKNOWN` ⇒ 失败。

> 「未知许可证」被当作失败而不是警告：一个未知许可证的依赖，其义务是未知的。
> 允许它进生产，等于把法律风险外包给"应该没事"。

### 3.2 凭据扫描

扫 `git ls-files` 全部文本文件（本仓 1463 个），7 类高危形态（JWT、私钥块、
平台 token 前缀、含值的凭据字段名、长随机串等），外加 `PLACEHOLDER` 正则豁免占位符。

**关键设计：测试目录命中降级为「提示」而非「失败」。**
理由：夹具**必然**包含假的凭据样例（否则测不了凭据处理）。若把测试目录也算失败，
第一次运行就会红；然后人的下一步动作一定是**加白名单绕过** —— 那才是真正的失守。
把噪音降级，才能让"非测试文件的命中"保持 100% 可信。

**实跑**：40 个生产依赖 + 27 个开发依赖全为宽松许可；非测试文件 0 命中；5 项断言全绿。

---

## 4. 🔴 本轮抓到的一处**真实**凭据泄漏（已修）

`scripts/fix-bot-photos-http.mjs:10` 硬编码了一个**真实可用的 Turso 读写 token**：

- 形态：JWT（`eyJ…`），payload 解出来含 `"a":"rw"`（读写权限）；
- 状态：**已在 git 历史里**（该脚本无任何引用，是 2026-05-29 的一次性作业）。

修法：

```diff
-const TURSO_TOKEN = 'eyJhbGciOi…'   // 真实 token
+const TURSO_TOKEN = process.env.TURSO_TOKEN
+if (!TURSO_TOKEN) {
+  console.error('缺少 TURSO_TOKEN 环境变量。用法：TURSO_TOKEN=… node scripts/fix-bot-photos-http.mjs')
+  process.exit(1)
+}
```

注释里写明：**该 token 必须视为已泄漏并轮换**。

### 这条缺陷的教训（值得留在检查清单里）

1. **"一次性的脚本"不是"可以不守规矩的脚本"**。越是临时的代码越容易硬编码凭据
   ——正因为作者知道它"跑完就删"，而实际上它进了 git 就永远在。
2. **审计脚本的价值首先在于它能发现真问题**。本次 5 项断言第一次跑就抓到一处
   真泄漏，这才有理由相信它不是摆设。一个从来没红过的审计，和没有审计是一回事。
3. **同时要防"审计自己变成噪音源"**。所以才有"测试目录降级"那条 ——
   审计的目标是让人**愿意一直跑它**，而不是让人学会无视它。

---

## 5. 门禁证据

```
npm run check:openapi-contract   → 5 项断言全绿（42 操作 / 31 能力；13 条未收录 = 警告）
npm run audit:open-source        → 5 项全绿（40 生产 + 27 开发依赖全宽松；非测试文件 0 命中）
npm run check:script-decls       → 通过（新增 2 个 .mjs 无未声明引用）
npx tsc --noEmit                 → exit 0
```

**变异自证**（负向）：把契约里某条操作的 `x-required-capability` 改成一个不存在的名字
⇒ `check:openapi-contract` 断言 ④ 报红（幽灵能力）；把某个 route 的能力换掉
⇒ 断言 ③ 报红。改回后复绿。

---

## 6. 未覆盖 / 诚实声明

1. **契约不是机器执行的**：`check-openapi-contract.mjs` 是**静态**核对（正则 + 文件存在性）。
   它证明不了"请求体 schema 与 handler 的解析逻辑一致" —— 那需要 schema 驱动校验，
   属独立工作。因此契约的响应体只固化关键字段（见 §1）。
2. **许可证审计不构成法律意见**：它只按 SPDX 标识分级。依赖的真实许可证文本、
   专利条款、以及本项目自身许可（`LICENSE` / `LICENSE-COMMERCIAL.md`）的相容性，
   需要人工评审（`docs/OPEN-CORE-POSITIONING.md`）。
3. **公开仓库仍是私有仓**：本次只保证"许可证与凭据卫生"，不等于"已开源发布"。
