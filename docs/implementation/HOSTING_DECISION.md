# 托管决策：不买服务器，继续 Netlify 免费版 + Cloudflare

> 2026-10-20 · 触发原因：用户明确「我没有服务器」
> 结论：**不迁移、不采购**。现有架构每一层都是托管服务，自托管没有解决任何现存问题。

## 一、先看事实：现在已经全部托管

| 能力 | 承载方 | 是否需要自己运维 |
|---|---|---|
| 站点 / SSR / API | **Netlify**（`nf_team_dev` 免费档） | 否 |
| 边缘 / DNS / WAF / TLS | **Cloudflare**（NS 已在 CF，橙云代理） | 否 |
| 数据库 | **Turso**（libSQL） | 否 |
| 缓存 / 限流 | **Upstash Redis** | 否 |
| 实时 IM | **Pusher**（`PUSHER_*` / `NEXT_PUBLIC_PUSHER_*` 已在生产） | 否 |
| 视频通话信令 | **Firebase** + **Metered TURN**（`TURN_TOKEN_ID` / `TURN_API_TOKEN`） | 否 |
| 邮件 | **Resend** | 否 |
| 登录 | NextAuth + Google / Twitter OAuth | 否 |

也就是说：**自托管要解决的问题（缺宿主机、缺常驻进程）本来就不存在。**
`useSocket.ts` 里那条 `io(undefined, { path: '/api/socketio' })` 在 Netlify 上连不上，但生产 IM 走的是 Pusher 那条路，
`server.ts`（socket.io）只在本地 `npm run dev:socket` 时用 —— 不是生产依赖。

## 二、用量：现在离免费额度上限还有三个数量级

| 指标 | 实测 | 免费额度 | 占比 |
|---|---|---|---|
| 带宽（本期 2026-09-29 → 10-29） | **252,000,751 B ≈ 240 MiB** | 100 GB | **0.24%** |
| 生产部署 | `6ad6ff35e768` ← `40ade53`（cron 405 修复已上线） | — | — |
| 站点状态 | `state=current`，CF 在前（`cf-ray` + `x-nf-request-id`） | — | — |

按当前用量，**要再涨约 400 倍流量才会碰到 100 GB**。上线初期不存在额度问题。

## 三、唯一真正的上线阻断：4 个支付凭据

生产 `/api/health` 原样返回（2026-10-20 实测）：

```json
{"configured": false, "charging": false,
 "channels": {"creem.checkout": false, "creem.webhook": false,
              "stripe.card": false, "stripe.refund": false, "stripe.webhook": false},
 "missing": ["CREEM_API_KEY", "CREEM_WEBHOOK_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]}
```

这 4 个是**账号凭据**（Creem / Stripe 各注册一次），与有没有服务器完全无关。
其余功能（登录、匹配、IM、视频、站内信）在支付未接入时照常工作 —— 由 `verify:payment:off` 的 18 条断言守着。

## 四、什么情况下才值得重新考虑买服务器

只有这四条之一成立才需要，且都不是现在：

| 触发条件 | 现状 | 到时候的最小方案 |
|---|---|---|
| 需要**分钟级** cron（bot-tick 每分钟） | Netlify 免费档的 scheduled function 最快每小时；仓库内的 `cron-runner` 现为小时级 | 先用 **Cloudflare Worker Cron**（免费，1 分钟粒度）打 `/api/cron/*`，仍不需要服务器 |
| 需要**常驻进程 / 长连接**（自建 socket、长任务队列） | 现用 Pusher + 轮询，够用 | 那时才需要一台机器 |
| 函数**区域**必须靠近亚洲 | `functions_region=us-east-1`，CF 边缘在香港/日本，跨境回源约 150–250ms | 先把热点路由改成静态/ISR；仍不够再考虑搬 |
| 免费额度被打满 | 带宽 0.24% | 先升 Netlify 付费档（比自建便宜且不用运维） |

若哪天确实要买：**腾讯云香港轻量 2C2G 约 ¥24–40/月**（免 ICP）。届时用仓库里现成的
`deploy/selfhost/` 一套（bootstrap → tunnel-once → deploy → cron），**不用重新设计**。

## 五、自托管那套资产怎么处理

**冻结，不删。** 已经过自证，随时可用：

| 资产 | 状态 |
|---|---|
| `deploy/selfhost/bootstrap.sh` | 只读自证 8/8 |
| `deploy/selfhost/tunnel-once.sh` | 夹具自证 36/36（prepare 不动 DNS、switch 先备份） |
| `deploy/selfhost/deploy.sh` | 11/11（含健康检查失败自动回滚） |
| `deploy/selfhost/cron/` | 17/17（systemd timer，按设计频率） |
| `scripts/qa/selfhost-gate.mjs` | 8 PASS / 0 FAIL / 3 BLOCKED（BLOCKED 只在自托管后才可判定） |

判据留着：**只有在真的搬了之后**，S2/S3/S4 才有意义（DNS 不含源站、3000/80/443 从公网不可达）。
在那之前它们必须保持 BLOCKED —— 不允许为了让报表变绿而把它们改成 PASS。

## 六、这一轮顺带修的一个真问题：探活在撒谎

**症状**：连续三次读 `/api/health` 得到**完全相同**的 `dbLatency=5615ms`；
带缓存体检时却是 286ms。不是数据库很稳，是**看到的是 60 秒前的快照**。
更糟的是坏发布期间，边缘仍会对监控喊 200 healthy。

**根因是两层，缺一不可**（第一版只改了第二层，等于没改）：

| 层 | 位置 | 原值 |
|---|---|---|
| ① 边缘怎么存 | `next.config.ts` → `headers()` | `public, max-age=60` + `Surrogate-Control: public, max-age=60` |
| ② 函数返回什么 | `src/app/api/health/route.ts` | 同上的 `Cache-Control` |

🔴 **`next.config.ts` 的 `headers()` 优先级高于 route handler 自己写的头** ——
所以在 ② 里改成 `no-store` 完全无效，线上仍是 `max-age=60`（实测响应头一字未变）。

**修法**：① 改 `no-store, max-age=0` 并删掉 `Surrogate-Control`；② 同步改，另补
`export const dynamic = 'force-dynamic'`（仓库其它 300+ 路由都有，属遗漏）。

**验证**（`scripts/qa/verify-health-live.mjs`，5 条线上断言 + 7 条自证含变异）：

```
✅ H1 200 · ✅ H2 no-store,max-age=0 · ✅ H3 无 Surrogate-Control
✅ H4 3/3 个不同 timestamp · ✅ H5 latencies=[1198,31,13]
RESULT: PASS · 5 PASS / 0 FAIL
```

顺带纠正一个此前的误判：真实 DB 延迟是 **13–31ms（预热）/ ~1.2s（冷启）**，
`5615ms` 是缓存出来的数字，不能用它判断数据库性能。

> 教训：**改响应头无效时，先查 `next.config headers()` → middleware/`proxy.ts` → 边缘规则**这三层，
> 再怀疑自己改的那一处。头是分层写的，最后一层不一定是你以为的那层。
