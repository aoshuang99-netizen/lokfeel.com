# 03 · 风险登记册

> 只登记**能落到具体文件或具体外部条件**的风险。泛泛的"技术债""性能风险"不进来。
> 等级 = 影响 × 可能性，均为投产后 30 天内需要盯的项。

| # | 风险 | 影响 | 可能性 | 现有缓解 | 状态 |
|---|---|---|---|---|---|
| R-01 | 双世界两套调色板中任一侧对比度不达标 | 中（可读性/合规） | 中 | `npm run verify:contrast` 直接对 5 个调色板块 × 15 组令牌算 WCAG 比值；本轮已抓出并修正 3 个不达标令牌 | **已缓解** |
| R-02 | 阶段条的计数口径与端点字段漂移（例如 `counts.unverified` 改名） | 中（显示错误数字或「—」） | 中 | 类型来自 `@/lib/living/*/types`，字段改名会先让 `tsc` 红；单测固定了四段 key / view | **已缓解** |
| R-03 | 双世界换肤依赖 CSS 变量作用域，某个组件写了死色（如 `style={{color:'#fff'}}`） | 低（局部不可读） | 中 | 现有 living 组件全部走工具类；新增组件需在 review 时禁止死色 | 监控 |
| R-04 | `stage-rail` 的 `aria-current="step"` 与"待办"语义可能让屏幕阅读器误读为进度 | 低 | 低 | 已有单测校验文案分支（在等你/待处理/无待办/未就绪），语义仍建议可用性测试 | 待测试 |
| R-05 | 移动端阶段条需横向滚动才能看全四段 | 低（可发现性） | 高 | 保留 `overflow-x-auto`；记入 G-03，等可用性测试决定是否改 2×2 | 接受 |
| R-06 | legacy 线无法量化（访问量 / 活跃账号 / 续费数） | 中（无法定弃用日期） | — | 已写清取数方式；CF beacon 本轮才修好，历史数据本身不完整 | **BLOCKED** |
| R-07 | 跨租户负向测试未跑 | 高（安全结论不完整） | — | 静态覆盖已量出（50 条 v1 路由，0 条裸 prisma）；动态测试需第二个有数据的组织 | **BLOCKED** |
| R-08 | 支付 4 个凭据缺失 → 无法收费 | 高（商业） | — | 7 入口 503 + `PAYMENT_NOT_CONFIGURED`，`/api/health.payments` 自报缺口 | **BLOCKED** |
| R-09 | Feature flag 存在**进程内存**，实例重启即回默认 | 中（开关行为不一致） | 高 | 页面上显式告知"重启恢复默认"；正确修法是建表，需要迁移窗口 | 已知，待迁移 |
| R-10 | libSQL 无 RLS：隔离是应用级 | 高（一个漏 where 就是越权） | 低 | 45/50 v1 路由走 `withTenant`；能力判定用 `can(...)`；`some()` 语义已在注释里写死推导 | 接受（架构约束） |
| R-11 | Next 16 中间件必须放**仓库根** `proxy.ts`（不是 `src/proxy.ts`） | 高（geo/CORS 策略整体失效且无报错） | 中 | netlify.toml 与 `proxy.ts` 文件头均有说明；`verify:geo` 可验 | 已缓解 |
| R-12 | dev 依赖树 5 个 high（`braces` 等无修复版本） | 低（不进生产包） | — | 生产树 high = 0；dev 树记录在 `DEPENDENCY_RISK §7.7` | 接受 |
| R-13 | 双世界默认深色画布可能让"阅读型用户"不适 | 低 | 中 | 保留 Contrast 切换（阅读模式下画布同步变浅，是有实际效果的控件） | 监控 |
| R-14 | 设计 C 的"默认聚焦"若数据全为 0，会聚焦到最后一个已就绪段（可能不是用户想看的） | 低 | 中 | `focusStage` 明确：无待办 → 最后一个已就绪；全未就绪 → `null`（不编起点） | 已缓解 |
| R-15 | 公开路由品牌门禁只扫 `(public)`，`/m/[token]` 分享页与 `/blocked` 未纳入 | 低 | 低 | 这两个页面不承载产品叙事；若要纳入，需先给它们补 metadata | 已知 |

## 复跑

```bash
npm run verify:contrast
npm run verify:brand-scan
NODE_PATH=… tsx scripts/qa/v16-unit-runner.mts tests/living/adaptive-stages.test.ts
curl -s https://app.lokfeel.com/api/health | node -e '…'   # payments 块
```
