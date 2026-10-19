# LokFeel 自托管：Cloudflare Tunnel + Git 部署

> 2026-10-19 22:00 · 依据：本轮实测 `app.lokfeel.com` / `lokfeel.com` 响应头与 DNS + 仓库现状（`nexus-app/`，main @ `351c9bb`）

## 〇、先纠正一个前提

**LokFeel 的 CF 已经在前面了，这次要换的是「回源」。**

| 证据 | 实测 |
|---|---|
| NS | `cloe.ns.cloudflare.com.` / `rocky.ns.cloudflare.com.` |
| apex + app 的 A | `104.21.88.244` / `172.67.154.126`（CF anycast） |
| 响应头 | `server: cloudflare`、`cf-ray: …-AMS`、`cf-cache-status: DYNAMIC` |
| 回源 | `x-nf-request-id`、`vary: … X-Nf-Account-Tier` ⇒ **Netlify** |

所以「服务器直接连接 CF」= **把回源从 Netlify 换成自有服务器，用 cloudflared 出站长连**。DNS 只改一条 CNAME，不用动 NS。

## 一、现状体检（迁移前基线）

| 项 | 现状 | 迁移影响 |
|---|---|---|
| HSTS | `max-age=63072000; includeSubDomains; preload` | 已 preload，**域名不能回退到 http**；迁移期间必须保持 443 可用 |
| `X-Content-Type-Options` | `nosniff` | 保持 |
| `/dashboard` 未登录 | **307 → /login**，`cache-control: private,no-store` | 正确，迁移后应一致 |
| `/login` | 200，`cache-control: public`（无 s-maxage） | CF 默认不缓存 HTML，但**不要开 Cache Everything** |
| `/api/health` | 200，`public, max-age=60`；返回 `dbLatency`/`redis.backend`/`botModule`/`firebaseAdmin`/`payments.channels` | 内容偏多，迁移时顺手收敛；自托管后 **`/api/*` 必须 bypass 缓存** |
| 已知坑 | `src/lib/auth/config.ts:32`：`AUTH_URL` 未设时回落 `http://localhost:${port}` | **自托管必设 `AUTH_URL=https://app.lokfeel.com`**，否则 OAuth 回调与 cookie 全错 |

## 二、目标拓扑

```
浏览器 → Cloudflare 边缘（已就位）→ cloudflared（服务器出站，无入站端口）
                                      └→ 127.0.0.1:3000  next standalone
                                            ├→ Turso（libSQL）
                                            ├→ Upstash（限流/缓存）
                                            └→ Pusher（实时）
```

**不额外加 nginx**：Tunnel 可以直接 `http://127.0.0.1:3000`，少一层代理就少一处 `X-Forwarded-*` 配错的地方。只有需要「同一台再挂别的站」时才加。

**为什么是 Tunnel 而不是橙云直连源站**：直连必须把源站 443 暴露给公网，再靠防火墙只放 CF 15 个段；Tunnel 让源站**根本没有入站入口**，IP 也不进 DNS。前者靠纪律，后者靠结构。

## 三、施工顺序（S0–S7）

### S0 · 服务器
- 规格：**2C4G + 4G swap**（Turbopack 构建对内存敏感，2G 会 OOM）、40G 盘、Ubuntu 24.04、Node 22 LTS。
- 位置：香港/新加坡（免备案）；大陆节点需 ICP，1–3 周。
- 与现在 Netlify 的关系：**并行跑**，不拆 Netlify，直到 S7 验收通过 48h。

### S1 · Tunnel + DNS
```bash
cloudflared tunnel login && cloudflared tunnel create lokfeel
# /etc/cloudflared/config.yml 见 deploy/selfhost/cloudflared.yml
cloudflared service install && systemctl enable --now cloudflared
```
DNS 只改一条：`app.lokfeel.com` 的 CNAME → `<UUID>.cfargotunnel.com`，**保持橙云**。
apex `lokfeel.com` 若是营销页，可先不动（它现在也指向 Netlify）。

### S2 · 构建（最容易翻车的一步）
两个硬约束：
1. **18 个 `NEXT_PUBLIC_*` 在构建期被内联**，构建机环境变量必须与线上一致；改完不重建 = 不生效。
2. `output: 'standalone'` 由 `BUILD_TARGET=standalone` 门控（`next.config.ts`），且 **standalone 产物不含 `.next/static` 与 `public`**，必须手动拷。

```bash
export BUILD_TARGET=standalone
npm ci --include=dev          # 构建需要 devDependencies
npx prisma generate
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
```
> 若服务器只有 2G 内存：改为 **CI 构建**（GitHub Actions 出 tar）→ rsync 到服务器解包，服务器只跑不建。`deploy/selfhost/deploy.sh --prebuilt=<dir>` 支持这种模式。

### S3 · 运行
systemd 单元：`deploy/selfhost/lokfeel.service`；env 放 `/etc/lokfeel/env`（600，属主 `lokfeel`）。
必须显式写的四个：
```
NODE_ENV=production
AUTH_URL=https://app.lokfeel.com
NEXTAUTH_URL=https://app.lokfeel.com
NEXTAUTH_SECRET=<32B>
```

### S4 · 数据（切流量之前）
```bash
npm run qa:db:snapshot        # 先备份（本仓已有）
npx prisma migrate deploy     # 不要用 db push：对远程 Turso 不可用
```
迁移失败 ⇒ **立即中止，不切 current**（脚本里迁移在 swap 之前）。

### S5 · Cron（Netlify scheduled → systemd timer）
仓库有 9 条 cron 路由（`/api/cron/bot-tick`、`lifecycle-sweep`、`workflow-tick` …）。Netlify 的 scheduled functions 在自托管后**不存在**，必须补：
```bash
# 路由是 GET，鉴权是 Authorization: Bearer $CRON_SECRET（见 src/app/api/cron/bot-tick/route.ts:53-60）
systemctl timer 每分钟 → curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/<name>
```
> ⚠️ 用 POST 调这些路由会得到 **405**，看起来像「路由不存在」，其实是方法不对。验收脚本因此固定用 GET。
漏了这一步的症状：机器人不动、生命周期不扫、软删除不清理 —— **不会报错，只会「慢慢变安静」**，最难排查。

### S6 · CF 规则（4 条）
| 规则 | 值 | 理由 |
|---|---|---|
| Cache Rule | `/api/*` → **Bypass** | `/api/health` 自带 `max-age=60`，Cache Everything 会把健康状态缓存住 |
| Cache Rule | `/_next/static/*` → Edge TTL 1 年 | Next 文件名带 content hash，可永久缓存 |
| WAF Skip | `/api/webhooks/*`、`/api/cron/*` → Skip 全部托管规则 | 支付回调/定时任务被挑战 = 静默失效 |
| Config | **保留** Always Use HTTPS；**不要**开 Rocket Loader | Rocket Loader 会打乱 `<script>` 时序，Pusher/Firebase 初始化易炸 |

⚠️ CF 免费/Pro **回源 100s** 上限。同步返回的 AI 报告若 >100s 会 524；流式（SSE）只要首字节早于 100s 就没事。仓库里长任务若存在，迁移前先用 `npm run check:slo` 量一遍。

### S7 · 验收与回滚
```bash
node scripts/qa/selfhost-gate.mjs --origin-ip=<服务器公网IP> --expect-origin-closed
```
全绿后观察 48h，再决定是否停 Netlify。回滚 = 把 CNAME 改回 `lokfeel.netlify.app`（TTL 提前降到 60s，**48h 内 Netlify 项目不要删**）。

## 四、七个必踩的坑（都指向本仓具体位置）

| # | 坑 | 症状 | 处理 |
|---|---|---|---|
| 1 | `AUTH_URL` 未设 | `src/lib/auth/config.ts:32` 回落 `http://localhost:3000` ⇒ OAuth 回调 400 / 登录后跳 localhost | systemd 里显式设 |
| 2 | standalone 缺静态资源 | 页面无样式、图片 404 | 构建后手拷 `.next/static` + `public`（脚本已做） |
| 3 | `NEXT_PUBLIC_*` 内联 | 改了 env 但前端还是旧值 | 18 个键必须在构建机存在，改完重建 |
| 4 | 构建 OOM | `next build` 被杀 / exit 137 | 4G swap 或 CI 构建 |
| 5 | `.next/cache` 不可写 | ISR 页每次请求都重建，CPU 打满 | `shared/.next-cache` 软链进 release，属主 `lokfeel` |
| 6 | CF 100s 回源 | 长 AI 请求 524 | 改异步 job 或流式；不要指望调大（Enterprise 才 600s） |
| 7 | `db push` 对 Turso | 远程库不可用 | 只用 `prisma migrate deploy`，且先 snapshot |

## 五、环境变量：78 个，分三类

| 类别 | 数量 | 说明 |
|---|---|---|
| **构建期必需**（`NEXT_PUBLIC_*`） | **18** | APP_URL / APP_NAME / FIREBASE×6 / PUSHER×4 / TURN×4 / GTM_ID / SENTRY_DSN |
| **运行期密钥** | ~35 | DATABASE_URL、AUTH_SECRET、AUTH_URL、NEXTAUTH_URL、CREEM×5、STRIPE×5、SMTP×5、RESEND、FIREBASE 服务端×3、PUSHER_SECRET、TURN 服务端×4、UPLOADTHING×2、CRON_SECRET |
| **可缺省** | 其余 | BOT_*、GEO_*、CORS_*、SENTRY、GTM —— 缺省即关闭对应能力 |

对齐方法：导出 Netlify 的 env 键名（只导键名，不导值），与 `.env.example` 做 diff；再跑 `npm run check:launch`。

## 六、验收门禁（11 条）

`scripts/qa/selfhost-gate.mjs`，设计原则与 `paypal_gate` 一致：**缺前置就 BLOCKED，不写 PASS**。

| 断言 | 判据 |
|---|---|
| S1 边缘在位 | `cf-ray` + `server: cloudflare` |
| S2 DNS 不指向源站 | A/CNAME 里没有 `--origin-ip` |
| S3 源站 3000 不可直连 | TCP 连 `origin:3000` 失败 |
| S4 源站 80/443 不可直连 | TCP 失败（Tunnel 模式应成立） |
| S5 未登录访问 `/dashboard` | 307 且 `location` 含 `/login` |
| S6 `/api/health` | 200 且 `status=healthy` 且 `dbLatency` 为数字 |
| S7 `/api/*` 不被边缘缓存 | `cf-cache-status ≠ HIT` |
| S8 `/_next/static/*` 可缓存 | 有 `max-age` 或 `cf-cache-status: HIT` |
| S9 webhook 不被挑战 | 无 `cf-mitigated`，非 challenge HTML |
| S10 Auth cookie 安全前缀 | `/api/auth/csrf` 的 `set-cookie` 含 `__Host-` 或 `__Secure-`（反证 `AUTH_URL` 是 https） |
| S11 cron 需鉴权 | GET `/api/cron/bot-tick` 无 `Authorization: Bearer` → **401** |

## 七、待输入（只剩一件）

| # | 需要 | 状态 |
|---|---|---|
| **仓库** | `github.com/aoshuang99-netizen/lokfeel.com.git` · `main` | ✅ 已知（本地 `nexus-app` 已同步 @ `351c9bb`） |
| **CF** | Zone 已在你名下（NS 已指向 CF） | ✅ 已知 |
| **服务器** | **SSH（IP/端口/用户/密钥）+ 香港还是大陆** | ❌ 缺这一项 |

给到 SSH，我按 S0→S7 一次跑完；在此之前，`deploy/selfhost/` 的脚本只能做到「本地夹具自证」，不会冒充线上通过。

## 八、当前基线（2026-10-19 22:06，Netlify 回源）

```bash
node scripts/qa/selfhost-gate.mjs
# ASSERTIONS=11 → 8 PASS / 0 FAIL / 3 BLOCKED · exit 2
```

| 结果 | 断言 |
|---|---|
| ✅ PASS | S1 边缘在位 · S5 未登录 307 · S6 health healthy（dbLatency 286ms）· S7 API 不缓存 · S8 `_next/static` max-age=31536000 · S9 webhook 503 业务拒绝 · S10 cookie 有 `__Host-` 前缀 · S11 cron 401 |
| ⛔ BLOCKED | S2/S3/S4 —— 需要 `--origin-ip`，只在自托管后才有意义 |

**这是「迁移前基线」，不是「自托管通过」。** 切到自有服务器后，S2/S3/S4 必须由 BLOCKED 变 PASS（DNS 不含源站、3000/80/443 从公网不可达），这才是 S7 验收的判据。

`deploy/selfhost/test-deploy.sh`（本地夹具）：**11 PASS / 0 FAIL · exit 0**，覆盖静态资源手拷、ISR 缓存软链、健康检查失败自动回滚。
