# V21 第二批 · 可重放验证命令与观察记录

环境：本地 `next start 127.0.0.1:3214`，`DATABASE_URL=file:./ci-e2e.db`（隔离库），随机 `AUTH_SECRET`，模型三键从 Netlify env 读入**进程环境**（不落仓库）。

```bash
# 0. 沙箱包装（Bash 工作目录每次重置）
#    所有命令一律：bash /tmp/nr.sh '<cmd>'，并带 env -u NODE_OPTIONS

# 1. 隔离库 + 生成 client（本批含 Prisma 变更，必须先跑）
env -u NODE_OPTIONS DATABASE_URL=file:./ci-e2e.db npx prisma db push --accept-data-loss   → exit 0
env -u NODE_OPTIONS npx prisma generate                                                    → exit 0

# 2. 类型 / 单测 / 构建
env -u NODE_OPTIONS npx tsc --noEmit -p tsconfig.json                                     → exit 0
env -u NODE_OPTIONS npx jest --runInBand                                                  → 159 suites / 2905 tests passed（D3 修复前）
env -u NODE_OPTIONS npx jest --runInBand --silent（提交前复核）                           → 159 suites / 2906 passed / 72s / JEST_FINAL_EXIT=0
env -u NODE_OPTIONS npx jest tests/living --runInBand                                     → 20 suites / 389 passed
env -u NODE_OPTIONS npx jest tests/connection tests/agents --runInBand                   → 33 suites / 699 passed
env -u NODE_OPTIONS npm run build                                                          → exit 0

# 3. 启动（生产构建；旧服务先停）
env -u NODE_OPTIONS AUTH_SECRET=<random> DATABASE_URL=file:./ci-e2e.db \
  NEXTAUTH_URL=http://127.0.0.1:3214 WORKBUDDY_LLM_ENDPOINT/KEY/MODEL=<from Netlify> \
  npx next start --hostname 127.0.0.1 --port 3214

# 4. 夹具（e2e-ci 与红队共用）
env -u NODE_OPTIONS DATABASE_URL=file:./ci-e2e.db node scripts/qa/seed-authed-e2e-user.mjs --db=ci-e2e.db --out=.qa-authed-e2e.local.json
env -u NODE_OPTIONS DATABASE_URL=file:./ci-e2e.db node scripts/qa/seed-chat-fixture.mjs  --db=ci-e2e.db --cleanup
env -u NODE_OPTIONS DATABASE_URL=file:./ci-e2e.db node scripts/qa/seed-chat-fixture.mjs  --db=ci-e2e.db --out=.qa-chat-e2e.local.json

# 5. 浏览器 E2E（CI 同配置，含 2 条新竞态用例）
bash /tmp/lf-e2e-run.sh                                                                    → 见下方观察记录

# 6. 真实 HTTP 取证（会调模型 / 写隔离库）
env -u NODE_OPTIONS node scripts/qa/v21-batch2-closure.mjs   --base=http://127.0.0.1:3214
env -u NODE_OPTIONS node scripts/qa/v21-batch2-redteam.mjs   --base=http://127.0.0.1:3214

# 7. 视觉 / 无障碍 / 性能
env -u NODE_OPTIONS PW_CHANNEL=chrome node scripts/qa/v21-batch2-visual.mjs --base=http://127.0.0.1:3214
env -u NODE_OPTIONS PW_CHANNEL=chrome node scripts/qa/v21-batch2-perf.mjs   --base=http://127.0.0.1:3214 --runs=3
```

## 观察记录（如实，含失败）

- **RED→GREEN 全部真实执行**：
  - 服务端线 RED `3 suites failed / 50 failed / 7 passed` → GREEN `33 suites / 699 tests`。
  - 前端纯函数线 RED `3 suites failed / 43 failed / 6 passed` → GREEN `49/49`。
  - 缺陷修复线 RED `2 suites failed / 8 failed / 6 passed` → GREEN `14/14`。
  - D3 重复核验 RED `1 failed / 19 passed` → GREEN `20/20`。
- **登录 403 坑**：`/api/auth/login` 有同源校验，脚本必须带 `Origin: <base>` 与 `Referer: <base>/login`；首次 closure 因此 2 步即失败，加头后进入 23 步。
- **真实闭环首轮**：23 步 / 负例 7/8，唯一失败「重复核验期望 409 实得 500」⇒ 定位为 `@@unique([missionId,runId])` P2002 未映射，按 TDD RED→GREEN 修复（D3）。重建服务后复验：**PASS_LOCAL，23 步 / 8/8 负例 / 0 failures**，负例码含 `409/VERIFICATION_ALREADY_RECORDED`。
- **红队首轮**：8 例中 1 FAIL（R3 幂等键跨用户串台），原始响应另存 `redteam-round1-before-fix.json`；修复后复验 `7 PASS / 0 FAIL / 1 PARTIAL`（C4 审批链含 INTRO_DRAFT `NO_TARGET` 子项 BLOCKED）。
- **e2e 首轮全量**：123 passed / **2 failed**，失败全在新写的 `workspace-now-race.spec.ts`。定位过程（不假绿）：
  1. `intent-result` 内有两个 h2 ⇒ strict mode 违规，改 `h2.first()`；
  2. `page.route('**/api/v1/agents/runs')` 把页面加载的 **GET** 同路径请求也拦了，污染计数 ⇒ 两个用例都加 `method!=='POST' → route.continue()`；
  3. 重复点击确实发了 2 个请求 ⇒ **真实产品缺陷**，在 `runIntent` 加「同一目标已有在途请求则忽略」的 `inFlightSigRef`（不同目标 A→B 仍放行，交给过期守卫）；
  4. 用例1 的第二次点击偶发未发出 B（React `draft` 尚未提交，被上述同目标保护正确挡下）⇒ 测试改为可控重试 + `dispatchEvent`，直到 B 请求确实发出，**让并发成为确定事实**；
  5. 修复后竞态两用例 **2 passed**（A、B 均发出、结果 B、A 晚到不覆盖、重复点击只发 1 次）。
- **凭据脱敏**：扫描发现红队证据原样落盘了真实的 `authjs.session-token` JWT、`closure.json` 落了登录密码 ⇒ 两个脚本的记录层已加脱敏（`respHeaders` / `redactBody`），已落盘 40 份 JSON 批量清洗（6 份修改），二次扫描 0 命中。
- **性能 Trace**：`v21-batch2-perf.mjs --runs=3` 采集 4m36s，`PERF_EXIT=0`、`verdict=MEASURED`、9 页全部 `MEASURED`、`0 BLOCKED / 0 NO_DATA`，但**逐页 9/9 MISS**（TBT 全超 200ms）。脚本退出码与达标与否是两个字段，不能混用；逐页门槛、CLS 位移采样、历史基线对比与「不放水声明」见 `PERF_ANALYSIS.md`。
- **构建**：`npm run build` exit 0、`✓ Compiled successfully in 33.0s`；`tsconfig.json` / `next.config.ts` 未被重写。

## 沙箱要点

- `env -u NODE_OPTIONS` 必需（注入 shim 会让 eslint / Next 构建输出 EPIPE）。
- 本地 curl 必须 `--noproxy '*'`（系统代理劫持 127.0.0.1）；脚本用 `node:http` 直连等价绕过。
- 无 Playwright 下载版 Chromium ⇒ `PW_CHANNEL=chrome`（借系统 Chrome）。
- CI 不重跑 `prisma generate` ⇒ `src/generated` 生成产物必须随提交；本批含 Prisma 变更 ⇒ **发布铁律：先迁移后发版**。
- `.qa-*-e2e.local.json` 与 `ci-e2e.db` 已进 `.gitignore`（首批补），凭据不入库。
