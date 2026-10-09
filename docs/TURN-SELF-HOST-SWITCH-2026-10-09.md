# TURN 自建 / 托管切换 Runbook

> 2026-10-09 · 适用 `app.lokfeel.com`（Netlify site `lokfeel`）
> 配套脚本：`scripts/qa/verify-turn-candidate.mjs`（切换前预检）、`scripts/qa/verify-turn-prod.mjs`（切换后复核）

---

## 0. 现状基线（2026-10-09 实测）

| 项 | 值 |
|---|---|
| Netlify site | `lokfeel` · `c46478e9-7ac8-4bcf-9052-7638b04fef83` · app.lokfeel.com |
| Netlify account slug | `aoshuang99`（环境变量全部为 **site 级**，账户级 0 条） |
| `NEXT_PUBLIC_ENABLE_VIDEO_CALL` | `1` ✓（视频通话入口已开放） |
| `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` | **未设** → 当前 `source = 'cloudflare'` |
| 兜底端点 | `speed.cloudflare.com/turn-creds`（免凭据，1000 GB/月免费） |
| 链路 | `GET /api/rtc/ice-servers`（登录态签发）→ 前端 `loadIceServers()` 预取缓存 |

**为什么要留这份 Runbook**：当前兜底是 `speed.cloudflare.com/turn-creds` —— 它是 Cloudflare **测速页**用的端点，不是有 SLA 的对外产品合同。它随时可能加来源校验或下线。一旦下线，对称 NAT 用户的通话会静默退化（`staticTurn()` 为空 → 只剩 STUN → §8 第 3 行）。

---

## 1. 四条路径决策矩阵

| 路径 | 单位成本 | 需改代码 | 凭据形态 | 适用 |
|---|---|---|---|---|
| **现状** Cloudflare speed 端点 | 免费 1000 GB/月 | ✗ | 短时（10 min 缓存） | 当前，够用但无合同保障 |
| **A. 自建 coturn** | VPS 包月带宽（Hetzner/OVH 系 ~$5–50/月含数十 TB） | ✗ | 长期静态 | 量大、且愿意运维 |
| **B. 托管静态凭据** Metered / Xirsys / Twilio NTS | Metered ~$99/150 GB；Twilio NTS ~$0.40/GB | ✗ | 长期静态 | 量小、不想运维 |
| **C. Cloudflare Realtime TURN** | **$0.05/GB，前 1000 GB/月免费** | ✅ 约 30 行 | 短时（API 签发） | **推荐终局**：最省 + 有合同 + 全球 anycast |

> A / B 走**现成的三条 env**，零代码改动 → 本文档第 3、4 节。
> C 需要一小段代码（第 5 节），但成本与稳定性都优于 A/B。

---

## 2. 成本闸门（比选供应商更重要）

先把闸门关好，再谈换供应商 —— 否则换谁都白搭。

| 闸门 | 说明 |
|---|---|
| 🚫 **禁止 `iceTransportPolicy: 'relay'`** | 一旦进生产，**100% 通话**走中继（正常只有 10–20%），带宽直接 ×5。该参数**只能用于测试**（本仓库仅在 `verify-turn-candidate.mjs` 的隔离探针里使用） |
| ✅ **STUN 必须健康** | STUN 挂掉时客户端拿不到 `srflx`，本该直连的通话全部静默退到中继 → 账单悄悄翻倍且**没有任何报错** |
| ✅ **提供 TCP/TLS 443 回退** | 企业网/部分移动网络封 UDP；只有 UDP 时这些用户通话**直接失败** |
| ✅ IPv6 优先 | 双端 IPv6 可直连的场景，v4 CGNAT 下只能走中继；IPv6 是廉价的"降 relay 占比"手段 |

**用量估算公式**（双向计费）：

```
月中继 GB = 月通话分钟 × 码率(Mbps) × 60 ÷ 8 ÷ 1024 × relay占比 × 2
```

代入当前规模（720p ≈ 1.5 Mbps，1,000 分钟/月，relay 15%）：
`1000 × 1.5 × 60 ÷ 8 ÷ 1024 × 0.15 × 2 ≈ 3.3 GB/月`

> **结论**：现阶段**连免费额度都远没用满**。切换 TURN 的理由是**合同稳定性与可预测性**，不是省钱。所以优先选 C（同为 Cloudflare，改动最小、成本最低），除非你有明确的合规要求必须自持中继。

---

## 3. 路径 A：自建 coturn —— 切换 Checklist

### 3.1 服务器侧（一次性，约 20 分钟）

1. **选机型**：带宽包月型 VPS（Hetzner / OVH / 同类）。1 vCPU + 1–2 GB 足够（coturn 转发几乎不吃 CPU，**贵的是带宽**）。
   - ❌ 不要用按 GB 计费的 hyperscaler：egress $0.08–0.12/GB，10 TB 就是 ~$1,000/月；包月型通常含数十 TB。
   - 部署在**用户集中区域**（中继会增加一跳，约 +10–50 ms）。
2. **安装**：`apt-get install coturn`；`/etc/default/coturn` 里置 `TURN_SERVER_ENABLED=1`。
3. **`/etc/turnserver.conf` 关键项**：

   ```ini
   listening-port=3478
   tls-listening-port=5349
   min-port=49152
   max-port=65535
   realm=lokfeel.com
   fingerprint
   lt-cred-mech
   no-multicast-peers
   no-cli
   no-tlsv1
   no-tlsv1_1
   # NAT 后的机器必须写公网 IP，否则 relay 候选地址不可达
   external-ip=<公网IP>
   # TLS（turns: 需要）
   cert=/etc/letsencrypt/live/turn.lokfeel.com/fullchain.pem
   pkey=/etc/letsencrypt/live/turn.lokfeel.com/privkey.pem
   # 防滥用
   user-quota=12
   total-quota=1200
   max-bps=1000000
   ```

4. **建用户**（长期凭据，路径 A/B 都用静态凭据）：
   `turnadmin -a -u lokfeel -p '<强密码≥24位>' -r lokfeel.com`
5. **放行端口**（安全组 + 本机防火墙都要）：
   | 端口 | 协议 | 用途 |
   |---|---|---|
   | 3478 | UDP + TCP | TURN/STUN |
   | 5349 | TCP | TURN over TLS |
   | 49152–65535 | UDP | **中继端口段**（最常漏，漏了表现为「凭据对但拿不到 relay」） |
6. **证书**：`turn.lokfeel.com` 用 Let's Encrypt 签发（DNS-01 更省事）。
7. **自测**：用 WebRTC Trickle-ICE 页填 `stun:<IP>:3478`，看是否返回 `srflx`。

### 3.2 本地预检（**切换前必跑，不可跳过**）

```bash
cd nexus-app
TURN_URLS="turn:turn.lokfeel.com:3478?transport=udp,turn:turn.lokfeel.com:3478?transport=tcp,turns:turn.lokfeel.com:5349?transport=tcp" \
TURN_USERNAME=lokfeel \
TURN_CREDENTIAL='<强密码>' \
node scripts/qa/verify-turn-candidate.mjs
# 或： npm run verify:turn:candidate
```

**判据**：`16 通过 / 0 失败`，且 `[B]` 节每条 URL 都出现 `relay≥1`。

> ⚠️ **为什么必须跑**：`staticTurn()` 的优先级**高于** Cloudflare 兜底。配错的值会把当前**可用**的兜底顶掉，把一个"部分场景可连"的状态换成"更差的状态"，且没有任何报错。

### 3.3 写入生产环境变量

```bash
curl -X POST \
  "https://api.netlify.com/api/v1/accounts/aoshuang99/env?site_id=c46478e9-7ac8-4bcf-9052-7638b04fef83" \
  -H "Authorization: Bearer $NETLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"key":"TURN_URLS","values":["turn:turn.lokfeel.com:3478?transport=udp,turn:turn.lokfeel.com:3478?transport=tcp,turns:turn.lokfeel.com:5349?transport=tcp"],"is_secret":false},
    {"key":"TURN_USERNAME","values":["lokfeel"],"is_secret":false},
    {"key":"TURN_CREDENTIAL","values":["<强密码>"],"is_secret":true}
  ]'
# 回读核对（写入 201 ≠ 写成功，必须回读）
curl -s "https://api.netlify.com/api/v1/accounts/aoshuang99/env?site_id=c46478e9-7ac8-4bcf-9052-7638b04fef83" \
  -H "Authorization: Bearer $NETLIFY_TOKEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const e of JSON.parse(s))if(/^TURN_/.test(e.key))console.log(e.key,'=',/(CREDENTIAL)/.test(e.key)?'len='+(e.values[0].value||'').length:e.values[0].value)})"
```

**生效时机**：`route.ts` 里 `process.env.TURN_URLS` 是在**函数体内**读取（非模块顶层），属运行时求值。因此通常无需重新部署；但 Netlify 的函数实例可能持有旧配置，**最稳妥是触发一次 redeploy**。判定方式见 3.4：若 `source` 仍是 `cloudflare`，就触发一次重新部署。

### 3.4 切换后复核

```bash
QA_CONV=<conversationId> QA_EXPECT_ICE_SOURCE=static npm run verify:turn:prod
```

| 期望 | 含义 |
|---|---|
| `source = static` | 三条 env 已生效（未生效则触发一次 redeploy 再测） |
| TURN 条目 urls = 你的自建地址 | 未被兜底覆盖 |
| `relay ≥ 1` | 真实 Chrome 能分配中继 |
| 按钮 `title="Start video call"` | 通话入口未受影响 |

### 3.5 回滚（< 5 分钟）

```bash
# 删除三条 → 自动回到 Cloudflare 兜底，无需改代码
for k in TURN_URLS TURN_USERNAME TURN_CREDENTIAL; do
  curl -s -X DELETE \
    "https://api.netlify.com/api/v1/accounts/aoshuang99/env/$k?site_id=c46478e9-7ac8-4bcf-9052-7638b04fef83" \
    -H "Authorization: Bearer $NETLIFY_TOKEN" -o /dev/null -w "$k %{http_code}\n"
done
# 回读应为 0 条；再跑 verify:turn:prod（不设 QA_EXPECT_ICE_SOURCE）应回到 source=cloudflare
```

> 回滚之所以只要 5 分钟，是因为**代码里没有硬编码任何 TURN 地址** —— 这是本次改造刻意保留的性质，请勿在后续提交中破坏。

---

## 4. 路径 B：托管静态凭据（Metered / Xirsys / Twilio NTS）

1. 在供应商面板创建 TURN 应用，拿到 `urls` / `username` / `credential`（**静态长期凭据**）。
2. 若面板返回的 `urls` 里含 `stun:` 条目 —— **保留即可**（WebRTC 允许一个 `iceServer` 混合 stun/turn，凭据只作用于 turn 那条）。预检会提示"冗余但合法"。
3. 直接跳到 **3.2 预检 → 3.3 写入 → 3.4 复核**。零代码改动。
4. ⚠️ 静态长期凭据必须配**配额或 IP 白名单**。凭据一旦泄露（例如误设成 `NEXT_PUBLIC_*` 被内联进 bundle），中继费用就是别人在花。预检的 `[D]` 节会扫描前端 chunk 做泄露检查。

---

## 5. 路径 C：Cloudflare Realtime TURN（推荐终局，需 ~30 行代码）

### 5.1 控制台准备

Cloudflare Dashboard → **Realtime** → **TURN** → 新建 TURN Key，得到：
- `TURN_TOKEN_ID`（Key ID，非机密）
- `TURN_API_TOKEN`（API Token，**机密**）

### 5.2 凭据签发接口

```
POST https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_TOKEN_ID}/credentials/generate
Authorization: Bearer {TURN_API_TOKEN}
Content-Type: application/json

{"ttl": 86400}
```

返回体形状与现有 `IceServersResponse` 兼容（`{ iceServers: { urls, username, credential } }`，注意**不是数组**，需要适配）。

### 5.3 代码改动点（唯一一处）

`src/app/api/rtc/ice-servers/route.ts` 的 `build()`，在 `staticTurn()` 之后、Cloudflare speed 端点之前插入一级来源：

```
1.   staticTurn()                        ← TURN_URLS 三条 env（路径 A/B）
1.5  cloudflareRealtimeTurn()   ← 【新增】TURN_TOKEN_ID + TURN_API_TOKEN
2.   speed.cloudflare.com/turn-creds     ← 现有兜底
3.   仅 STUN                             ← 不失败
```

新增 env：`TURN_TOKEN_ID`、`TURN_API_TOKEN`（均为**服务端**，不带 `NEXT_PUBLIC_`）。给出凭据时应把 `ttl` 设到与 `CACHE_TTL_MS` 匹配或更长，避免缓存期外凭据失效。

### 5.4 端口（Cloudflare Realtime TURN）

| 服务 | 地址 | 主端口 | 备用端口 |
|---|---|---|---|
| STUN over UDP | `stun.cloudflare.com` | 3478/udp | — |
| TURN over UDP | `turn.cloudflare.com` | 3478/udp | 443/udp |
| TURN over TCP | `turn.cloudflare.com` | 3478/tcp | 80/tcp |
| TURN over TLS | `turn.cloudflare.com` | 5349/tcp | 443/tcp |

限流（**每个 allocation 独立**，非账户级）：新建 IP >5/s、报文 >5–10 kpps、速率 >50–100 Mbps。

---

## 6. 故障对照表

| 现象 | 判据 | 处置 |
|---|---|---|
| 有 `srflx` 无 `relay` | 预检 `[B]` 全 ❌ | 凭据错 / `realm` 不匹配 / 用了 `password` 而非 `credential` 字段 |
| 只有 `host` 候选 | 预检 `[C]` ❌ | STUN 不可达 → 检查出网 |
| 凭据正确但 `relay=0` | `[B]` ❌ 且 ICE 错误码 `701` | **中继端口段 49152–65535/udp 未放行**（最常见） |
| 部分网络失败、公司网尤甚 | 预检 ✅ 但仍有人连不上 | 缺 TCP/TLS 443 回退 → 加 `turns:host:443` |
| 通话正常但带宽账单高 | 前端有 `iceTransportPolicy:'relay'` | 删除该参数；核对 STUN 健康度 |
| 切换后 `source` 仍 `cloudflare` | 复核断言失败 | 触发一次 redeploy；核对 `site_id` 是否写对（账户级变量不会被 site 读取，本项目变量全在 site 级） |
| 切换后**通话完全不可用** | 复核 `relay=0` 且原先是好的 | **立即回滚**（3.5），再按上表逐项排查 |

---

## 7. 日常监控

| 位置 | 观测点 |
|---|---|
| 浏览器 Console | `[ICE] 配置已加载：N 组，TURN=yes/no` |
| Netlify 函数日志 | `[ice-servers]` 前缀的 warn（Cloudflare 端点非 200 / 不可达） |
| API 响应头 | `x-ice-cache: hit/miss`（miss 频繁 = 缓存未命中，函数被打得很勤） |
| coturn 侧 | `turnutils_uclient`；`--prometheus` 导出 per-session 字节数 |
| Cloudflare 侧 | Realtime analytics（TURN 用量约 30 秒延迟可见） |

---

## 8. 一句话版本

**现在不用换。** 若哪天 `speed.cloudflare.com/turn-creds` 失效，按**路径 C** 接 Cloudflare Realtime TURN（$0.05/GB + 1 TB 免费、代码仅一处、凭据短时）；若必须自持中继，按**路径 A** 起 coturn，**切换前务必先跑 `verify:turn:candidate` 拿到 16/0** —— 因为它优先级高于兜底，配错会把可用状态换成不可用状态。
