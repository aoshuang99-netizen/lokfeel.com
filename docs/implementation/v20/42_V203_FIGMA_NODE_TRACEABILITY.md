# V20.3 · 42 — Figma 节点追溯性与写入能力实测

> **状态：`BLOCKED_FIGMA_WRITE`**（2026-11-06 实测）。
> 作战令 §3 原文：「Figma 账号连通不等于写入能力已通过」「如无写入能力，标记 `BLOCKED_FIGMA_WRITE`，
> 同时继续代码实现和浏览器验收，不得谎称 Figma 已交付」。本文件严格执行该口径。

## 1. 账号与凭据

| 项 | 值 | 取证 |
|---|---|---|
| 账号 | `AO SHUANG` / `aoshuang99@gmail.com` | `GET /v1/me` → 200 |
| Figma user id | `1634104923977671695` | 同上 |
| 凭据类型 | Personal Access Token（`figd_…`） | 用户提供，存 `/tmp/figma_token.txt` (chmod 600) |
| 技能 | `~/.workbuddy/skills/figma`（方法论指导 + `flow_check.py` 自检清单） | 已加载，无创建/写入脚本 |

## 2. 能力逐项实测（不是推测，是本轮 HTTP 实测）

| 能力 | 端点 | 实测结果 | 判定 |
|---|---|---|---|
| 身份读取 | `GET /v1/me` | **200** | PASS |
| 创建文件 | `POST /v1/files` | **404 `{"status":404,"err":"Not found"}`** | **FAIL / 无此端点** |
| 列出本人文件 | `GET /v1/me/files` | **404 `Not found`** | **FAIL / 无此端点** |
| 读 Variables | `GET /v1/files/{key}/variables/local` | **404**（且未提供任何有效 file key） | NOT_TESTED |
| 写 Variables | `POST /v1/files/{key}/variables` | **404** | **FAIL** |
| 创建 Frame / Component / Variant | REST API | 无端点；Figma REST 为**只读文件结构** | **FAIL** |
| 原型连线 | REST API | 无端点 | **FAIL** |
| 截图导出 | `GET /v1/images?ids=…` | 需有效 file key + Node ID（当前无） | NOT_TESTED |
| Node ID 回读 | 需先有可编辑节点 | 不存在可回读对象 | **BLOCKED** |
| 官方 Figma 连接器 | `list_installed_plugins` → `No connectors installed` | 无 | **BLOCKED_ACCESS** |
| 可安装候选 | `search_plugins(Figma connector)` → 10 条候选，均非 Figma | 无匹配 | **BLOCKED_ACCESS** |

**结论**：该 PAT 只有**身份读取**能力。Figma REST API 对文件结构是只读的，
建帧 / 组件 / Variables / 原型必须在 Figma 编辑器内（或经官方 Dev Mode / MCP 写入连接器）完成。
**不把 REST 读取能力等同于设计写入能力**——这正是 `19_FIGMA_CODE_TRACEABILITY.md` 遗留的认知缺口，本轮实测补齐。

## 3. 与 19 号文档的差异（本轮新增证据）

| 项 | `v19/19`（2026-10-23） | 本轮（2026-11-06） |
|---|---|---|
| 状态 | `BLOCKED_FIGMA_CONNECTOR` | `BLOCKED_FIGMA_WRITE`（更精确） |
| 原因 | 无 Figma API token、ToolSearch 0 工具 | **已有 PAT**，但实测无写入端点、无连接器 |
| 补齐路径建议 | 「提供 PAT 可跑 REST API 读文件节点」 | ⚠️ **该建议不足**：PAT 只能读，不能创建节点。需写入型连接器或编辑器内操作 |
| Node ID | `N/A (HTML source)` | 仍为 `N/A`，**不虚构** |

> 这是必须纠正的认知：`19` 把「提供 PAT」当作解锁写入的路径，本轮实测证明它只解锁读取。

## 4. 逐屏 Node ID 追溯表（诚实全 BLOCKED）

| 屏 | 路由 / Screen ID | Figma File URL | Frame Node ID | 真实前端截图 | 判定 |
|---|---|---|---|---|---|
| Now | `/workspace` · `now` | 无 | N/A | `screenshots/production-dc102cd/_workspace__390x844.png`（旧版） | BLOCKED |
| Studio | `/workspace` · `studio` | 无 | N/A | — | BLOCKED |
| Field | `/workspace` · `field` | 无 | N/A | — | BLOCKED |
| Consent | `/workspace` · `consent` | 无 | N/A | — | BLOCKED |
| Outcomes | `/workspace` · `outcomes` | 无 | N/A | — | BLOCKED |
| Agents | `/workspace` · `agents` | 无 | N/A | — | BLOCKED |
| Console 总览 | `/console` | 无 | N/A | `…/_console__1440x900.png`（旧版） | BLOCKED |
| 智能体 | `/console/agents` | 无 | N/A | — | BLOCKED |
| 连接 | `/console/connections` | 无 | N/A | — | BLOCKED |
| 成员 | `/console/members` | 无 | N/A | — | BLOCKED |
| 连接任务 | `/console/missions` | 无 | N/A | — | BLOCKED |
| 成果 | `/console/outcomes` | 无 | N/A | — | BLOCKED |
| 设置 | `/console/settings` | 无 | N/A | — | BLOCKED |

禁止使用纯图片假装可编辑 Figma 设计（作战令 §3.3）。上表不填任何臆造 ID。

## 5. 当前可成立的追溯链（继承 `19` §4，不虚构 Figma 环节）

```
design/v19/concept-c-adaptive-dual-world.html（可编辑 HTML 结构规格）
  → v19/06 §3 归一映射（色板）+ 07 §3 差异裁决（交互）
  → src/components/living/*、src/app/console/*（实现）
  → v20/01_V200_PAGE_API_STATE_MATRIX.md（逐屏 API/DB/Evidence）
  → tests/living/*、tests/e2e-ci/*（守卫）+ verify:contrast（令牌门禁）
  → docs/implementation/v19/screenshots/production-dc102cd/（旧版真实浏览器截图）
```
**Figma 节点是这条链上唯一缺失的一环**。缺失不阻断真实体验修复（本轮 `G-03` 深链接修复即证明）。

## 6. 解锁条件（二选一，均需用户侧一次性操作；本轮不反复索要）

1. 安装/启用具备**写入**能力的 Figma 官方连接器（OAuth，支持 create frame / variables / component / prototype）；或
2. 在 Figma 编辑器内新建文件 `LokFeel — Connection OS — V20.3`，把 file key 与可写 token 提供给本环境；
   此时可机械执行 `19` §3 的 5 步清单（建 Variables collection=Connection OS，mode=Deep Field/Paper；
   按 `07`/`08` 六屏+七屏表建 390×844 与 1440×900 两套 Frame；回填 Node ID；跑 design↔browser 对照）。

> 按作战令「不再因为单项工具阻塞停止全部工程」：本项 BLOCKED **不停止**其余工程，
> 本轮已继续完成代码修复、门禁、其余交付文档。
