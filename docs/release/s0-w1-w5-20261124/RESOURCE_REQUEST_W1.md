# W1 — 唯一资源工单：隔离 Staging 数据库（BLOCKED_RESOURCE）

- 日期：2026-11-24
- 状态：**BLOCKED_RESOURCE**（缺外部资源/授权，非技术开发任务）
- 本工单是**一次性**的资源请求。按 24h 令，不再生成新的临时 Tunnel / WASM / 架构替代方案；收到下列任一资源即解除阻断。

## 1. 需要 Owner 提供的资源（二选一）

**选项 A（推荐，沿用现有技术栈）**
- 结清 Turso 组织 `lokfeelboss` 欠费（`payment_failing_since=2026-07-01`，创建库 API 返回 403），在该组织新建**专用 Staging 库**。
- 提供：固定 `libsql://...` 端点 URL + **仅限该 Staging 库**的 auth token。

**选项 B**
- 提供任一其他厂商的固定隔离 libSQL/SQLite 兼容端点 URL + 仅限该库的 token。
- 硬门槛：固定远程地址（非 Quick Tunnel / 非 `trycloudflare.com`）、长期运行、应用与 DB 服务重启后测试记录仍可读。

## 2. 注入方式（不经过聊天正文）

- DB URL + token 由 Owner 直接写入 **Netlify Staging 站点**环境变量（`DATABASE_URL`、`TURSO_AUTH_TOKEN`）与 **GitHub Actions Secrets**（CI 迁移/E2E 用）。
- **禁止**把 token 明文发到聊天、提交到仓库或写入日志/证据文件。本仓任何交付物都不含真实凭据。

## 3. 验收标准（收到资源后工程侧执行，不显示密钥）

| 项目 | 标准 |
| --- | --- |
| 数据独立性 | DB 标识 ≠ 生产库 `lokfeelcom`；权限严格限定 Staging |
| 地址稳定性 | 固定远程端点，非临时隧道 |
| 持久性 | 应用重启、DB 服务重启后邀请/消息记录仍可读 |
| 数据库访问 | 建表、事务、写入、读取、回滚均通过 |
| 安全隔离 | 不读取生产真实用户数据；不复制生产 token |
| 失败处置 | 若仍欠费/不能开库，本工单保持 BLOCKED_RESOURCE，不再探索替代 |

## 4. 为什么本机无法自建（已穷尽，仅作一次性说明，不再重复调查）

- Turso 组织欠费，`POST /v1/organizations/lokfeelboss/databases` = 403；token 下只有生产库 `lokfeelcom`。
- 本地所有 `DATABASE_URL` 指向生产库 ⇒ 复用即违反「严禁生产 DB/密钥进 Staging」。
- 无 `~/.cloudflared/cert.pem` ⇒ 无法建固定 Named Tunnel；`wrangler whoami` 未认证；本机无 CF API token / 账号 ID（仅 CI secrets 中有）；无 Fly/Render/Railway 配置；Vercel 空壳；`gh` 未安装。
- 临时 sqld + Quick Tunnel 已在 2026-11-23 验证并清理，URL 不固定、随进程消失、重启丢数据，不满足门槛，**不得冒充 Staging**。

## 5. 并行不阻断项

按新令，W1 阻断**不停止**以下工作（本轮状态见 RESULT_TABLE.md）：
- S0 生产支付止损：候选与审批包已就绪（待 Owner 精确 SHA 批准）。
- W5 迁移影响分析：已完成（见 MIGRATION_IMPACT_ANALYSIS.md）。
- 代码收口、CI、UI 代码层问题：不依赖 DB 的部分继续推进。

## 6. 解除条件

Owner 提供选项 A 或 B 的资源并按 §2 注入后，工程侧立即执行 W2（Netlify Staging 部署 + Health 200 + 运行 SHA 对齐）、W3（双账号邀请/关系/双向聊天 + DB 对账）、W4（八页真实浏览器验收），并按 RESULT_TABLE.md 六列回报。
