# 13 · 前端部署地址与页面清单（V20.5 GA · 实测）

> 采集时间：2026-11-10 15:2x（GMT+8）
> 方法：对生产站逐路由发 `curl -o /dev/null -w '%{http_code}'`，**未登录**状态下测。
> 原始输出：`evidence/dodo/route-status-2026-11-10.txt`（72 行，逐条 URL）
> 生产 SHA：`605316e`（tag `v20.5.0-ga` → `0aa24f3`）

---

## 1. 地址

| 项 | 值 | 判据 |
|---|---|---|
| 生产入口 | **https://app.lokfeel.com** | `/` → 200 |
| 边缘/CDN | Cloudflare Proxy → Netlify 源 | 见 `07_MONITORING_GOVERNANCE.md` |
| Netlify site | `c46478e9-7ac8-4bcf-9052-7638b04fef83` | 部署记录 |
| 仓库 | `github.com/aoshuang99-netizen/lokfeel.com` | `git ls-remote` = `605316e…` |
| 健康检查 | `/api/health` | 含 `payments.channels`（只回变量名） |

> ⚠️ **不要**把 `<deploy-id>--lokfeel.netlify.app` 当作对外地址。发布窗口期内
> `request.url` 会解析到它，这也是所有对外跳转必须走 `public-origin.ts` 的原因。

---

## 2. 页面清单（未登录实测状态码）

### 2.1 公开页（26 个，全部 200）

| 路径 | 用途 |
|---|---|
| `/` | 首页 |
| `/pricing` | **定价 + 订阅收银台入口**（V20.6 起为真实可购买页） |
| `/about` `/careers` `/press` `/contact` `/support` `/faq` | 公司与支持 |
| `/terms` `/privacy` `/cookies` `/refunds` `/cancellations-policy` | 法律与退款 |
| `/community-guidelines` `/safety-tips` `/content-removal-appeals-policy` `/dmca` `/18-usc-2257` `/fan-creator-agreement` | 合规与内容治理 |
| `/hlua` | 另一条产品线（Hlua Pass）说明 |
| `/login` `/register` `/forgot-password` `/verify-request` `/admin-login` `/auto-login` | 认证 |
| `/blocked` `/invitations/accept` | 状态页与邀请接受 |

### 2.2 需登录页（46 个，未登录 307 → `/login?callbackUrl=…`）

**Living Workspace（主线）**

| 路径 | 用途 |
|---|---|
| `/workspace` | 六屏工作区入口（Now / Studio / Field / Consent / Outcomes / Agents） |

**Console（组织态，7 屏）**

| 路径 | 用途 |
|---|---|
| `/console` | 概览 |
| `/console/missions` | 任务（含 `/console/missions/[missionId]`） |
| `/console/connections` | 连接与提案 |
| `/console/outcomes` | 成果与核验 |
| `/console/agents` | Agent 名册与额度 |
| `/console/members` | 成员与邀请 |
| `/console/settings` | 设置（含计费入口） |

**B2C 旧线（legacy，非主线）** `/dashboard` 及其 9 个子页
（`chats` `connections` `explore` `notifications` `onboarding` `profile` `settings` `subscription` `subscription/cancel` `subscription/success`）

**Admin** `/admin` 及其 22 个子页（`users` `matches` `subscriptions` `rbac` `audit` `analytics/*` `settings/*` 等）

**其它** `/debug/google-oauth`（受保护诊断页）

### 2.3 动态路由（未纳入本次静态核验）

`/m/[token]`、`/m/[token]/intent`、`/m/[token]/matches`、`/m/[token]/proposals`、
`/console/missions/[missionId]`、`/dashboard/chats/[roomId]`、`/dashboard/matches/[id]`、
`/dashboard/profile/[id]`、`/dashboard/users/[userId]`、`/admin/users/[id]`

原因：需要真实 token / id。**未验证 = 不声称可用。**

### 2.4 本次新增（尚未部署，线上当前 404）

| 路径 | 说明 | 现场状态 |
|---|---|---|
| `/checkout/success` | 支付回跳确认页 | **404（未发布）** |
| `/api/payments/dodo/plans` | 套餐目录（公开只读） | 未发布 |
| `/api/payments/dodo/checkout` | 创建结账会话（需登录 + `billing.manage`） | 未发布 |
| `/api/payments/dodo/subscription` | 当前组织订阅状态 | 未发布 |
| `/api/webhooks/dodo` | 网关事件入口（验签） | 未发布 |

---

## 3. 可复现命令

```bash
# 单页
curl -s -o /dev/null -w '%{http_code}\n' https://app.lokfeel.com/pricing

# 全量（与证据文件同法）
cd nexus-app
find src/app -name page.tsx \
  | sed 's|src/app||; s|/page.tsx||' \
  | sed -E 's|/\([^)]+\)||g' | sed 's|^$|/|' \
  | grep -v '\[' | sort -u \
  | while read -r p; do
      echo "$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "https://app.lokfeel.com$p") $p"
    done
```

**判据**：公开页 200 / 受保护页 307 且 `Location` 指向同域 `/login`。
出现 5xx 或跳到 `*.netlify.app` 即为**失败**（后者会丢 cookie，用户表现为"登录后又变未登录"）。
