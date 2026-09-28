# 自托管部署指南 (Self-Hosting Guide)

> 目标：让一个没接触过本项目的人，在 **30 分钟内**跑起一个可用实例。
> 如果任何一步卡住了，那是文档的问题 —— 欢迎提 Issue。

---

## 1. 三种部署方式

| 方式 | 适用场景 | 复杂度 | 耗时 |
|---|---|---|---|
| **A. Docker Compose**（推荐） | 单机部署、试用、小型社群 | ⭐ | ~15 分钟 |
| B. 手动部署 | 已有数据库/Redis 等基础设施 | ⭐⭐ | ~30 分钟 |
| C. 托管数据库 + 容器 | 生产环境、需弹性伸缩 | ⭐⭐⭐ | ~1 小时 |

本文档覆盖 A 与 B；C 请参考第 5 节与你的云厂商文档。

---

## 2. 前置要求

| 组件 | 最低要求 | 说明 |
|---|---|---|
| Docker | 24+ | 含 `docker compose` 子命令 |
| Docker Compose | v2 | 旧版 `docker-compose` 亦可 |
| 内存 | 2 GB 可用 | 3 个容器（app / postgres / redis）|
| 磁盘 | 10 GB 可用 | 镜像 + 数据库 + 对象存储 |
| 域名 | 可选 | 生产环境需要（TLS、OAuth 回调）|

**不需要**：Node.js、PostgreSQL 客户端、Redis 客户端（全部跑在容器里）。

---

## 3. 快速开始（Docker Compose）

### 步骤 1：获取代码

```bash
git clone <repository-url> lokfeel
cd lokfeel
```

### 步骤 2：生成密钥

**不要跳过这一步，也不要使用示例值。** 生成三个随机值：

```bash
echo "NEXTAUTH_SECRET=$(openssl rand -base64 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
echo "MINIO_ROOT_PASSWORD=$(openssl rand -base64 24)"
echo "REDIS_PASSWORD=$(openssl rand -base64 24)"
```

> ⚠️ 容器入口脚本会**主动拒绝**使用 `changeme`、`placeholder` 这类占位值启动 —— 这是有意设计，避免"能跑起来但不安全"的部署。

### 步骤 3：写入配置

```bash
cp .env.example .env
```

编辑 `.env`，至少填入刚才生成的四个值：

```bash
# ── 必填 ──────────────────────────────────────────
NEXTAUTH_SECRET=<步骤 2 生成的值>
NEXTAUTH_URL=http://localhost:3000    # 生产环境改为 https://你的域名
POSTGRES_PASSWORD=<步骤 2 生成的值>
REDIS_PASSWORD=<步骤 2 生成的值>
MINIO_ROOT_PASSWORD=<步骤 2 生成的值>

# ── 可选 ──────────────────────────────────────────
APP_PORT=3000
POSTGRES_USER=lokfeel
POSTGRES_DB=lokfeel
S3_BUCKET=lokfeel-media
MIGRATE_ON_START=deploy
TELEMETRY_ENABLED=false               # 保持关闭
```

### 步骤 4：启动

```bash
docker compose up -d
```

首次启动会构建镜像（约 3–8 分钟）并自动执行数据库迁移。

### 步骤 5：确认状态

```bash
# 查看容器状态 —— app 应为 healthy
docker compose ps

# 跟踪启动日志（应看到"数据库已就绪""执行数据库迁移""启动应用"）
docker compose logs -f app
```

成功的话，日志末尾会出现：

```
[lokfeel] 数据库已就绪。
[lokfeel] 执行数据库迁移（prisma migrate deploy）…
[lokfeel] 启动应用，端口 3000…
```

### 步骤 6：访问

打开 **http://localhost:3000**

---

## 4. 常见问题排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `POSTGRES_PASSWORD 必须设置` | `.env` 未填或变量名拼错 | 检查 `.env` 中变量名与 `docker-compose.yml` 一致 |
| `拒绝启动：NEXTAUTH_SECRET 看起来是占位值` | 用了示例值 | 用 `openssl rand -base64 32` 生成新值 |
| `等待数据库超时` | 数据库未就绪或网络不通 | `docker compose logs postgres`；检查 `DATABASE_URL` |
| 页面能开但登录失败 | `NEXTAUTH_URL` 与实际访问地址不一致 | 改为实际地址（含协议与端口），重启 app |
| 头像/图片上传失败 | MinIO bucket 未创建 | `docker compose logs minio-init`；或手动访问 `http://127.0.0.1:9001` 创建 |
| 实时消息不工作 | Redis 未连通 | `docker compose logs redis`；检查 `REDIS_PASSWORD` |
| 构建失败提示找不到 standalone | `BUILD_TARGET` 未生效 | 确认 `Dockerfile` 中 `ENV BUILD_TARGET=standalone` 存在 |

### 重置与清理

```bash
# 停止（保留数据）
docker compose down

# 停止并删除数据卷（⚠️ 不可逆，会清空数据库与文件）
docker compose down -v
```

---

## 5. 生产环境部署要点

### 5.1 TLS 与反向代理

**必须**在前面加一层反向代理。Caddy 示例（自动申请证书）：

```caddyfile
your-domain.com {
    reverse_proxy localhost:3000
    encode gzip
}
```

Nginx 时注意：**必须**正确转发 WebSocket（实时通信依赖）：

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 5.2 用托管数据库/Redis

删除 `postgres` 与 `redis` 服务，改为指向外部：

```bash
DATABASE_URL=postgresql://user:pass@your-db-host:5432/lokfeel?schema=public
DATABASE_SSL=true
REDIS_URL=rediss://user:pass@your-redis-host:6379
```

### 5.3 数据库迁移由外部管理

大规模部署时，建议把迁移做成独立的 Job（Helm hook / CI 步骤），而不是每次容器启动都跑：

```bash
MIGRATE_ON_START=skip
```

然后单独执行：

```bash
docker compose run --rm app npx prisma migrate deploy
```

#### 5.3.1 ⚠️ 远程 libSQL（Turso）不能用 `prisma db push`

Prisma 的 `sqlite` provider **只接受 `file:` 协议**。把 `DATABASE_URL` 指向
`libsql://…`（Turso）再跑 CLI，会直接报错：

```
Error: P1013
The provided database string is invalid. `datasource.url` in `prisma.config.ts`
is invalid: must start with the protocol `file:`.
```

这不是配置写错了，是协议层的限制。Prisma 7.8 的 `prisma.config.ts` **没有
`adapter` 字段**，所以 CLI 无法像运行时那样借 `@prisma/adapter-libsql` 连上去。

**运行时完全不受影响** —— 应用侧走的是驱动适配器，`libsql://` 正常工作。
只有 CLI（`db push` / `migrate deploy` / `migrate diff --from-…-datasource`）受限。

要管理远程库结构，有两条路：

**路径 A：生成 SQL，自己执行（推荐，可审计）**

```bash
# 1) 纯本地生成「空库 → 目标 schema」的完整 DDL，**不连库**
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > target.sql

# 2) 把它与线上实际结构做差集，只补缺口
#    ADD COLUMN / CREATE TABLE / CREATE INDEX 都是非破坏性的
```

再用 libSQL 客户端或 `turso db shell` 执行差异语句。

> Prisma 7.8 的 CLI 参数已改名：
> `--from-url` → `--from-config-datasource`；
> `--to-schema-datamodel` → `--to-schema`。

**路径 B：先在本地 `file:` 副本上验证**

把 `DATABASE_URL` 指向本地副本，迁移在副本上跑通后，再对线上执行同一批 SQL。

**⚠️ 反向的坑同样致命**：`prisma db push` 会 **DROP 掉 schema 里没有的表**。
本项目线上就存在三张历史遗留表（`payments` / `webhookEvent` / `AdminLog`，
0 行、零代码引用）—— 对线上库直接 push 会把它们删掉。
**对线上库永远不要直接 `db push`，无论是自托管还是托管数据库。**

### 5.4 升级流程

```bash
git pull
docker compose build
docker compose up -d      # 入口脚本会自动执行迁移
```

⚠️ **升级前务必先备份数据库。** 回滚方式：

```bash
git checkout <上一个版本>
docker compose build && docker compose up -d
# 若新版本包含破坏性迁移，需从备份恢复
```

---

### 5.5 地域封禁与 CORS（按部署方定制）

**"哪些地区能访问"是部署方的决定，不是源码里的常量。** 这些规则全部由环境变量驱动，
定义在 `src/config/region-policy.ts`，由 `proxy.ts`（中间件）执行。
**全部留空 = 不封禁任何地区 + 三个正式域名可跨域。**

| 变量 | 作用 | 默认 |
|---|---|---|
| `GEO_BLOCKED_COUNTRIES` | 黑名单：逗号分隔的国家码（如 `CN,RU`） | 空 = 不封禁 |
| `GEO_ALLOWED_COUNTRIES` | 白名单：只允许这些国家。**与黑名单同时配置时以本项为准** | 空 |
| `GEO_IP_WHITELIST` | 运维免检 IP（精确 `203.0.113.7` 或前缀 `203.0.113.*`） | 空 |
| `GEO_UNKNOWN_COUNTRY` | 取不到国家码时：`allow` / `block`（自托管常无 geo 头） | `allow` |
| `GEO_API_RETURNS_451` | 封禁时 API 返回 451 JSON（而非跳 HTML） | `1` |
| `CORS_ALLOWED_ORIGINS` | 允许跨域的 origin 列表 | 三个 lokfeel 域名 |
| `CORS_ALLOW_LOCALHOST` | 是否放行 `localhost` / `127.0.0.1` | `1` |
| `CORS_PREVIEW_ORIGIN_PATTERN` | 预览环境 origin 正则（留空则关闭） | Vercel 预览域名 |

三条**必须知道**的行为：

1. **IP 白名单优先于国家判定。** 否则被自己封禁的地区里，连运营者都进不了后台 ——
   旧实现里这个白名单变量是**声明后从未被读取的死代码**（P0-6 已修复并加断言锁住顺序）。
2. **API 路由不会被 302 跳到 `/blocked`。** 那是 HTML 页面，会让客户端
   `fetch().json()` 报 `Unexpected end of JSON input`；API 返回 `451` JSON 更准确。
3. **全域国家封禁属于合规决策**，启用前请做法务复核 —— 代码里的告警也会提醒这一点。

改完务必跑一次校验（不需要连库）：

```bash
npm run verify:geo
```

它会用矩阵断言覆盖黑名单/白名单/未知国家/IP 白名单/API 与页面、CORS 四种来源、缓存三档，
并检查 `proxy.ts` 里**不再残留硬编码**（防止有人又把它改回去）。

---

### 5.6 Bot 演示模块（默认关闭）

仓库里带一套**机器人 / 演示账号体系**（`BotProfile` 等 6 张表、`api/cron/bot-*`、
`api/bot-automation`），用于填充演示数据与压测。它**默认不启用** ——
一个"用户数靠机器人堆出来"的系统会直接损害部署方的信誉（见
[`OPEN-CORE-POSITIONING.md`](./OPEN-CORE-POSITIONING.md) §4）。

**总开关**：

| 变量 | 作用 | 取值 |
|---|---|---|
| `BOT_ENGINE_ENABLED` | Bot 模块总开关 | `false`（`.env.example` / `docker-compose.yml` 的发行默认）/ `true` |
| `BOT_TICK_INTERVAL_MS` | Tick 间隔（毫秒） | 默认 `60000` |
| `BOT_MAX_ACTIONS_PER_TICK` | 单次 tick 动作上限 | 默认 `50`（Serverless 建议 ≤ 100） |
| `BOT_MIN_ACTION_INTERVAL_MS` | 同一 Bot 两次动作最小间隔 | 默认 `30000` |
| `BOT_SPEED_MULTIPLIER` | 时间倍率（`1` = 实时） | 默认 `1`；>1 会成倍放大写库量 |

关闭后以下端点统一返回 **503**，响应体带 `disabledReason` 与启用指引：

- `/api/cron/bot-tick`、`bot-chat`、`bot-match`、`bot-online`、`bot-learning`
- `/api/bots/status`、`/api/bots/learning/stats`
- `/api/bot-automation`（GET 与 POST）

两处**容易踩的坑**：

1. **取值写错会按"关闭"处理（fail-closed）。** 例如 `BOT_ENGINE_ENABLED=flase` 不会
   被当成"启用"，而是关掉模块并在 `/api/health` 的 `botModule.warnings` 里报出原始取值。
   这是刻意的 —— 一个总开关如果拼错一个字母就关不掉，那它就不算开关。
   合法取值：`true/false`、`1/0`、`yes/no`、`on/off`、`enable/disable`。
2. **不要只在应用层关。** 定时器（Netlify scheduled function / cron-job.org /
   Vercel Cron）仍会照常打进来，只是每次拿到 503 —— 建议顺手把对应的定时任务也停掉，
   否则日志会被刷满。

部署后确认开关生效：

```bash
curl -s https://your-host/api/health | jq '.botModule'
# enabledSource: "env" | "legacy-default" | "invalid"
```

改了配置想验证，跑一次（不需要连库）：

```bash
npm run verify:bot
```

它会断言"代码默认 = 改造前行为""发行物默认 = 关闭""所有 Bot 入口都接上了开关"，
并检查每个入口**用到的符号都确实导入了**。

---

## 6. 备份策略

**只有两样东西需要备份**：数据库、对象存储。

### 6.1 数据库

```bash
# 备份
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-lokfeel}" -Fc "${POSTGRES_DB:-lokfeel}" \
  > "backup-$(date +%Y%m%d-%H%M%S).dump"

# 恢复
docker compose exec -T postgres \
  pg_restore -U "${POSTGRES_USER:-lokfeel}" -d "${POSTGRES_DB:-lokfeel}" --clean \
  < backup-YYYYMMDD-HHMMSS.dump
```

### 6.2 对象存储（用户上传的文件）

```bash
docker compose exec -T minio \
  tar -czf - /data > "minio-$(date +%Y%m%d).tar.gz"
```

### 6.3 建议

| 项 | 建议 |
|---|---|
| 频率 | 每日自动备份，保留 30 天 |
| 位置 | **异地**存储（不要和数据库同一台机器） |
| 验证 | **每季度做一次恢复演练** —— 没验证过的备份不算备份 |
| 加密 | 备份文件含用户数据，传输与存储都应加密 |

---

## 7. 安全清单（上线前逐项确认）

- [ ] 所有密钥为随机生成，无任何示例值残留
- [ ] `NEXTAUTH_URL` 为 https 生产域名
- [ ] 数据库与 Redis **未**暴露公网端口
- [ ] MinIO 控制台（9001）未暴露公网
- [ ] 已配置反向代理与有效 TLS 证书
- [ ] WebSocket 转发已配置（否则实时功能不可用）
- [ ] 已接入备份，且**做过一次恢复演练**
- [ ] 已配置日志收集与告警（异常登录、越权、大规模导出）
- [ ] 已阅读 `SECURITY.md` 第 5 节的部署方安全责任
- [ ] 已阅读 `TRADEMARK.md` —— 修改版部署需自行改名
- [ ] 若面向成人场景，已自行评估本地法律要求（年龄验证等）并启用相应合规模块

---

## 8. 遥测说明

本项目**默认不收集任何遥测数据**（`TELEMETRY_ENABLED=false`）。

若你选择开启匿名遥测（帮助了解部署规模与版本分布），请知悉：

- 收集内容：版本号、部署实例标识（随机 UUID）、功能使用计数
- **不收集**：用户数据、内容、IP、可识别信息
- 可随时关闭，立即生效

> 设计原则：开源项目的遥测必须是**显式 opt-in**，且默认关闭。

---

## 9. 内容与合规责任

本项目是**技术引擎**，不提供任何内容，也不托管任何数据。

自托管部署方对以下事项**承担全部责任**：

- 所运营内容的合法性与平台政策合规
- 用户数据的收集、存储、处理与删除（GDPR / 当地隐私法）
- 年龄验证等特定场景下的法律要求
- 支付收款通道的申请与合规

详见 `SECURITY.md` 第 5 节与 `TRADEMARK.md` 第 7 节。

---

## 10. 获取帮助

| 问题类型 | 渠道 |
|---|---|
| 部署报错、配置疑问 | GitHub Discussions |
| 疑似缺陷 | GitHub Issues（附 `docker compose logs` 与版本号） |
| 安全漏洞 | **私下披露**，见 `SECURITY.md` —— 请勿开公开 Issue |

提 Issue 时请附上：

```bash
docker compose version
docker compose ps
docker compose logs --tail=100 app
```

---

*最后更新：2026-09-27*
