# LokFeel 自托管：Cloudflare Tunnel + Git 部署

> 2026-10-20 13:30 · 依据：本轮实测 `app.lokfeel.com` / `lokfeel.com` 响应头与 DNS + 仓库现状（`nexus-app/`）
>
> **已定决策（D3）**：源站放**香港**，不等 ICP 备案；回源改用 **Cloudflare Tunnel**（出站长连，源站零入站端口）；
> 代码目录走 **Git**（`aoshuang99-netizen/lokfeel.com@main`）。

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

### S0 · 服务器（已定：香港）
- 规格：**2C4G + 4G swap**（构建对内存敏感，2G 会 OOM）、40G SSD、Ubuntu 24.04、Node 22 LTS。
- 位置：**香港**。免 ICP（大陆节点要备案 1–3 周，且 CF 不豁免备案）。
  香港到大陆/东南亚都在 ~30–60ms 量级，比「CF 边缘在香港、回源跨境到上海」更顺。
- 初始化一条命令（幂等，`--dry-run` 可先看计划）：
  ```bash
  sudo bash deploy/selfhost/bootstrap.sh
  ```
  它会做：基础包 → 补 4G swap（<4G 内存时）→ Node 22（NodeSource）→ cloudflared（CF apt 源）
  → `lokfeel` 系统用户与 `/srv/lokfeel/{releases,shared}` → `/etc/lokfeel/env` 模板（640 root:lokfeel）
  → **ufw 默认拒绝入站、只放 SSH**（绝不开放 80/443）→ sysctl/logrotate。
  ⚠️ 如果这台机器上还有别的服务在监听，脚本会**中止并列出端口**（`--allow-other-ports` 才继续）——
  防的是「一键加固把别人的站打死」。
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
仓库有 10 条 cron 路由。Netlify 侧是**一个**小时级函数 `netlify/functions/cron-runner.ts` 打全部端点。

🔴 **本轮查出的线上缺陷（已取证 + 已修）**：该 runner 原先对**所有**端点统一用 `POST`，
而 `bot-tick` / `bot-online` / `bot-chat` / `bot-match` / `status` 只导出 **GET**
⇒ Next 返回 **405**。也就是说**仓库内唯一的调度链路**对它们全部失效；
若没有另外配 cron-job.org（`scheduler.yml` 默认没开 schedule），这 5 个 cron 就没跑过。
实测（2026-10-20，`app.lokfeel.com`，不带凭据时应为 401）：

| 端点 | GET | POST |
|---|---|---|
| bot-tick | 401 | **405** |
| bot-online | 401 | **405** |
| bot-chat | 401 | **405** |
| bot-match | 401 | **405** |
| status | 401 | **405** |
| bot-learning / workflow-tick | 401 | 401 |
| migrate-avatars | **405** | 401 |

症状不是报错，而是「机器人不动、匹配不推进」——最容易被当成产品问题去查。
修复：`cron-runner.ts` 改为**逐端点声明方法**；新增源码门禁
`scripts/ci/verify-cron-methods.mjs`（比对 route 导出方法 vs 调度器调用方法，含 6 条自证）。

自托管后用 systemd timer，按**各端点设计频率**跑（不再被压到小时级）：
```bash
sudo bash deploy/selfhost/cron/install-cron.sh
# 验收：systemctl list-timers 'lokfeel-cron-*' --no-pager
# 手工：sudo systemctl start lokfeel-cron-bot-tick.service && journalctl -u lokfeel-cron-bot-tick -n 20
```

| job | 频率 | 方法 | 默认 |
|---|---|---|---|
| bot-tick | 每分钟 | GET | 启用 |
| workflow-tick | 每 2 分钟 | GET | 启用 |
| bot-chat | 每 5 分钟 | GET | 启用 |
| bot-online | 每 15 分钟 | GET | 启用 |
| bot-match | 每小时 :07 | GET | 启用 |
| bot-learning | 每小时 :17 | GET | 启用 |
| status | 每小时 :27 | GET | 启用 |
| cleanup-soft-delete | 每天 02:00 **UTC** | GET | 启用 |
| migrate-avatars | 每天 03:30 UTC | **POST** | 停用（手工） |
| lifecycle-sweep | 每天 04:10 UTC | GET | **停用**（删除不可逆，需显式开启） |

> 时间语义：分钟/小时级与时区无关；「每天几点」一律写 `UTC` 后缀，跨时区搬家不漂。
> 应用进程仍设 `TZ=Asia/Shanghai`（香港同为 UTC+8），避免改 SSR 的日期渲染。
> 漏装 timer 的症状：**不报错，只是慢慢变安静**。

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
| **位置** | **香港**（已定，免 ICP） | ✅ 2026-10-20 |
| **服务器** | **SSH（IP/端口/用户/密钥或密钥文件路径）** | ❌ 只差这一项 |

给到 SSH，我按 S0→S7 一次跑完；在此之前，`deploy/selfhost/` 的脚本只能做到「本地夹具自证」，不会冒充线上通过。
服务器还没开也可以先做：`bootstrap.sh --dry-run` 的输出就是开机器时要选的规格与服务清单。

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

## 九、香港迁移日 Runbook（T-1 → T+48h）

时间以「切 DNS」为 T0。**Netlify 全程保留**，回滚只需改回一条 CNAME。

| 时点 | 动作 | 判据 / 回滚 |
|---|---|---|
| **T-1d** | 开香港 CVM（2C4G/40G/Ubuntu 24.04）；跑 `bootstrap.sh`；把 `/etc/lokfeel/env` 从 Netlify 导全 | `bootstrap.sh --check` 无 "(缺)" |
| **T-1d** | `cloudflared tunnel create lokfeel`；写 `/etc/cloudflared/config.yml`；`ingress validate` | 校验通过；凭据 600 |
| **T-1d** | 先**不切 DNS**，用 `cloudflared access` 或临时 hosts 验证源站直连 3000 | 本机 `curl 127.0.0.1:3000/api/health` = healthy |
| **T-6h** | `deploy.sh --migrate` 落第一版；`install-cron.sh`；CNAME TTL 降到 **60s** | `list-timers` 有 8 个；REVISION 与 git sha 一致 |
| **T0** | 只改一条 CNAME：`app.lokfeel.com` → `<UUID>.cfargotunnel.com`（橙云） | `curl -I https://app.lokfeel.com` 出现 `x-nf-request-id` **消失** |
| **T0+5m** | `selfhost-gate.mjs --origin-ip=<IP> --expect-origin-closed` | S2/S3/S4 必须由 BLOCKED 变 **PASS** |
| **T0+15m** | 真账号登录 / 建任务 / 收一条站内信；`/api/cron/bot-tick` 手工跑一次 | 401→200；`journalctl` 有 `[cron:bot-tick] GET 200` |
| **T0+1h** | 看 CF 分析：5xx 比例、524、缓存命中；看 `journalctl -u lokfeel -p err` | 5xx < 1%；无 524 |
| **T+24h** | 复跑全部门禁（见 §十） | 全绿 |
| **T+48h** | 才考虑停 Netlify 项目（**先别删**，只停自动发布） | 保留 7 天再删 |

**三条一票否决**（出现即回滚）：
1. `S2/S3/S4` 任一仍 BLOCKED 或 FAIL ⇒ 源站还暴露着，套 CF 是错觉；
2. 登录态异常（307 循环 / cookie 无 `__Host-`）⇒ `AUTH_URL` 没生效；
3. `/api/webhooks/*` 返回 403/挑战页 ⇒ 支付回调被 WAF 拦，这比停机更糟（钱收了权益不到账）。

## 十、合规与数据（香港节点特有）

| 项 | 结论 | 动作 |
|---|---|---|
| ICP 备案 | **不需要**（香港不属大陆备案辖区） | 无需等待，这是选香港的唯一硬收益 |
| 大陆用户可访问性 | 不保证稳定（跨境链路受运营商与时段影响） | 上线后用真实大陆网络抽测；必要时上「香港 + 新加坡」双源 |
| 个人资料 | 香港《个人资料（私隐）条例》(PDPO) 适用于在港业务 | 隐私政策需写明存储地（香港）与跨境处理（Turso/Upstash 区域） |
| 数据驻留 | libSQL(Turso) / Upstash 的实际区域可能在欧美 | 在隐私政策里如实披露；如客户要求本地化，再迁 |
| 内容合规 | 交友类内容在港合法，但**年龄门与举报通道**是平台责任 | 现有 `/community-guidelines`、`/safety-tips` 保留并在注册页可达 |

> 这一节是工程提示，不是法律意见；正式上线前建议做一次本地律师复核（费用远低于下架）。

## 十一、门禁总表（本轮新增 3 个）

| 门禁 | 命令 | 当前结果 | 覆盖什么 |
|---|---|---|---|
| 回源/边缘 11 条 | `node scripts/qa/selfhost-gate.mjs` | **8 PASS / 0 FAIL / 3 BLOCKED · exit 2** | 迁移前基线；S2–S4 待源站 |
| 部署脚本 | `bash deploy/selfhost/test-deploy.sh` | **11 PASS / 0 FAIL · exit 0** | 静态资源手拷、ISR 缓存软链、健康检查失败自动回滚 |
| **cron 方法一致** | `node scripts/ci/verify-cron-methods.mjs` | **9 job / 0 bad · exit 0**（另有 6 条自证） | 防「POST 打 GET 端点」的 405 类静默失效 |
| **systemd cron 生成** | `bash deploy/selfhost/cron/test-cron.sh` | **17 PASS / 0 FAIL · exit 0** | 频率、方法、UTC 语义、幂等、执行器退出码（78/75/76/69） |
| **bootstrap 只读自证** | `bash deploy/selfhost/test-bootstrap.sh` | **8 PASS / 0 FAIL · exit 0** | 绝不开 80/443、只放 SSH、不把密钥写进命令行 |

迁移后 T13 的判定口径：**上表全部 exit 0，且 selfhost-gate 的 3 个 BLOCKED 全部转 PASS**。
有一条不满足就不是「条件通过」，是「没通过」。
