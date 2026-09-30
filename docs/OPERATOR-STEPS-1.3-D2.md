# 剩余人工步骤（1.3 + D2 收尾）

> 代码侧已清零。本轮又修掉脚本 3 处真实缺陷（含"冒烟永远判失败"的那个），
> 所以你的控制台操作现在**真的能跑通**了。剩余动作只有控制台点击。

## 关键信息

| 项 | 值 |
|---|---|
| GCP 项目号 | `185541962106` |
| 目标 key | `AIzaSyBq2gPa…`（39 位，由线上 `/api/config/firebase` 公开下发） |
| 自动化 | `scripts/firebase-restrict-key.mjs` + `.github/workflows/firebase-key-restrict.yml` |
| 触发方式 | 每日 03:00 UTC（北京 11:00）自动重试；也可 Actions 页手动 Run workflow |

---

## 一、1.3 Firebase Web key 加双限制

### 路线 ①（推荐先做）：启用 API Keys API，之后全自动

1. 打开
   `https://console.developers.google.com/apis/api/apikeys.googleapis.com/overview?project=185541962106`
2. 若页面顶部有蓝色 **ENABLE / 启用** 按钮 → **点它**
3. 等页面变成 "API Keys API" 的管理视图 = 已启用
4. **等约 2 分钟**（Google 侧传播），然后什么都不用做：
   每日任务会自动完成「应用双限制 → 轮询生效 → 冒烟验证」
   - 想立刻跑：GitHub 仓库 → **Actions** → **Firebase key restrict (1.3)** → **Run workflow**

### 路线 ②（兜底，且不依赖任何 API 权限）：直接改 key 限制

> 若路线 ① 执行后仍卡住，或 Credentials 页本身打不开，走这条。

1. 打开 `https://console.cloud.google.com/apis/credentials?project=185541962106`
2. 在 **API Keys** 列表里点那个 Web key（`AIzaSyBq2gPa…`）
3. **Application restrictions** → 选 **Websites** → 点 **ADD**，逐条加入这 5 条：

   ```
   https://app.lokfeel.com/*
   https://lokfeel.netlify.app/*
   https://*.lokfeel.netlify.app/*
   http://localhost:3000/*
   http://127.0.0.1:3000/*
   ```

4. **API restrictions** → 选 **Restrict key** → 勾选这 3 个：

   ```
   Identity Toolkit API            (identitytoolkit.googleapis.com)
   Token Service API               (securetoken.googleapis.com)
   Firebase Installations API      (firebaseinstallations.googleapis.com)
   ```

   > 客户端只用 `firebase/auth`，不涉及 Firestore —— 只勾这 3 个是"最小可用集"。

5. **SAVE**（保存后 1~5 分钟生效）

> ⚠️ 若该页面提示 "API Keys API is not enabled"，说明必须回到路线 ① 先启用。

---

## 二、验证（自动，不用你管）

两条路线做完任何一个，每日任务的幂等校验都会给出结论：

- ✅ 打印 **「限制已就绪（幂等跳过）」** = 完成
- ⏳ 仍打印 **「前置未满足」** = 还没生效或没做，次日再试

判据不是"看 HTTP 码"，而是读 Google 返回正文里的 referer-blocked 语义，
并同时验证 **app 域放行 + 恶意域被拒** 两个方向。

---

## 三、D2 收尾：吊销只读 PAT

1. 打开 `https://github.com/settings/tokens?type=beta`（Fine-grained tokens）
2. 找到前缀为 **`github_pat_11B7FHZ…`** 的那个 token
3. 点 **Delete** → 确认

> 若列表里已经没有它，说明此前已吊销，跳过即可。

---

## 四、剩余由我完成

- 限制验证通过后，把 GitHub **secret scanning 告警 #1**（Google API Key，2026-05-09）
  标记为 `wont_fix` —— 该 key 本身就是公开设计（前端必须持有），
  风险由本次的 referrer + API 双限制消解，轮换反而会打断线上。
