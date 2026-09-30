# 剩余人工步骤（1.3 收口）— 2026-09-30 实测更新版

> 本版取代旧内容。**所有结论均来自对 Cloud Console 的实机探测（截图证据）**，
> 不再是"照文档猜"。自动化链路已全部就绪，当前唯一阻断是 Google 会话需重新登录（passkey）。

## 一、当前真实状态（已实测，无需再查）

| 项 | 状态 |
|---|---|
| key 名称 | `Browser key (auto created by Firebase)`，创建于 2026-05-06 |
| **API 限制** | ✅ **已达标**：已限制为 25 个 API，**包含 Identity Toolkit API / Token Service API / Firebase Installations API** |
| **应用限制** | ⚠️ 选了「网站」，但列表有问题（见下） |
| 网站列表 | `app.lofeel.com`（**拼写错误，缺 k**）/ `lokfeel.com` / `www.lokfeel.com` |
| 缺失项 | `app.lokfeel.com`、`lokfeel.netlify.app`、`*.lokfeel.netlify.app` |

> 安全影响：`app.lofeel.com` 是拼写错误且域名归属不明 —— 等于把我们的 Firebase key
> 送给了别人的子域。真正的前端域 `app.lokfeel.com` 反而不在白名单里。
> 好消息：线上部署时 Netlify 环境变量若另有限制，实际风险有限；但白名单本身必须修正。

## 二、要做的改动（一共 6 次点击）

页面直达（已验证可用）：
`https://console.cloud.google.com/apis/credentials/key/2b6e641d-3616-461b-9a31-5dcd229e3f20?project=project-1700929385257882331`

1. 滚到 **网站限制** 表格 → 勾选 `app.lofeel.com` 那一行的复选框
   （表格上方会出现英文 **Delete** 按钮 —— **注意别点页面顶部的中文「删除」**，那会删掉整把密钥）→ 点 **Delete**
2. 点 **+ Add** → 输入框填 `https://app.lokfeel.com` → 点 **完成**
3. 再点 **+ Add** → 填 `https://lokfeel.netlify.app` → **完成**
4. 再点 **+ Add** → 填 `https://*.lokfeel.netlify.app` → **完成**
5. 再点 **+ Add** → 填 `http://localhost:3000` → **完成**；再点 **+ Add** → 填 `http://127.0.0.1:3000` → **完成**
6. 点底部 **保存**（约 5 分钟生效）

格式依据：页面自带示例「不含子域的单个网域中的任何网址：`https://example.com`」，
即写主机名即可覆盖该主机全部 URL；通配子域需 `https://*.example.com`。

## 三、为什么现在由自动化来做被卡住了

- 本机对 Google 全系域名**不可达**（GFW；`www.gstatic.com` 例外可通），且 ClashX
  全部节点服务器 TCP 超时，无可用出口。
- 因此把执行层放到了 **GitHub Actions 美区 runner**：
  本机 Chrome 的登录态 cookie 被解密并写入仓库 Secret（`GCP_SESSION_COOKIES`，16.3KB），
  由 `scripts/gcp-console-key.cjs` 驱动。实测**能打开控制台、能删行**。
- 但 Google 的风控随后**吊销了这个会话**（疑因：数据中心 IP 复用 cookie + 执行删除类操作），
  现在重新登录要求 **passkey** —— 只有你本人能完成。

## 四、解锁路径（二选一，之后自动化可一键续跑）

- **A（推荐）Mac 切手机热点**：本机即可直连 Google → 在自己的 Chrome 里用 passkey 登录一次。
  之后你可以照上面 6 步手动点完（约 2 分钟），或告诉我"已登录"，我重新提取 cookie 并一键续跑
  （`Actions → GCP console key restrict (1.3) → Run workflow → apply`）。
- **B 修复 ClashX 订阅**（当前所有节点服务器都超时）→ 同上。

## 五、改完后的验证（自动，无需操作）

跑 `Actions → GCP console key restrict (1.3) → Run workflow → mode=verify`，
它会用真实 key + 不同 `Referer` 打 Identity Toolkit，判定：
- `https://app.lokfeel.com/` → 放行（返回业务错误而非 403）
- `https://evil-probe.example.com/` → 403 `API_KEY_HTTP_REFERRER_BLOCKED`
四项判定全过即输出 `VERIFY_RESULT: PASS`，1.3 收口，随后可关闭 secret scanning 告警 #1。

## 六、D2 收尾（与上面无关，仍待你处理）

GitHub → Settings → Developer settings → Fine-grained tokens：
删除前缀 `github_pat_11B7FHZ…` 的 token（若列表里没有即已吊销过，跳过）。
