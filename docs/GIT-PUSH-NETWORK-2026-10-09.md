# 推送通道与代理排查（2026-10-09 实测定位）

> **一句话**：本机代理**一直是好的**（`v2rayN` → `127.0.0.1:10808`，境外出口）。`git push` 失败的真凶是
> **WorkBuddy 沙箱给 shell 注入了显式 `HTTP_PROXY=127.0.0.1:<随机端口>`**，git 继承后写操作被拒。
> 一句话修复：**`git -c http.proxy=http://127.0.0.1:10808 push`**
> （`-c` 的优先级**高于**环境变量，所以不必先清变量，也是最稳的一条）；
> "清掉那些变量"只作为**兜底**。

---

## 1 · 症状长什么样

```
$ git push origin main
fatal: unable to access 'https://github.com/...': Empty reply from server

$ HTTPS_PROXY=http://127.0.0.1:7890 git push origin main
fatal: unable to access '...': Failed to connect ... CONNECT tunnel failed, response 502
```

同时：

```
$ git ls-remote origin refs/heads/main     # 只读，成功
f3467d5...  refs/heads/main
```

**「能拉不能推」** 是这个坑的指纹 —— 因为读是 GET、写是 POST（含对象上传），
沙箱的显式代理只对 GET 友好。看到这个组合，不要往"被墙/没代理"方向想。

---

## 2 · 本机实际拓扑（10-09 实测）

| 项目 | 值 |
|---|---|
| 代理客户端 | **`/Applications/v2rayN.app`**（内嵌 xray，PID 3096） |
| 监听端口 | `127.0.0.1:10808`（HTTP CONNECT ✓ / SOCKS5 ✓ 都支持） |
| 境外出口 IP | `104.36.71.219` |
| 系统代理（`scutil --proxy`） | HTTP / HTTPS / SOCKS 三项**全部**指向 `127.0.0.1:10808`，均已 enable |
| 开机自启 | **无**（`~/Library/LaunchAgents` 无相关项）→ v2rayN 是手动打开的 |
| 同时安装但未运行 | `Clash Verge.app`、`ClashX Pro.app` |
| 沙箱注入 | `HTTP_PROXY=HTTPS_PROXY=http://127.0.0.1:56834`（**每次会话端口不同**） |

> ⚠️ 注意区分两个东西：
> - **系统代理**（`scutil`）只对 macOS 网络栈 / CFNetwork 生效；
>   `curl`、`git` 这类 BSD socket 工具**不读它** —— 必须显式 `-x` / 环境变量。
> - **环境变量代理**（`HTTP_PROXY`）才是 `curl`/`git` 会读的。沙箱注入的正是这个。

---

## 3 · 根因

```
git push
   └─ git 读 http_proxy / https_proxy / all_proxy 环境变量
        └─ 命中沙箱注入的 127.0.0.1:56834（显式代理，白名单制）
             └─ 只读 GET 放行 → ls-remote 成功
                写 POST 上传被拒 → Empty reply / 502
```

对照实验（10-09 复测，含一次"清空变量"失败样本）：

| 通道 | 命令 | 只读 `ls-remote` | 真实 `push` |
|---|---|---|---|
| ① 显式走 v2rayN | `git -c http.proxy=http://127.0.0.1:10808 push` | ✅ | ✅ **稳定成功**（多轮复跑均 `exit=0`） |
| ② 清空注入变量后直连 | `env -u HTTP_PROXY … git push` | ✅ | ⚠️ **时通时断**（曾成功，也曾 `Empty reply from server`） |
| ③ 继承沙箱变量 | `git push`（裸跑） | ✅ | ❌ 稳定失败（`CONNECT tunnel failed`） |

**关键性质**：`git -c http.proxy=…` 的优先级**高于**环境变量 ——
所以通道①在"沙箱变量仍在"的情况下也能成功（B 组实测 `exit=0`），
**不需要先清变量**。这正是把①列为首选的原因。

---

## 4 · 三种可用解法（按推荐度）

### 解法 A：用仓库自带脚本（推荐）

```bash
cd nexus-app
bash scripts/push-main.sh            # 自动：先直连，失败回退 10808
bash scripts/push-main.sh my-branch  # 推指定分支
```

脚本内部就是下面两条通道的顺序尝试，任一成功即退出。

### 解法 B：手动一行（显式走 v2rayN，**首选**）

```bash
git -c http.proxy=http://127.0.0.1:10808 push origin main
```

**为什么首选它**：`-c http.proxy` 覆盖环境变量，**不必**先清沙箱注入的变量；
且 10-09 复测中它是唯一**稳定**的通道。

用 `-c` 是**一次性**生效，不写进 `~/.gitconfig`（避免以后换客户端端口时又踩坑）。
**不要**用 `git config --global http.proxy …`。

### 解法 C：兜底（清掉注入变量后直连）

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    -u http_proxy -u https_proxy -u all_proxy \
    git push origin main
```

仅当 `10808` 没在监听时用；实测**时通时断**，不要当主力。

> 若用 ClashX Pro / Clash Verge，端口分别是 **7890** / **7897**：
> `LOKFEEL_PROXY_PORT=7890 bash scripts/push-main.sh`

---

## 5 · 排查三步法（下次任何"外网不通"都先跑这个）

```bash
# 1) 系统代理指向哪、是否开着
scutil --proxy | grep -E "Enable|Port|Proxy"

# 2) 那个端口活着吗
lsof -nP -iTCP:10808 -sTCP:LISTEN

# 3) 出口能出墙吗（返回境外 IP 即为「通」）
curl -s --max-time 12 -x http://127.0.0.1:10808 https://api.ipify.org
```

三条全过 → 网络没问题，问题在**你的命令继承了错误的 proxy 环境变量**：

```bash
env | grep -i proxy        # 看到 127.0.0.1:5xxxx 的随机端口 = 沙箱注入的，清掉
```

---

## 6 · 代理客户端怎么起（当 `10808` 真的没在跑时）

本机**已装好**客户端，缺的只是"启动"这一步：

1. **打开 v2rayN**（`/Applications/v2rayN.app`）→ 菜单栏图标 → 确认「系统代理」为自动配置；
   内核起来后 `10808` 自动监听。首次需要先导入你自己的订阅/节点。
2. 或者换用 **Clash Verge**（`/Applications/Clash Verge.app`）→ 打开后开启「系统代理」，
   默认混合端口 `7897`。
3. 或者 **ClashX Pro**（`/Applications/ClashX Pro.app`），默认 `7890`。
4. 验证：重跑上面第 5 节的第 2、3 步。

> 三者**同时开容易抢系统代理**，建议只留一个在跑（当前在跑的是 v2rayN）。
> 若想让它在登录后自动启动：系统设置 → 通用 → 登录项，把 App 加进去
> （命令行 `launchctl` 方式在本机被权限挡死，走 GUI 更稳）。

---

## 7 · 需要长期注意的两点

1. **沙箱注入的端口每次会话都变**（`56834` 只是本次的值）——
   不要试图"记住那个端口然后加例外"；一律**显式 `-c http.proxy=http://127.0.0.1:10808`**，
   或（兜底）`env -u` 清干净再走。
2. **`[skip netlify]` 与网络无关**：免构建靠提交信息里的标记；
   推送成功本身**不会**消耗 Netlify 构建额度（`allowed_branches=['main']`，推分支不构建）。
3. 🔴 **发布提交的信息里绝不要出现那个跳过关键字 —— 哪怕是在解释它**。
   Netlify 原生的跳过判定扫描**整个提交信息**（含 body），所以"说明本次没带 XX"
   这种写法会**自伤**，构建被静默跳过。10-09 实测：推 `4aa4c61` 后等 9 分钟无任何新 deploy 记录。
   中招补救：补一个**信息干净的空提交**（`git commit --allow-empty`）再推，**不要**改历史。

---

## 8 · 相关文件

- `scripts/push-main.sh` —— 双通道自动推送
- `scripts/check-oauth.sh` —— OAuth 端点生产检查（也需外网，同样建议清 proxy 变量后跑）
- 记忆：`MEMORY.md` → 「部署 / 推送」节
