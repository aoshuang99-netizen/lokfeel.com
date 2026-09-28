# IM 侧 Redis 依赖与降级矩阵

> 归属：P1-6 阶段 5（G-4）· 2026-09-27
> 相关代码：`src/lib/im/redis/index.ts`、`src/lib/im/services/*`、`src/app/api/health/route.ts`
> 关联任务：P1-1 自托管交付物、P0-2 多租户

## 1. 为什么需要这份文档

IM 的多个核心能力建立在 Redis 之上。这在 Vercel + Upstash 的托管组合里没问题，
但 P1-1（自托管交付物）与 P0-2（多租户）都要求：**不配置任何外部 Redis 也能跑起来**，
且**必须清楚知道哪些能力会弱化**。

改造前（2026-09-27 之前）的实际情况是：**降级路径存在，但它是坏的** ——
`getRedis()` 在未配置 Upstash 时每次调用都新建一个空的进程内存储，
于是令牌桶永远是满的（**反骚扰限流失效**）、在线状态写完即丢、
通用限流（`lib/rate-limit.ts`）的 `incr` 恒返回 1（**所有请求放行**）。
而日志还在打印 `using in-memory fallback` —— 看起来在正常工作。

> 这比"没有降级"更危险：没有降级会立刻 500，问题当场暴露；
> 坏掉的降级会安静地继续服务，把安全能力一点点去掉。

本版本（G-4 修复）做了：内存后端单例化、显式后端探测、熔断、
Presence 全面 fail-open、健康检查上报。下面把这套机制与**能力矩阵**讲清楚。

## 2. 三种运行状态

| 状态 | 判据 | `getRedisBackend()` |
|---|---|---|
| **托管正常** | 配置了 Upstash 且可达 | `upstash` |
| **自托管降级** | 未配置 `UPSTASH_REDIS_REST_URL` / `_TOKEN` | `memory`（**预期行为**） |
| **故障降级** | 已配置但调用失败 → 熔断 60s | `memory`（**需要关注**） |

区分第 2、3 种状态很重要：自托管单实例看到 `memory` 是设计如此；
而托管环境看到 `memory` 意味着 Redis 挂了，能力正在弱化。

`GET /api/health` 的 `redis` 字段会区分它们：

```json
{
  "redis": {
    "backend": "memory",
    "configured": true,          // ← true + backend=memory = 故障降级，需处理
    "degraded": true,
    "degradedForMs": 41230,
    "degradedReason": "pace.checkRateLimit: fetch failed",
    "degradeCount": 7
  }
}
```

## 3. 能力降级矩阵

| 能力 | 依赖 | Upstash 正常 | 自托管（内存后端） | 影响评级 |
|---|---|---|---|---|
| **反骚扰节奏控制**（令牌桶） | `PaceController` + HSET | 跨实例精确 | **仅进程内**：单实例语义完整；多实例额度叠加 | 🔴 高 |
| **在线状态**（Presence） | `PresenceManager` + `UserPresence` 表 | 跨实例准确 | 仅进程内，重启即丢；`UserPresence` 表仍可作兜底 | 🟡 中 |
| **通用限流**（`lib/rate-limit.ts`） | `getRedis()` + INCR | 跨实例精确 | **仅进程内**：多实例上限变为 N × max | 🔴 高 |
| **打字指示** | `RedisKeys.typing` + 5s TTL | 正常 | 仅同实例可见（基本等于不可用） | 🟢 低 |
| **连接映射 / 定向投递** | `RedisKeys.connection` | 正常 | 仅同实例可见 | 🟡 中 |
| **规则缓存** | `RedisKeys.rules` | 命中缓存 | 每次回表查询（变慢，结果一致） | 🟢 低 |
| **Consent 缓存** | `RedisKeys.consent` | 命中缓存 | 每次回表查询（结果一致） | 🟢 低 |
| **消息序列号 `seq`** | `SeqGenerator`（Redis INCR） | 跨实例单调 | ⚠️ 见 §4 —— **不能**用内存实现 | 🔴 高 |
| **审计日志链** | 无（纯 DB，hash-chained） | 正常 | 正常 | — |
| **E2EE / Power Board / 媒体分级** | 无（纯 DB） | 正常 | 正常 | — |

**结论**：自托管单实例（Docker 单容器）下，除 `seq` 外全部能力**语义完整**。
多实例水平扩容时，限流类能力（节奏控制、通用限流）**必须**接真实 Redis。

## 4. 唯一的硬依赖：`seq` 的跨实例单调性

`IMMessage.seq` 是会话内的单调序号，前端靠 `afterSeq` 做**增量轮询**。
它要求"同一个会话的序号在全局严格递增"。

`SeqGenerator` 用 `Redis INCR` 实现原子递增。这在内存后端下**不成立**：
两个实例各自 `incr` 会给出相同序号 → 主键冲突或前端增量丢消息。

**当前的处置（重要）**：`SeqGenerator` 目前**没有任何调用方** ——
`/api/im/send` 与 Legacy 分发器都改为从 `IMMessage` 表内取 `max(seq) + 1`
（见 `src/app/api/im/send/route.ts`）。也就是说 `seq` 的事实来源是**数据库**，
Redis 只是遗留的备用实现。

因此：

- **自托管不需要 Redis 也能保证 `seq` 正确**（走 DB）。
- `SeqGenerator` 保留但**不得在无 Redis 环境下启用**。若将来要重新启用它，
  必须先改成"Redis 优先 + DB 兜底"，或用带 `WHERE seq = ?` 乐观重试的 DB 实现。
- 表内 `max(seq)+1` 的代价是并发同会话发送需要处理唯一约束冲突后重试 ——
  这条路径**已存在**（迁移脚本与发送路径均按上界计算），本条仅作为设计记录。

## 5. 熔断（circuit breaker）

Upstash **已配置但不可达**时（超时 / 配额耗尽 / 网络故障），
行为是：**失败一次 → 进入 60s 冷却窗口 → 窗口内所有调用直接走内存后端**。

为什么必须有熔断：没有它，每个请求都要先等一次 Redis 超时（默认数秒）才降级 ——
一次 Redis 故障会让**整站响应时间乘以超时值**，而不只是聊天变慢。

实现细节（`src/lib/im/redis/index.ts`）：

- `markRedisUnavailable(reason)`：记录原因、累加计数、设置冷却窗口。
- **窗口内重复调用不续期** —— 否则持续故障会让熔断永不恢复，
  即使 Redis 已修好也要等重启才回切。
- `probeRedis()`：主动 ping 探测；**成功即立刻清除熔断**，不必等 60s。
  适合放在 `/api/health` 或定时任务里。
- `clearRedisDegradation()`：运维手动回切。

调用点：`PaceController`（已 fail-open）与 `PresenceManager`（本次新增 fail-open）
在捕获到 Redis 异常时都会触发熔断。

## 6. 自托管部署建议

```bash
# 最小可用（单实例）：什么都不用配
# 未设置 UPSTASH_* → 自动使用进程内内存后端
# 验证：curl -s localhost:3000/api/health | jq .redis
#   → { "backend": "memory", "configured": false, ... }  ← 预期

# 推荐：接自己的 Redis（Upstash 兼容 REST 协议）
UPSTASH_REDIS_REST_URL=https://<your-redis>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>

# 若使用非 Upstash 的 Redis（如自建 redis-server），需要适配层：
# 本仓库只实现了 Upstash REST 客户端；自建 Redis 需增加 ioredis 适配
# （当前未实现，见 §7）
```

**多实例部署的最低要求**：配置真实 Redis。内存后端下
「反骚扰节奏控制」与「通用限流」的额度会按实例数线性放大 ——
这是**安全能力**的弱化，不能靠加实例来"稀释"。

## 7. 尚未实现的部分（诚实清单）

| 项 | 现状 | 影响 |
|---|---|---|
| 自建 Redis（非 Upstash REST）适配 | ❌ 未实现。仅有 `@upstash/redis` 客户端与内存后端 | 自托管用户若想用 `redis-server`，需自行实现适配层或使用 Upstash 兼容网关 |
| `SeqGenerator` 的 DB 兜底 | ❌ 未实现（但当前无调用方，见 §4） | 若重新启用需先补 |
| 降级状态的主动告警 | ⚠️ 仅 `/api/health` 可查，无自动通知 | 需要运维侧轮询健康检查 |
| 内存后端的容量上限 | ⚠️ 无 TTL 之外的容量控制 | 极端流量下进程内存增长（现有 TTL 已覆盖绝大多数 key） |
| typing / deliveryQueue 的多实例一致性 | ❌ 依赖 Redis | 内存后端下基本不可用（评级低，见矩阵） |

## 8. 验证方式

```bash
# 1) 未配置 Redis 时，确认后端为 memory 且**状态在多次调用间保持**
#    （这是 G-4 修复的核心：改造前每次调用都是新的空存储）
curl -s localhost:3000/api/health | jq .redis

# 2) 起两个请求，确认限流计数递增（改造前恒为 1，等于不限流）
#    对任意被 rateLimit() 包裹的端点连续请求 > max 次，应出现 429

# 3) 配置错误的 UPSTASH_REDIS_REST_URL + 正确 token，确认：
#    · 首个请求出现 Redis 连接错误日志
#    · /api/health 的 redis.degraded 变为 true，degradedReason 有内容
#    · 后续请求不再出现同类日志（熔断生效，不再每次等超时）
```
