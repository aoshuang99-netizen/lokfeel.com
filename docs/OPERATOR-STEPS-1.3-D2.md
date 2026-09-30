# 1.3 / D2 收口清单（2026-09-30 晚 · 实测更新版）

> **结论先行：1.3 已完成**（全自动化落地，无需你再点任何东西）。
> 下面只剩 **1 件必须你本人做**（D2 吊销 PAT）与 **2 件可选**（两把遗留 key、Redis）。

---

## 一、1.3 已完成：Firebase Web key 双限制

### 过程中的关键更正（避免后人重走弯路）

**项目里有 3 把 Browser key，"应用在用的"与"我们一直在改的"不是同一把：**

| 密钥 ID | 创建日期 | 状态 |
|---|---|---|
| `fec2e2a4…` | 2026-05-08 | ✅ **生产真正在用的这把** —— 本轮已配置完成 |
| `2b6e641d…` | 2026-05-06 | ⚠️ 旧 key，名单里才有 `app.lofeel.com`（缺 k）。**此前多轮都在改它，改错了对象** |
| `2c5fe33d…` | 2026-09-04 | ⚠️ **没有任何应用限制**（详见第三节） |

判定方法（可复现）：用线上 `/api/config/firebase` 下发的 `apiKey` 做 Referer 冒烟，
逐把 key 的「应用限制」列表与冒烟结果对照 —— 只有 `fec2e2a4` 的列表与冒烟完全吻合。

### 最终生效的配置（`fec2e2a4`）

**Application restrictions（HTTP 引荐来源，7 条）**

```
https://app.lokfeel.com/*
https://lokfeel.com/*
https://www.lokfeel.com/*
https://lokfeel.netlify.app/*
https://*.lokfeel.netlify.app/*
http://localhost:3000/*
http://127.0.0.1:3000/*
```

**API restrictions**：保持线上原有 25 个 API（含 identitytoolkit / securetoken /
firebaseinstallations）。**刻意不缩减** —— 见第二节。

### 独立验证（2026-09-30 实测，可随时重跑）

用公开的 Auth 端点带不同 Referer 直接打 Google，10 个探针全部符合预期：

| Referer | 结果 | 期望 |
|---|---|---|
| `app.lokfeel.com` | 200 放行 | ✅ |
| `lokfeel.com` / `www.lokfeel.com` | 200 放行 | ✅ |
| `lokfeel.netlify.app` / `demo.lokfeel.netlify.app` | 200 放行 | ✅ |
| `localhost:3000` / `127.0.0.1:3000` | 200 放行 | ✅ |
| `app.lofeel.com`（第三方错拼抢注域） | 403 被拦 | ✅ |
| `evil.example.com` | 403 被拦 | ✅ |
| 无 Referer | 403 被拦 | ✅ |

> 顺带更正一个曾经的误判：`app.lofeel.com` **从未真正生效过**（一直 403）。
> 它只出现在旧 key `2b6e641d` 的名单里，扫描到它并不等于线上有安全洞。

### 已知限制（Google 侧，无解）

通配符标签有**长度上限**：`ab-cd--ef`（9 字符）✅、`branch--lokfeel`（15 字符）❌。
Netlify 的 PR 预览域形如 `deploy-preview-7--lokfeel`（25 字符），**无法用通配符放行**。
→ 预览环境要验登录，请用 `localhost:3000`（已放行）替代。

---

## 二、本轮新增：脚本的"只增不减"修复（重要，防静默回退）

`scripts/firebase-restrict-key.mjs` 每日 03:00 UTC 自动跑（幂等）。原实现用**精确相等**
做达标判据，存在两颗会静默破坏线上配置的地雷：

| 地雷 | 后果 |
|---|---|
| `ALLOWED_REFERRERS` 只有 5 条，缺 `lokfeel.com` / `www.lokfeel.com` | 一旦前置满足，PATCH 会把这两个营销域**删掉** |
| `API_TARGETS` 只写 3 个服务，而线上 key 有 **25 个** API | PATCH 会把 25 个**削成 3 个**，直接打断线上 |

**修复为"只增不减"语义**：达标 = 必需项全部在 + 没有禁用项；写回时取**并集**
（保留线上已有条目，只补必需项，只删明确禁用的 `lofeel` 系列）。

**回归夹具**：`backups/check-restrict-logic.mjs`（20 项断言，逐字抽取脚本第 4/5 节源码求值）。
覆盖 8 个场景：线上现状不写回、缺营销域补齐、lofeel 被剔除、API 轴被削后补回、
无限制时写入 7+3、书写风格不一致仍判达标、未知合法域被保留。**当前全绿。**

> 现状说明：API Keys API 未启用（实测 `apikeys.keys.list` 报 PERMISSION_DENIED），
> 所以目前每日任务**不会**执行写入 —— 地雷处于休眠状态。修复后即使将来启用也不会踩。

---

## 三、D2 收尾（**唯一需要你本人操作**，约 20 秒）

1. 打开 https://github.com/settings/tokens?type=beta
2. 找到前缀 `github_pat_11B7FHZ…` 的 token → **Delete**
3. 列表里没有它 = 已吊销/已过期，跳过即可

> 为什么必须你来：GitHub 不允许 PAT 通过 API 自我吊销（已确认无此端点），
> 且该 token 全值不在仓库、不在本地磁盘、不在 git 历史中，脚本无从代劳。
> 其余泄漏凭证（Vercel OIDC 令牌、`.env.test` 夹具）已取证收口，无需任何操作。

---

## 四、可选：两把遗留 key 的处置（**动手前需你确认**）

这两把 key 都可能被**未知消费方**使用，删除/收紧前请先确认没有在用的地方：

| 密钥 | 建议 | 风险 |
|---|---|---|
| `2c5fe33d…`（2026-09-04，**无任何网站限制**） | 收紧到与 `fec2e2a4` 相同的 7 条；若确认无人用则删除 | 无限制的公开 key 可被任意站点调用，消耗你的配额 |
| `2b6e641d…`（2026-05-06，名单含 `app.lofeel.com`） | 确认无消费方后**删除** | 它把公开 key 授权给了第三方抢注域 |

确认后可以用已打通的自动化直接执行（无需你到控制台点）。
输入 "处理遗留 key：收紧 2c5fe33d / 删除 2b6e641d" 即可。

---

## 五、可选：另外两项已知项

- **D1 · Netlify 额度兜底**：`auto_topup_enabled=false`，额度耗尽会整站 503。
  **控制台 UI 才能开**（API 已穷尽排除，见加固文档）。路径：Team dashboard →
  Usage & billing → Credit balance → **Configure auto recharge** → Enabled。
  已有自建看门狗每日巡检（`netlify-credit-watch.yml`，异常开 Issue）。
- **D5 · 生产 Redis 未配置**：`/api/health` 显示 `redis.backend=memory`。
  多实例下速率限制与缓存不共享，目前是内存降级。需要 Upstash 凭证。

---

## 六、本轮自动化产物（可复用）

| 文件 | 作用 |
|---|---|
| `scripts/firebase-restrict-key.mjs` | 1.3 幂等应用 + **Referer 冒烟哨兵**（不依赖任何 Google API 权限） |
| `.github/workflows/firebase-key-restrict.yml` | 每日 03:00 UTC 运行；异常开 Issue、恢复自动关 |
| `backups/check-restrict-logic.mjs` | 幂等语义回归夹具（20 项断言，本地跑，不入仓库） |
| `backups/check-smoke-matrix.mjs` | 冒烟哨兵自测（用真实 key 打线上，本地跑，不入仓库） |

> `backups/` 已被 `.gitignore` 忽略（生产数据备份目录），夹具放这里不会进仓库。
